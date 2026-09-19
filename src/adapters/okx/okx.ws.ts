import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { mapOkxPositionSide } from './okx.mapper';
import { OrderStatus, PositionUpdate, TickerData } from '../../core/exchange/exchange.types';

export class OkxWsManager {
  private readonly logger = new Logger(OkxWsManager.name);
  private publicWs: ReconnectingWsClient | null = null;
  private privateWs: ReconnectingWsClient | null = null;
  private tickerCallbacks = new Map<string, (data: TickerData) => void>();
  private positionCallback: ((data: PositionUpdate) => void) | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly passphrase: string,
    private readonly wsPublicUrl = 'wss://ws.okx.com:8443/ws/v5/public',
    private readonly wsPrivateUrl = 'wss://ws.okx.com:8443/ws/v5/private',
  ) {}

  async connectTicker(instId: string, cb: (data: TickerData) => void): Promise<void> {
    this.tickerCallbacks.set(instId, cb);

    if (!this.publicWs) {
      this.publicWs = new ReconnectingWsClient({
        url: this.wsPublicUrl,
        exchangeId: 'okx-public',
        pingIntervalMs: 20_000,
        onOpen: () => this.subscribeAllTickers(),
        onMessage: (raw) => this.handleTickerMessage(raw),
      });
      await this.publicWs.connect();
    } else {
      this.publicWs.send(
        JSON.stringify({ op: 'subscribe', args: [{ channel: 'tickers', instId }] }),
      );
    }
  }

  private subscribeAllTickers(): void {
    const args = Array.from(this.tickerCallbacks.keys()).map((instId) => ({
      channel: 'tickers',
      instId,
    }));
    this.publicWs?.send(JSON.stringify({ op: 'subscribe', args }));
  }

  private handleTickerMessage(raw: any): void {
    try {
      const parsed = JSON.parse(raw.toString());
      if (parsed.arg?.channel !== 'tickers' || !parsed.data?.length) return;

      const item = parsed.data[0];
      const cb = this.tickerCallbacks.get(item.instId);
      if (!cb) return;

      cb({
        exchangeId: 'okx',
        symbol: item.instId,
        bidPrice: parseFloat(item.bidPx),
        askPrice: parseFloat(item.askPx),
        timestamp: parseInt(item.ts, 10) || Date.now(),
      });
    } catch (err) {
      this.logger.error(`خطا در پردازش پیام Ticker: ${(err as Error).message}`);
    }
  }

  async connectPrivate(accountId: string, cb: (data: PositionUpdate) => void): Promise<void> {
    this.positionCallback = cb;

    this.privateWs = new ReconnectingWsClient({
      url: this.wsPrivateUrl,
      exchangeId: 'okx-private',
      pingIntervalMs: 20_000,
      onOpen: () => this.authenticate(),
      onMessage: (raw) => this.handlePrivateMessage(raw, accountId),
    });

    await this.privateWs.connect();
  }

  private authenticate(): void {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const prehash = `${timestamp}GET/users/self/verify`;
    const sign = crypto
      .createHmac('sha256', this.apiSecret)
      .update(prehash)
      .digest('base64');

    this.privateWs?.send(
      JSON.stringify({
        op: 'login',
        args: [
          {
            apiKey: this.apiKey,
            passphrase: this.passphrase,
            timestamp,
            sign,
          },
        ],
      }),
    );

    setTimeout(() => {
      this.privateWs?.send(
        JSON.stringify({
          op: 'subscribe',
          args: [{ channel: 'positions', instType: 'SWAP' }],
        }),
      );
    }, 500);
  }

  private handlePrivateMessage(raw: any, accountId: string): void {
    try {
      const parsed = JSON.parse(raw.toString());
      if (parsed.arg?.channel !== 'positions' || !this.positionCallback) return;

      for (const pos of parsed.data ?? []) {
        const size = parseFloat(pos.pos);
        this.positionCallback({
          exchangeId: 'okx',
          accountId,
          symbol: pos.instId,
          side: mapOkxPositionSide(pos.posSide, size),
          status: size === 0 ? OrderStatus.CANCELLED : OrderStatus.FILLED,
          quantity: Math.abs(size),
          entryPrice: parseFloat(pos.avgPx) || null,
          timestamp: parseInt(pos.uTime, 10) || Date.now(),
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
