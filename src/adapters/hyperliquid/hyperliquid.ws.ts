import { Logger } from '@nestjs/common';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { mapHyperliquidPositionSide } from './hyperliquid.mapper';
import { OrderStatus, PositionUpdate, TickerData } from '../../core/exchange/exchange.types';

/**
 * WebSocket عمومی Hyperliquid. برخلاف CEXها، این WS برای دیتای
 * حساب هم نیازی به Login جدا نداره — فقط باید subscribe با آدرس
 * کیف‌پول (user) انجام بشه، چون داده‌ها روی چین Public هستن.
 */
export class HyperliquidWsManager {
  private readonly logger = new Logger(HyperliquidWsManager.name);
  private ws: ReconnectingWsClient | null = null;
  private tickerCallbacks = new Map<string, (data: TickerData) => void>();
  private positionCallback: ((data: PositionUpdate) => void) | null = null;
  private walletAddress: string | null = null;

  constructor(private readonly wsUrl = 'wss://api.hyperliquid.xyz/ws') {}

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
    for (const coin of this.tickerCallbacks.keys()) {
      this.ws?.send(
        JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }),
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
    this.tickerCallbacks.set(coin, cb);
    await this.ensureConnected();
    // allMids یک استریم واحد برای همه Coin هاست، پس فقط یک‌بار subscribe لازمه
    this.ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
  }

  private handleMessage(raw: any): void {
    try {
      const parsed = JSON.parse(raw.toString());

      if (parsed.channel === 'allMids') {
        const mids = parsed.data?.mids ?? {};
        for (const [coin, price] of Object.entries(mids)) {
          const cb = this.tickerCallbacks.get(coin);
          if (!cb) continue;
          const mid = parseFloat(price as string);
          // Hyperliquid فقط Mid Price میده نه Bid/Ask جدا در این استریم؛
          // برای دقت بیشتر باید از l2Book subscription استفاده بشه (بهبود آینده)
          cb({
            exchangeId: 'hyperliquid',
            symbol: coin,
            bidPrice: mid,
            askPrice: mid,
            timestamp: Date.now(),
          });
        }
      }

      if (parsed.channel === 'webData2' && this.positionCallback) {
        const positions = parsed.data?.clearinghouseState?.assetPositions ?? [];
        for (const p of positions) {
          const szi = parseFloat(p.position.szi);
          this.positionCallback({
            exchangeId: 'hyperliquid',
            accountId: '', // در Adapter پر میشه
            symbol: p.position.coin,
            side: mapHyperliquidPositionSide(szi),
            status: szi === 0 ? OrderStatus.CANCELLED : OrderStatus.FILLED,
            quantity: Math.abs(szi),
            entryPrice: parseFloat(p.position.entryPx) || null,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      this.logger.error(`خطا در پردازش پیام: ${(err as Error).message}`);
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
  }
}
