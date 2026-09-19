import { Logger } from '@nestjs/common';
import {
  ExchangeError,
  IExchangeAdapter,
} from '../../core/exchange/exchange-adapter.interface';
import {
  Balance,
  ClosePositionParams,
  OpenPositionParams,
  OrderResult,
  OrderStatus,
  PositionSide,
  PositionStatus,
  PositionUpdate,
  TickerData,
} from '../../core/exchange/exchange.types';
import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';
import { OkxRestClient } from './okx.rest';
import { OkxWsManager } from './okx.ws';
import { mapOkxOrderStatus, mapOkxPositionSide, toOkxSymbol } from './okx.mapper';

/**
 * Adapter کامل OKX V5 (Perpetual Swap).
 * ⚠️ قبل از استفاده با پول واقعی حتما با Demo Trading تست کنید.
 */
export class OkxAdapter implements IExchangeAdapter {
  readonly exchangeId = 'okx';
  private readonly logger = new Logger(OkxAdapter.name);
  private readonly rest: OkxRestClient;
  private readonly wsManager: OkxWsManager;

  constructor(private readonly config: ExchangeAccountConfig) {
    if (!config.apiKey || !config.apiSecret || !config.passphrase) {
      throw new Error('OKX Adapter نیازمند apiKey، apiSecret و passphrase است');
    }
    this.rest = new OkxRestClient(
      { apiKey: config.apiKey, apiSecret: config.apiSecret, passphrase: config.passphrase },
      config.restBaseUrl,
    );
    this.wsManager = new OkxWsManager(
      config.apiKey,
      config.apiSecret,
      config.passphrase,
    );
  }

  async connectWebSocket(): Promise<void> {
    this.logger.log(`اتصال به OKX برای اکانت ${this.config.accountId}`);
  }

  async disconnectWebSocket(): Promise<void> {
    this.wsManager.disconnect();
  }

  isWebSocketHealthy(): boolean {
    return this.wsManager.isHealthy();
  }

  subscribeTicker(symbol: string, cb: (data: TickerData) => void): void {
    this.wsManager.connectTicker(toOkxSymbol(symbol), cb).catch((err) => {
      this.logger.error(`خطا در اتصال Ticker: ${err.message}`);
    });
  }

  unsubscribeTicker(symbol: string): void {
    this.logger.warn('unsubscribeTicker هنوز کامل پیاده‌سازی نشده');
  }

  subscribePositionUpdates(
    accountId: string,
    cb: (data: PositionUpdate) => void,
  ): void {
    this.wsManager.connectPrivate(accountId, cb).catch((err) => {
      this.logger.error(`خطا در اتصال Private Stream: ${err.message}`);
    });
  }

  async openPosition(params: OpenPositionParams): Promise<OrderResult> {
    const side = params.side === PositionSide.LONG ? 'buy' : 'sell';
    return this.executeOrder({
      instId: toOkxSymbol(params.symbol),
      side,
      sz: params.quantity.toString(),
      reduceOnly: false,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async closePosition(params: ClosePositionParams): Promise<OrderResult> {
    const side = params.side === PositionSide.LONG ? 'sell' : 'buy';
    return this.executeOrder({
      instId: toOkxSymbol(params.symbol),
      side,
      sz: params.quantity.toString(),
      reduceOnly: true,
      idempotencyKey: params.idempotencyKey,
    });
  }

  private async executeOrder(params: {
    instId: string;
    side: 'buy' | 'sell';
    sz: string;
    reduceOnly: boolean;
    idempotencyKey: string;
  }): Promise<OrderResult> {
    try {
      const response = await this.rest.placeOrder({
        instId: params.instId,
        side: params.side,
        ordType: 'market',
        sz: params.sz,
        tdMode: 'cross',
        reduceOnly: params.reduceOnly,
        clOrdId: params.idempotencyKey.replace(/-/g, '').slice(0, 32), // OKX محدودیت فرمت clOrdId داره
      });

      const result = response.data[0];
      if (!result || result.sCode !== '0') {
        throw new ExchangeError('okx', 'UNKNOWN', result?.sMsg || response.msg);
      }

      const orderDetails = await this.rest.getOrderDetails(params.instId, result.ordId);
      const order = orderDetails.data[0];

      return {
        exchangeOrderId: result.ordId,
        status: order ? mapOkxOrderStatus(order.state) : OrderStatus.SUBMITTED,
        filledQuantity: order ? parseFloat(order.accFillSz) : 0,
        avgFillPrice: order ? parseFloat(order.avgPx) || null : null,
        rawResponse: response,
      };
    } catch (err) {
      if (err instanceof ExchangeError && err.code === 'NETWORK_TIMEOUT') {
        return {
          exchangeOrderId: null,
          status: OrderStatus.UNKNOWN,
          filledQuantity: 0,
          avgFillPrice: null,
          rawResponse: err,
        };
      }
      throw err;
    }
  }

  async getPositionStatus(accountId: string, symbol: string): Promise<PositionStatus> {
    const instId = toOkxSymbol(symbol);
    const response = await this.rest.getPositions(instId);
    const position = response.data[0];

    if (!position || parseFloat(position.pos) === 0) {
      return {
        symbol,
        side: PositionSide.LONG,
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      };
    }

    const pos = parseFloat(position.pos);
    return {
      symbol,
      side: mapOkxPositionSide(position.posSide, pos),
      isOpen: true,
      quantity: Math.abs(pos),
      entryPrice: parseFloat(position.avgPx) || null,
      unrealizedPnl: parseFloat(position.upl) || null,
    };
  }

  async getBalance(accountId: string): Promise<Balance[]> {
    const response = await this.rest.getBalance();
    const details = response.data[0]?.details ?? [];

    return details
      .filter((d) => parseFloat(d.availBal) > 0 || parseFloat(d.frozenBal) > 0)
      .map((d) => ({
        asset: d.ccy,
        free: parseFloat(d.availBal),
        locked: parseFloat(d.frozenBal),
      }));
  }
}
