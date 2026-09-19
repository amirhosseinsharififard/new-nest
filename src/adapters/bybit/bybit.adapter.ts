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
import { BybitRestClient } from './bybit.rest';
import { BybitWsManager } from './bybit.ws';
import { mapBybitOrderStatus, toBybitSymbol } from './bybit.mapper';

/**
 * Adapter کامل Bybit V5 (Linear/USDT Perpetual Futures).
 * ⚠️ قبل از استفاده با پول واقعی حتما با Testnet تست کنید.
 */
export class BybitAdapter implements IExchangeAdapter {
  readonly exchangeId = 'bybit';
  private readonly logger = new Logger(BybitAdapter.name);
  private readonly rest: BybitRestClient;
  private readonly wsManager: BybitWsManager;

  constructor(private readonly config: ExchangeAccountConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Bybit Adapter نیازمند apiKey و apiSecret است');
    }
    this.rest = new BybitRestClient(
      { apiKey: config.apiKey, apiSecret: config.apiSecret },
      config.restBaseUrl,
    );
    this.wsManager = new BybitWsManager(config.apiKey, config.apiSecret, config.wsBaseUrl);
  }

  async connectWebSocket(): Promise<void> {
    this.logger.log(`اتصال به Bybit برای اکانت ${this.config.accountId}`);
  }

  async disconnectWebSocket(): Promise<void> {
    this.wsManager.disconnect();
  }

  isWebSocketHealthy(): boolean {
    return this.wsManager.isHealthy();
  }

  subscribeTicker(symbol: string, cb: (data: TickerData) => void): void {
    this.wsManager.connectTicker(toBybitSymbol(symbol), cb).catch((err) => {
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
    const side = params.side === PositionSide.LONG ? 'Buy' : 'Sell';
    return this.executeOrder({
      symbol: toBybitSymbol(params.symbol),
      side,
      qty: params.quantity.toString(),
      reduceOnly: false,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async closePosition(params: ClosePositionParams): Promise<OrderResult> {
    const side = params.side === PositionSide.LONG ? 'Sell' : 'Buy';
    return this.executeOrder({
      symbol: toBybitSymbol(params.symbol),
      side,
      qty: params.quantity.toString(),
      reduceOnly: true,
      idempotencyKey: params.idempotencyKey,
    });
  }

  private async executeOrder(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: string;
    reduceOnly: boolean;
    idempotencyKey: string;
  }): Promise<OrderResult> {
    try {
      const response = await this.rest.placeOrder({
        symbol: params.symbol,
        side: params.side,
        orderType: 'Market',
        qty: params.qty,
        reduceOnly: params.reduceOnly,
        orderLinkId: params.idempotencyKey,
      });

      if (response.retCode !== 0) {
        throw new ExchangeError('bybit', 'UNKNOWN', response.retMsg);
      }

      // Bybit در پاسخ order/create مقدار fill رو نمی‌ده، باید جدا استعلام بشه
      const orderStatus = await this.rest.getOrderStatus(
        response.result.orderId,
        params.symbol,
      );
      const order = orderStatus.result.list[0];

      return {
        exchangeOrderId: response.result.orderId,
        status: order ? mapBybitOrderStatus(order.orderStatus) : OrderStatus.SUBMITTED,
        filledQuantity: order ? parseFloat(order.cumExecQty) : 0,
        avgFillPrice: order ? parseFloat(order.avgPrice) || null : null,
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
    const bybitSymbol = toBybitSymbol(symbol);
    const response = await this.rest.getPositionInfo(bybitSymbol);
    const position = response.result.list[0];

    if (!position || parseFloat(position.size) === 0) {
      return {
        symbol,
        side: PositionSide.LONG,
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      };
    }

    return {
      symbol,
      side: position.side === 'Buy' ? PositionSide.LONG : PositionSide.SHORT,
      isOpen: true,
      quantity: parseFloat(position.size),
      entryPrice: parseFloat(position.avgPrice) || null,
      unrealizedPnl: parseFloat(position.unrealisedPnl) || null,
    };
  }

  async getBalance(accountId: string): Promise<Balance[]> {
    const response = await this.rest.getWalletBalance();
    const account = response.result.list[0];
    if (!account) return [];

    return account.coin
      .filter((c) => parseFloat(c.walletBalance) > 0)
      .map((c) => ({
        asset: c.coin,
        free: parseFloat(c.availableToWithdraw),
        locked: parseFloat(c.walletBalance) - parseFloat(c.availableToWithdraw),
      }));
  }
}
