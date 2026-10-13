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
  private readonly restClient: BinanceRestClient | null,
  private readonly wsBaseUrl = 'wss://fstream.binance.com',
) {}

// این متدها را به کلاس BinanceWsManager اضافه کنید

  async connectTickers(
    symbols: string[],
    cb: (data: TickerData) => void,
  ): Promise<void> {
    this.logger.log(`PUBLIC TICKER CONNECT BATCH -> ${symbols.length} symbols`);

    let hasNew = false;
    for (const symbol of symbols) {
      const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
      if (!this.tickerCallbacks.has(binanceSymbol)) {
        this.tickerCallbacks.set(binanceSymbol, cb);
        hasNew = true;
      }
    }

    // فقط یک بار برای کل مجموعه نمادها Reconnect می‌کنیم
    if (hasNew) {
      await this.reconnectTickerStream();
    }
  }

  async disconnectTickers(symbols: string[]): Promise<void> {
    let modified = false;
    for (const symbol of symbols) {
      const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
      if (this.tickerCallbacks.delete(binanceSymbol)) {
        modified = true;
      }
    }

    if (modified) {
      await this.reconnectTickerStream();
    }
  }

  async disconnectTicker(symbol: string): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
    if (!this.tickerCallbacks.delete(binanceSymbol)) return;

    await this.reconnectTickerStream();
  }

  private async reconnectTickerStream(): Promise<void> {
    this.tickerWs?.disconnect();
    this.tickerWs = null;

    // Combined Stream بین نمادها مشترک است؛ بعد از هر تغییر در مجموعهٔ نمادها
    // باید با URL جدید وصل شود. اگر نمادی باقی نمانده، اتصال عمومی را هم می‌بندیم.
    if (this.tickerCallbacks.size === 0) return;


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

 async connectUserDataStream(
  cb: (data: PositionUpdate) => void,
): Promise<void> {
  if (!this.restClient) {
    throw new Error(
      'Binance User Data Stream requires authenticated REST client',
    );
  }

  const restClient = this.restClient;

  this.positionCallback = cb;

  const { listenKey } = await restClient.createListenKey();
  this.listenKey = listenKey;

  this.userDataWs = new ReconnectingWsClient({
    url: `${this.wsBaseUrl}/ws/${listenKey}`,
    exchangeId: 'binance-userdata',
    onMessage: (raw) => this.handleUserDataMessage(raw),
  });

  await this.userDataWs.connect();

  this.keepAliveInterval = setInterval(
    () => {
      restClient.keepAliveListenKey().catch((err) => {
        this.logger.error(
          `خطا در Keep-alive listenKey: ${err.message}`,
        );
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
