import { Logger } from '@nestjs/common';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { mapHyperliquidPositionSide } from './hyperliquid.mapper';
import { OrderStatus, PositionUpdate, TickerData } from '../../core/exchange/exchange.types';

export class HyperliquidWsManager {
  private readonly logger = new Logger(HyperliquidWsManager.name);
  private ws: ReconnectingWsClient | null = null;
  private tickerCallbacks = new Map<string, (data: TickerData) => void>();
  private positionCallback: ((data: PositionUpdate) => void) | null = null;
  private walletAddress: string | null = null;

  constructor(private readonly wsUrl = 'wss://api.hyperliquid.xyz/ws') {}

  private cleanCoin(raw: string): string {
    // تبدیل BTC-USDT یا BTCUSDT یا BTC/USDT به BTC خالص برای هایپرلیکوئید
    return raw.replace(/[\/\-_]USDT/gi, '').replace(/[\/\-_]/g, '').toUpperCase();
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws) return;
    this.ws = new ReconnectingWsClient({
      url: this.wsUrl,
      exchangeId: 'hyperliquid',
      pingIntervalMs: 30_000,
      onOpen: () => this.resubscribeAll(),
      onMessage: (raw) => this.handleMessage(raw),
    });
    await this.ws.connect();
  }

  private resubscribeAll(): void {
    // ثبت مجدد تمام نمادها در استریم l2Book پس از وصل شدن مجدد
    for (const coin of this.tickerCallbacks.keys()) {
      this.ws?.send(
        JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'l2Book', coin },
        }),
      );
    }

    if (this.walletAddress) {
      this.ws?.send(
        JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'webData2', user: this.walletAddress },
        }),
      );
    }
  }

  async connectTicker(coin: string, cb: (data: TickerData) => void): Promise<void> {
    await this.connectTickers([coin], cb);
  }

  async connectTickers(coins: string[], cb: (data: TickerData) => void): Promise<void> {
    await this.ensureConnected();

    for (const rawCoin of coins) {
      const coin = this.cleanCoin(rawCoin);
      const isNew = !this.tickerCallbacks.has(coin);
      this.tickerCallbacks.set(coin, cb);

      if (isNew && this.ws?.isHealthy()) {
        this.ws.send(
          JSON.stringify({
            method: 'subscribe',
            subscription: { type: 'l2Book', coin },
          }),
        );
      }
    }
  }

  disconnectTicker(coin: string): void {
    const clean = this.cleanCoin(coin);
    if (!this.tickerCallbacks.delete(clean)) return;

    this.ws?.send(
      JSON.stringify({
        method: 'unsubscribe',
        subscription: { type: 'l2Book', coin: clean },
      }),
    );

    if (this.tickerCallbacks.size === 0 && !this.walletAddress) {
      this.ws?.disconnect();
      this.ws = null;
    }
  }

  private handleMessage(raw: any): void {
    try {
      const parsed = JSON.parse(raw.toString());

      // دریافت و تجزیه دفترچه سفارشات واقعی L2
      if (parsed.channel === 'l2Book' && parsed.data) {
        const bookData = parsed.data;
        const coin = bookData.coin; // مثلا "BTC"
        const cb = this.tickerCallbacks.get(coin);
        if (!cb) return;

        // levels[0] خریداران (Bids) و levels[1] فروشندگان (Asks) هستند
        const bestBid = bookData.levels?.[0]?.[0];
        const bestAsk = bookData.levels?.[1]?.[0];

        cb({
          exchangeId: 'hyperliquid',
          symbol: `${coin}-USDT`, // برگرداندن با فرمت استاندارد پروژه
          bidPrice: bestBid ? parseFloat(bestBid.px) : 0,
          bidSize: bestBid ? parseFloat(bestBid.sz) : 0,   // حجم واقعی توکن
          askPrice: bestAsk ? parseFloat(bestAsk.px) : 0,
          askSize: bestAsk ? parseFloat(bestAsk.sz) : 0,   // حجم واقعی توکن
          timestamp: bookData.time ?? Date.now(),
        });
        return;
      }

      // وضعیت پوزیشن‌ها
      if (parsed.channel === 'webData2' && this.positionCallback) {
        const positions = parsed.data?.clearinghouseState?.assetPositions ?? [];
        for (const p of positions) {
          const szi = parseFloat(p.position.szi);
          this.positionCallback({
            exchangeId: 'hyperliquid',
            accountId: '',
            symbol: `${p.position.coin}-USDT`,
            side: mapHyperliquidPositionSide(szi),
            status: szi === 0 ? OrderStatus.CANCELLED : OrderStatus.FILLED,
            quantity: Math.abs(szi),
            entryPrice: parseFloat(p.position.entryPx) || null,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      this.logger.error(`خطا در پردازش پیام Hyperliquid: ${(err as Error).message}`);
    }
  }

  async subscribeAccount(walletAddress: string, cb: (data: PositionUpdate) => void): Promise<void> {
    this.walletAddress = walletAddress;
    this.positionCallback = cb;
    await this.ensureConnected();
    this.ws?.send(
      JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'webData2', user: walletAddress },
      }),
    );
  }

  isHealthy(): boolean {
    return this.ws ? this.ws.isHealthy() : true;
  }

  disconnect(): void {
    this.ws?.disconnect();
    this.ws = null;
    this.tickerCallbacks.clear();
    this.positionCallback = null;
  }
}
