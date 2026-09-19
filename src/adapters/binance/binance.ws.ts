import { Logger } from '@nestjs/common';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { BinanceRestClient } from './binance.rest';
import { mapBinancePositionSide, toBinanceSymbol } from './binance.mapper';
import { PositionUpdate, TickerData } from '../../core/exchange/exchange.types';
import { OrderStatus } from '../../core/exchange/exchange.types';

/**
 * مدیریت دو نوع WebSocket جدا برای Binance:
 * ۱) Market Stream عمومی (bookTicker) — نیاز به Auth نداره
 * ۲) User Data Stream خصوصی (Position/Order Update) — نیاز به listenKey داره
 *    که هر ۳۰ دقیقه باید Keep-alive بشه وگرنه صرافی قطعش می‌کنه.
 */
export class BinanceWsManager {
  private readonly logger = new Logger(BinanceWsManager.name);
  private tickerWs: ReconnectingWsClient | null = null;
  private userDataWs: ReconnectingWsClient | null = null;
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  private tickerCallbacks = new Map<string, (data: TickerData) => void>();
  private positionCallback: ((data: PositionUpdate) => void) | null = null;

  constructor(
    private readonly restClient: BinanceRestClient,
    private readonly wsBaseUrl = 'wss://fstream.binance.com',
  ) {}

  async connectTicker(symbol: string, cb: (data: TickerData) => void): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
    this.tickerCallbacks.set(binanceSymbol, cb);

    if (this.tickerWs) {
      // برای سادگی فاز ۲: هر Symbol جدید یعنی Reconnect با استریم ترکیبی جدید.
      // در Production بهتره از Combined Stream برای همه Symbolها همزمان استفاده بشه.
      this.tickerWs.disconnect();
    }

    const streams = Array.from(this.tickerCallbacks.keys())
      .map((s) => `${s}@bookTicker`)
      .join('/');

    this.tickerWs = new ReconnectingWsClient({
      url: `${this.wsBaseUrl}/stream?streams=${streams}`,
      exchangeId: 'binance-ticker',
      pingIntervalMs: 3 * 60 * 1000,
      onMessage: (raw) => this.handleTickerMessage(raw),
    });

    await this.tickerWs.connect();
  }

  private handleTickerMessage(raw: any): void {
    try {
      const parsed = JSON.parse(raw.toString());
      const payload = parsed.data;
      if (!payload || !payload.s) return;

      const binanceSymbol = payload.s.toLowerCase();
      const cb = this.tickerCallbacks.get(binanceSymbol);
      if (!cb) return;

      const tickerData: TickerData = {
        exchangeId: 'binance',
        symbol: payload.s,
        bidPrice: parseFloat(payload.b),
        askPrice: parseFloat(payload.a),
        timestamp: Date.now(),
      };
      cb(tickerData);
    } catch (err) {
      this.logger.error(`خطا در پردازش پیام Ticker: ${(err as Error).message}`);
    }
  }

  async connectUserDataStream(cb: (data: PositionUpdate) => void): Promise<void> {
    this.positionCallback = cb;

    const { listenKey } = await this.restClient.createListenKey();
    this.listenKey = listenKey;

    this.userDataWs = new ReconnectingWsClient({
      url: `${this.wsBaseUrl}/ws/${listenKey}`,
      exchangeId: 'binance-userdata',
      onMessage: (raw) => this.handleUserDataMessage(raw),
    });

    await this.userDataWs.connect();

    // هر 30 دقیقه یک‌بار Keep-alive، چون Binance بعد از 60 دقیقه بی‌فعالیت listenKey رو می‌بنده
    this.keepAliveInterval = setInterval(
      () => {
        this.restClient.keepAliveListenKey().catch((err) => {
          this.logger.error(`خطا در Keep-alive listenKey: ${err.message}`);
        });
      },
      30 * 60 * 1000,
    );
  }

  private handleUserDataMessage(raw: any): void {
    try {
      const parsed = JSON.parse(raw.toString());
      // رویداد ACCOUNT_UPDATE شامل تغییرات پوزیشن است
      if (parsed.e === 'ACCOUNT_UPDATE' && this.positionCallback) {
        const positions = parsed.a?.P ?? [];
        for (const pos of positions) {
          const positionAmt = parseFloat(pos.pa);
          const update: PositionUpdate = {
            exchangeId: 'binance',
            accountId: '', // در Adapter اصلی پر می‌شه
            symbol: pos.s,
            side: mapBinancePositionSide(positionAmt),
            status: positionAmt === 0 ? OrderStatus.CANCELLED : OrderStatus.FILLED,
            quantity: Math.abs(positionAmt),
            entryPrice: parseFloat(pos.ep) || null,
            timestamp: parsed.E ?? Date.now(),
          };
          this.positionCallback(update);
        }
      }
    } catch (err) {
      this.logger.error(`خطا در پردازش پیام User Data: ${(err as Error).message}`);
    }
  }

  isHealthy(): boolean {
    // اگر هنوز subscribe نشده، سالم فرض میشه (چون هنوز نیازی به آن نبوده)
    const tickerOk = this.tickerWs ? this.tickerWs.isHealthy() : true;
    const userDataOk = this.userDataWs ? this.userDataWs.isHealthy() : true;
    return tickerOk && userDataOk;
  }

  disconnect(): void {
    this.tickerWs?.disconnect();
    this.userDataWs?.disconnect();
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
  }
}
