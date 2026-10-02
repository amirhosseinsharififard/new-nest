import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service';
import { IPublicMarketDataAdapter, PublicExchangeId, PublicTicker } from '../../core/market-data/public-market-data.interface';
import { createPublicMarketDataAdapters } from './public-market-data.adapters';
import { normalizedSymbolLabel } from './public-symbol-normalizer';

export interface ScannerOpportunity {
  normalizedSymbol: string; quoteAsset: string; settlementAsset: string; buyExchange: PublicExchangeId; sellExchange: PublicExchangeId;
  buyAsk: number; sellBid: number; grossSpreadPercent: number; estimatedFeesPercent: number; netSpreadPercent: number;
  buyTickerTimestamp: number; sellTickerTimestamp: number; calculatedAt: number; expiresAt: number; freshnessMs: { buy: number; sell: number };
}

export interface ScannerTickerView {
  exchangeId: PublicExchangeId; normalizedSymbol: string; exchangeSymbol: string; bidPrice: number; askPrice: number;
  timestamp: number; receivedAt: number; quoteAsset: string; settlementAsset: string; marketType: 'perpetual'; freshnessMs: number;
}

const key = (ticker: PublicTicker) => `market-scanner:ticker:${ticker.exchangeId}:${ticker.normalizedSymbol.comparisonKey}`;

@Injectable()
export class MarketScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly adapters: IPublicMarketDataAdapter[]; private readonly tickers = new Map<string, Map<PublicExchangeId, PublicTicker>>();
  private readonly opportunities = new Map<string, ScannerOpportunity>(); private readonly pending = new Set<string>(); private running = false;
  private readonly ttl: number; private readonly freshness: number; private readonly minimum: number; private readonly maximum: number; private readonly allowed: Set<string>; private readonly debounceMs: number;
  constructor(private readonly redis: RedisService, private readonly config: ConfigService) {
    this.ttl = Number(config.get('MARKET_SCANNER_TTL_SECONDS', 15)); this.freshness = Number(config.get('MARKET_SCANNER_FRESHNESS_MS', 5_000));
    this.minimum = Number(config.get('MARKET_SCANNER_MIN_SPREAD_PERCENT', 0)); this.maximum = Number(config.get('MARKET_SCANNER_MAX_RESULTS', 100));
    this.debounceMs = Number(config.get('MARKET_SCANNER_DEBOUNCE_MS', 0));
    this.allowed = new Set(String(config.get('MARKET_SCANNER_EXCHANGES', 'binance,bybit,okx,hyperliquid')).split(',').map((x) => x.trim()).filter(Boolean));
    this.adapters = createPublicMarketDataAdapters().filter((a) => this.allowed.has(a.exchangeId));
  }
  async start(): Promise<void> { if (this.running) return; this.running = true; await Promise.all(this.adapters.map((a) => a.subscribeAllTickers((t) => void this.ingest(t)))); }
  async onModuleInit(): Promise<void> { if (String(this.config.get('MARKET_SCANNER_ENABLED', false)).toLowerCase() === 'true') await this.start(); }
  stop(): void { this.running = false; this.pending.clear(); for (const a of this.adapters) { a.unsubscribeAllTickers(); a.disconnect(); } }
  status() { return { running: this.running, exchanges: this.adapters.map((a) => ({ exchangeId: a.exchangeId, healthy: a.isHealthy() })), tickerCount: [...this.tickers.values()].reduce((n, x) => n + x.size, 0) }; }
  async ingest(ticker: PublicTicker): Promise<void> {
    if (!this.running || !this.allowed.has(ticker.exchangeId) || !this.valid(ticker)) return;
    const symbol = ticker.normalizedSymbol.comparisonKey; let byExchange = this.tickers.get(symbol);
    if (!byExchange) this.tickers.set(symbol, byExchange = new Map()); const old = byExchange.get(ticker.exchangeId);
    if (old && old.receivedAt >= ticker.receivedAt) return;
    byExchange.set(ticker.exchangeId, ticker);
    // Do not put Redis I/O on the signal's critical path. Persistence is best-effort;
    // the in-memory index is immediately available and is rebuilt by public WS after restart.
    void this.redis.set(key(ticker), JSON.stringify(ticker), this.ttl).catch(() => undefined);
    if (!this.pending.has(symbol)) { this.pending.add(symbol); const calculate = () => { this.pending.delete(symbol); this.calculate(symbol); }; if (this.debounceMs > 0) setTimeout(calculate, this.debounceMs); else queueMicrotask(calculate); }
  }
  getOpportunities(options: { minSpreadPercent?: number; limit?: number; exchanges?: string[]; symbol?: string }) {
    const min = options.minSpreadPercent ?? this.minimum; const allowed = options.exchanges ? new Set(options.exchanges) : null; const needle = options.symbol?.toUpperCase();
    const now = Date.now(); return [...this.opportunities.values()].filter((o) => o.expiresAt > now && o.netSpreadPercent >= min && (!allowed || (allowed.has(o.buyExchange) && allowed.has(o.sellExchange))) && (!needle || o.normalizedSymbol.includes(needle))).sort((a,b) => b.netSpreadPercent - a.netSpreadPercent).slice(0, Math.min(options.limit ?? this.maximum, this.maximum));
  }
  symbols() { const now = Date.now(); return [...this.tickers.entries()].map(([symbol, values]) => ({ normalizedSymbol: symbol, exchanges: [...values.values()].filter((t) => now - t.receivedAt <= this.freshness).map((t) => t.exchangeId) })).filter((x) => x.exchanges.length); }
  getTickers(options: { exchange?: string; symbol?: string; limit?: number }): ScannerTickerView[] {
    const now = Date.now(); const exchange = options.exchange?.toLowerCase(); const symbol = options.symbol?.toUpperCase(); const limit = Math.min(options.limit ?? 10, 1_000);
    return [...this.tickers.values()].flatMap((byExchange) => [...byExchange.values()]).filter((ticker) => now - ticker.receivedAt <= this.freshness && (!exchange || ticker.exchangeId === exchange) && (!symbol || normalizedSymbolLabel(ticker.normalizedSymbol).includes(symbol) || ticker.exchangeSymbol.includes(symbol))).sort((a, b) => b.receivedAt - a.receivedAt).slice(0, limit).map((ticker) => ({ exchangeId: ticker.exchangeId, normalizedSymbol: normalizedSymbolLabel(ticker.normalizedSymbol), exchangeSymbol: ticker.exchangeSymbol, bidPrice: ticker.bidPrice, askPrice: ticker.askPrice, timestamp: ticker.timestamp, receivedAt: ticker.receivedAt, quoteAsset: ticker.normalizedSymbol.quoteAsset, settlementAsset: ticker.normalizedSymbol.settlementAsset, marketType: ticker.normalizedSymbol.marketType, freshnessMs: now - ticker.receivedAt }));
  }
  async onModuleDestroy(): Promise<void> { this.stop(); }
  private calculate(symbol: string): void { const now = Date.now(); const rows = [...(this.tickers.get(symbol)?.values() ?? [])].filter((t) => now - t.receivedAt <= this.freshness); for (const buy of rows) for (const sell of rows) { if (buy.exchangeId === sell.exchangeId) continue; const gross = ((sell.bidPrice - buy.askPrice) / buy.askPrice) * 100; const fees = this.fee(buy.exchangeId) + this.fee(sell.exchangeId); const net = gross - fees; const id = `${symbol}:${buy.exchangeId}:${sell.exchangeId}`; if (net >= this.minimum) this.opportunities.set(id, { normalizedSymbol: normalizedSymbolLabel(buy.normalizedSymbol), quoteAsset: buy.normalizedSymbol.quoteAsset, settlementAsset: buy.normalizedSymbol.settlementAsset, buyExchange: buy.exchangeId, sellExchange: sell.exchangeId, buyAsk: buy.askPrice, sellBid: sell.bidPrice, grossSpreadPercent: gross, estimatedFeesPercent: fees, netSpreadPercent: net, buyTickerTimestamp: buy.timestamp, sellTickerTimestamp: sell.timestamp, calculatedAt: now, expiresAt: Math.min(buy.receivedAt, sell.receivedAt) + this.freshness, freshnessMs: { buy: now - buy.receivedAt, sell: now - sell.receivedAt } }); else this.opportunities.delete(id); } }
  private fee(exchange: PublicExchangeId): number { return Number(this.config.get(`MARKET_SCANNER_${exchange.toUpperCase()}_TAKER_FEE_PERCENT`, 0.04)); }
  private valid(t: PublicTicker): boolean { return Number.isFinite(t.bidPrice) && Number.isFinite(t.askPrice) && t.bidPrice > 0 && t.askPrice >= t.bidPrice && Date.now() - t.receivedAt <= this.ttl * 1000; }
}
