import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { mapBybitPositionSide } from './bybit.mapper';
import { OrderStatus, PositionUpdate, TickerData } from '../../core/exchange/exchange.types';


export class BybitWsManager {
  private readonly logger = new Logger(BybitWsManager.name);
  private publicWs: ReconnectingWsClient | null = null;
  private privateWs: ReconnectingWsClient | null = null;
  private tickerCallbacks = new Map<string, (data: TickerData) => void>();
  private positionCallback: ((data: PositionUpdate) => void) | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly wsBaseUrl = 'wss://stream.bybit.com',
  ) {}

  // در سطح کلاس BybitWsManager:
private lastPrices = new Map<string, { bidPrice: number; askPrice: number }>();

  async connectTicker(symbol: string, cb: (data: TickerData) => void): Promise<void> {
  const cleanSymbol = symbol.replace(/[\/\-_]/g, '').toUpperCase();
  this.tickerCallbacks.set(cleanSymbol, cb);

  if (!this.publicWs) {
    this.publicWs = new ReconnectingWsClient({
      url: `${this.wsBaseUrl}/v5/public/linear`,
      exchangeId: 'bybit-public',
      pingIntervalMs: 20_000,
      onOpen: () => this.subscribeAllTickers(),
      onMessage: (raw) => this.handleTickerMessage(raw),
    });
    await this.publicWs.connect();
  } else {
    this.publicWs.send(
      JSON.stringify({ op: 'subscribe', args: [`tickers.${cleanSymbol}`] }),
    );
  }
}


  disconnectTicker(symbol: string): void {
    if (!this.tickerCallbacks.delete(symbol)) return;

    if (this.tickerCallbacks.size === 0) {
      this.publicWs?.disconnect();
      this.publicWs = null;
      return;
    }

    this.publicWs?.send(
      JSON.stringify({ op: 'unsubscribe', args: [`tickers.${symbol}`] }),
    );
  }

// این متدها را به کلاس BybitWsManager اضافه/جایگزین کنید

  async connectTickers(symbols: string[], cb: (data: TickerData) => void): Promise<void> {
  const newArgs: string[] = [];

  for (const rawSymbol of symbols) {
    const symbol = rawSymbol.replace(/[\/\-_]/g, '').toUpperCase();
    if (!this.tickerCallbacks.has(symbol)) {
      this.tickerCallbacks.set(symbol, cb);
      newArgs.push(`tickers.${symbol}`);
    }
  }

  if (!this.publicWs) {
    this.publicWs = new ReconnectingWsClient({
      url: `${this.wsBaseUrl}/v5/public/linear`,
      exchangeId: 'bybit-public',
      pingIntervalMs: 20_000,
      onOpen: () => this.subscribeAllTickers(),
      onMessage: (raw) => this.handleTickerMessage(raw),
    });
    await this.publicWs.connect();
  } else if (newArgs.length > 0) {
    for (let i = 0; i < newArgs.length; i += 10) {
      const chunk = newArgs.slice(i, i + 10);
      this.publicWs.send(JSON.stringify({ op: 'subscribe', args: chunk }));
    }
  }
}

  // متد subscribeAllTickers را هم برای اطمینان Chunked کنیم
  private subscribeAllTickers(): void {
    const allArgs = Array.from(this.tickerCallbacks.keys()).map((s) => `tickers.${s}`);
    for (let i = 0; i < allArgs.length; i += 10) {
      const chunk = allArgs.slice(i, i + 10);
      this.publicWs?.send(JSON.stringify({ op: 'subscribe', args: chunk }));
    }
  }

  private handleTickerMessage(raw: any): void {
  try {
    const rawStr = raw.toString();
    if (rawStr.includes('op') && rawStr.includes('pong')) return;

    const parsed = JSON.parse(rawStr);

    // بررسی پاسخ سابسکرایب
    if (parsed.op === 'subscribe') {
      if (parsed.success === false || (parsed.ret_msg && parsed.ret_msg !== 'OK')) {
        this.logger.error(`[BYBIT SUBSCRIBE FAILED]: ${rawStr}`);
      } else {
        this.logger.log(`[BYBIT SUBSCRIBE OK]: ${rawStr}`);
      }
      return;
    }

    if (!parsed.topic?.startsWith('tickers.')) return;

    const symbol = parsed.topic.replace('tickers.', '');
    const cb = this.tickerCallbacks.get(symbol);

    if (!cb) {
      this.logger.warn(`[BYBIT WS] No callback for symbol: "${symbol}". Keys: ${Array.from(this.tickerCallbacks.keys()).join(',')}`);
      return;
    }

    const data = parsed.data;
    if (!data) return;

    const current = this.lastPrices.get(symbol) || { bidPrice: 0, askPrice: 0 };

    if (data.bid1Price) current.bidPrice = parseFloat(data.bid1Price);
    if (data.ask1Price) current.askPrice = parseFloat(data.ask1Price);

    this.lastPrices.set(symbol, current);

    if (!current.bidPrice || !current.askPrice) return;

    cb({
      exchangeId: 'bybit',
      symbol,
      bidPrice: current.bidPrice,
      askPrice: current.askPrice,
      timestamp: parsed.ts ?? Date.now(),
    });
  } catch (err) {
    this.logger.error(`خطا در پردازش پیام Ticker: ${(err as Error).message}`);
  }
}

  async connectPrivate(accountId: string, cb: (data: PositionUpdate) => void): Promise<void> {
    this.positionCallback = cb;

    this.privateWs = new ReconnectingWsClient({
      url: `${this.wsBaseUrl}/v5/private`,
      exchangeId: 'bybit-private',
      pingIntervalMs: 20_000,
      onOpen: () => this.authenticate(),
      onMessage: (raw) => this.handlePrivateMessage(raw, accountId),
    });

    await this.privateWs.connect();
  }

  private authenticate(): void {
    // امضای Bybit برای WS Auth: HMAC("GET/realtime" + expires)
    const expires = Date.now() + 10_000;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(`GET/realtime${expires}`)
      .digest('hex');

    this.privateWs?.send(
      JSON.stringify({ op: 'auth', args: [this.apiKey, expires, signature] }),
    );

    // بعد از auth باید subscribe به position stream انجام بشه
    setTimeout(() => {
      this.privateWs?.send(JSON.stringify({ op: 'subscribe', args: ['position'] }));
    }, 500);
  }

  private handlePrivateMessage(raw: any, accountId: string): void {
    try {
      const parsed = JSON.parse(raw.toString());
      if (parsed.topic !== 'position' || !this.positionCallback) return;

      for (const pos of parsed.data ?? []) {
        const size = parseFloat(pos.size);
        this.positionCallback({
          exchangeId: 'bybit',
          accountId,
          symbol: pos.symbol,
          side: mapBybitPositionSide(pos.side),
          status: size === 0 ? OrderStatus.CANCELLED : OrderStatus.FILLED,
          quantity: size,
          entryPrice: parseFloat(pos.avgPrice) || null,
          timestamp: parsed.creationTime ?? Date.now(),
        });
      }
    } catch (err) {
      this.logger.error(`خطا در پردازش پیام Private: ${(err as Error).message}`);
    }
  }

  isHealthy(): boolean {
    const publicOk = this.publicWs ? this.publicWs.isHealthy() : true;
    const privateOk = this.privateWs ? this.privateWs.isHealthy() : true;
    return publicOk && privateOk;
  }

  disconnect(): void {
    this.publicWs?.disconnect();
    this.privateWs?.disconnect();
  }
}
