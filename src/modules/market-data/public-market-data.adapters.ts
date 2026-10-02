import WebSocket from 'ws';
import axios from 'axios';
import { IPublicMarketDataAdapter, PublicExchangeId, PublicTicker, PublicTickerCallback } from '../../core/market-data/public-market-data.interface';
import { normalizePublicSymbol } from './public-symbol-normalizer';

type RawHandler = (message: unknown) => PublicTicker[];
const endpoints: Record<PublicExchangeId, string> = {
  binance: 'wss://fstream.binance.com/ws/!bookTicker',
  bybit: 'wss://stream.bybit.com/v5/public/linear',
  okx: 'wss://ws.okx.com:8443/ws/v5/public',
  hyperliquid: 'wss://api.hyperliquid.xyz/ws',
};

/** Public WebSocket base with bounded exponential reconnect and callback replacement (no callback leak). */
export abstract class PublicWsAdapter implements IPublicMarketDataAdapter {
  private ws: WebSocket | null = null; private callback: PublicTickerCallback | null = null;
  private manual = false; private healthy = false; private attempts = 0; private timer: NodeJS.Timeout | null = null;
  abstract readonly exchangeId: PublicExchangeId;
  async connect(): Promise<void> {
    this.manual = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws = new WebSocket(endpoints[this.exchangeId]); let opened = false;
      ws.once('open', () => { opened = true; this.healthy = true; this.attempts = 0; this.sendSubscription(); resolve(); });
      ws.on('message', (data) => this.handle(data.toString()));
      ws.on('close', () => { this.healthy = false; if (!this.manual) this.reconnect(); });
      ws.on('error', (error) => { this.healthy = false; if (!opened) reject(error); });
    });
  }
  async subscribeAllTickers(callback: PublicTickerCallback): Promise<void> { this.callback = callback; await this.connect(); }
  unsubscribeAllTickers(): void { this.callback = null; }
  disconnect(): void { this.manual = true; this.healthy = false; if (this.timer) clearTimeout(this.timer); this.timer = null; this.ws?.close(); this.ws = null; }
  isHealthy(): boolean { return this.healthy; }
  protected send(value: object): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(value)); }
  /** Serializes large public subscriptions so exchange request limits are respected. */
  protected sendQueued(values: object[], intervalMs = 50): void { values.forEach((value, index) => setTimeout(() => this.send(value), index * intervalMs)); }
  protected abstract sendSubscription(): void;
  protected abstract parse(message: unknown): PublicTicker[];
  private handle(raw: string): void { try { for (const ticker of this.parse(JSON.parse(raw))) this.callback?.(ticker); } catch { /* malformed public frames are ignored */ } }
  private reconnect(): void { const delay = Math.min(1_000 * 2 ** ++this.attempts, 30_000); this.timer = setTimeout(() => { void this.connect().catch(() => undefined); }, delay); }
  protected ticker(exchangeSymbol: string, bid: unknown, ask: unknown, timestamp: unknown): PublicTicker | null {
    const normalizedSymbol = normalizePublicSymbol(this.exchangeId, exchangeSymbol); const bidPrice = Number(bid); const askPrice = Number(ask);
    if (!normalizedSymbol || !Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || bidPrice <= 0 || askPrice <= 0 || bidPrice > askPrice) return null;
    return { exchangeId: this.exchangeId, normalizedSymbol, exchangeSymbol, bidPrice, askPrice, timestamp: Number(timestamp) || Date.now(), receivedAt: Date.now() };
  }
}

export class BinancePublicMarketDataAdapter extends PublicWsAdapter { readonly exchangeId = 'binance' as const; protected sendSubscription(): void {} protected parse(m: any): PublicTicker[] { const t = this.ticker(m.s, m.b, m.a, m.E); return t ? [t] : []; } }
export class OkxPublicMarketDataAdapter extends PublicWsAdapter { readonly exchangeId = 'okx' as const; protected sendSubscription(): void { this.send({ op: 'subscribe', args: [{ channel: 'tickers', instType: 'SWAP' }] }); } protected parse(m: any): PublicTicker[] { return Array.isArray(m.data) ? m.data.map((x: any) => this.ticker(x.instId, x.bidPx, x.askPx, x.ts)).filter(Boolean) as PublicTicker[] : []; } }
/** Bybit has no documented wildcard for ticker topics, so public REST discovery feeds bounded subscribe batches. */
export class BybitPublicMarketDataAdapter extends PublicWsAdapter {
  readonly exchangeId = 'bybit' as const; private symbols: string[] = [];
  protected sendSubscription(): void { void this.discoverAndSubscribe(); }
  private async discoverAndSubscribe(): Promise<void> {
    if (!this.symbols.length) { const response = await axios.get('https://api.bybit.com/v5/market/instruments-info', { params: { category: 'linear', limit: 1000 }, timeout: 10_000 }); this.symbols = response.data?.result?.list?.filter((x: any) => x.status === 'Trading' && x.contractType === 'LinearPerpetual').map((x: any) => x.symbol) ?? []; }
    const batches: object[] = []; for (let i = 0; i < this.symbols.length; i += 10) batches.push({ op: 'subscribe', args: this.symbols.slice(i, i + 10).map((symbol) => `tickers.${symbol}`) }); this.sendQueued(batches, 100);
  }
  protected parse(m: any): PublicTicker[] { const d = m.data; const t = d ? this.ticker(d.symbol, d.bid1Price, d.ask1Price, m.ts) : null; return t ? [t] : []; }
}
/** Hyperliquid's allMids stream has no executable BBO. Discover coins publicly and subscribe to l2Book instead. */
export class HyperliquidPublicMarketDataAdapter extends PublicWsAdapter {
  readonly exchangeId = 'hyperliquid' as const; private coins: string[] = [];
  protected sendSubscription(): void { void this.discoverAndSubscribe(); }
  private async discoverAndSubscribe(): Promise<void> {
    if (!this.coins.length) { const response = await axios.post('https://api.hyperliquid.xyz/info', { type: 'meta' }, { timeout: 10_000 }); this.coins = response.data?.universe?.filter((x: any) => x.isActive !== false).map((x: any) => x.name) ?? []; }
    this.sendQueued(this.coins.map((coin) => ({ method: 'subscribe', subscription: { type: 'l2Book', coin } })), 50);
  }
  protected parse(m: any): PublicTicker[] { const d = m.data?.data; const bid = d?.levels?.[0]?.[0]?.px; const ask = d?.levels?.[1]?.[0]?.px; const t = d ? this.ticker(d.coin, bid, ask, d.time) : null; return t ? [t] : []; }
}

export function createPublicMarketDataAdapters(): IPublicMarketDataAdapter[] { return [new BinancePublicMarketDataAdapter(), new BybitPublicMarketDataAdapter(), new OkxPublicMarketDataAdapter(), new HyperliquidPublicMarketDataAdapter()]; }
