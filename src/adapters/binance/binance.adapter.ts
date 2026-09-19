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
  PositionStatus,
  PositionSide,
  PositionUpdate,
  TickerData,
} from '../../core/exchange/exchange.types';
import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';
import { BinanceRestClient } from './binance.rest';
import { BinanceWsManager } from './binance.ws';
import { mapBinanceOrderStatus, toBinanceSymbol } from './binance.mapper';

/**
 * Adapter کامل Binance USDT-M Futures.
 *
 * ⚠️ قبل از استفاده با پول واقعی: حتما با Testnet
 * (https://testnet.binancefuture.com) تست کنید و Endpoint/پارامترها را
 * با مستندات رسمی به‌روز Binance مقایسه کنید.
 */
export class BinanceAdapter implements IExchangeAdapter {
  readonly exchangeId = 'binance';
  private readonly logger = new Logger(BinanceAdapter.name);
  private readonly rest: BinanceRestClient;
  private readonly wsManager: BinanceWsManager;

  constructor(private readonly config: ExchangeAccountConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Binance Adapter نیازمند apiKey و apiSecret است');
    }
    this.rest = new BinanceRestClient(
      { apiKey: config.apiKey, apiSecret: config.apiSecret },
      config.restBaseUrl,
    );
    this.wsManager = new BinanceWsManager(this.rest, config.wsBaseUrl);
  }

  async connectWebSocket(): Promise<void> {
    // اتصال اولیه User Data Stream. Ticker ها به‌صورت جداگانه با subscribeTicker وصل میشن.
    this.logger.log(`اتصال به Binance برای اکانت ${this.config.accountId}`);
  }

  async disconnectWebSocket(): Promise<void> {
    this.wsManager.disconnect();
  }

  isWebSocketHealthy(): boolean {
    return this.wsManager.isHealthy();
  }

  subscribeTicker(symbol: string, cb: (data: TickerData) => void): void {
    this.wsManager.connectTicker(symbol, cb).catch((err) => {
      this.logger.error(`خطا در اتصال Ticker Stream: ${err.message}`);
    });
  }

  unsubscribeTicker(symbol: string): void {
    // TODO: پیاده‌سازی کامل نیازمند مدیریت لیست Symbol های فعال در ReconnectingWsClient است
    this.logger.warn('unsubscribeTicker هنوز به‌طور کامل پیاده‌سازی نشده');
  }

  subscribePositionUpdates(
    accountId: string,
    cb: (data: PositionUpdate) => void,
  ): void {
    this.wsManager
      .connectUserDataStream((update) => cb({ ...update, accountId }))
      .catch((err) => {
        this.logger.error(`خطا در اتصال User Data Stream: ${err.message}`);
      });
  }

  async openPosition(params: OpenPositionParams): Promise<OrderResult> {
    const side = params.side === PositionSide.LONG ? 'BUY' : 'SELL';
    return this.executeOrder({
      symbol: toBinanceSymbol(params.symbol),
      side,
      quantity: params.quantity,
      reduceOnly: false,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async closePosition(params: ClosePositionParams): Promise<OrderResult> {
    // برای بستن پوزیشن Long باید SELL بزنیم، برای بستن Short باید BUY بزنیم
    const side = params.side === PositionSide.LONG ? 'SELL' : 'BUY';
    return this.executeOrder({
      symbol: toBinanceSymbol(params.symbol),
      side,
      quantity: params.quantity,
      reduceOnly: true,
      idempotencyKey: params.idempotencyKey,
    });
  }

  private async executeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    reduceOnly: boolean;
    idempotencyKey: string;
  }): Promise<OrderResult> {
    try {
      const response = await this.rest.placeOrder({
        symbol: params.symbol,
        side: params.side,
        type: 'MARKET',
        quantity: params.quantity,
        reduceOnly: params.reduceOnly,
        newClientOrderId: params.idempotencyKey,
      });

      return {
        exchangeOrderId: String(response.orderId),
        status: mapBinanceOrderStatus(response.status),
        filledQuantity: parseFloat(response.executedQty),
        avgFillPrice: parseFloat(response.avgPrice) || null,
        rawResponse: response,
      };
    } catch (err) {
      if (err instanceof ExchangeError && err.code === 'NETWORK_TIMEOUT') {
        // این حالت خطرناک‌ترین سناریوئه: نمیدونیم سفارش واقعا ثبت شده یا نه.
        // به همین دلیل status رو UNKNOWN برمی‌گردونیم تا لایه بالاتر (PositionExecutor
        // در فاز ۶) مجبور بشه با getPositionStatus وضعیت واقعی رو Reconcile کنه،
        // نه اینکه فرض کنه سفارش fail شده.
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

  async getPositionStatus(
    accountId: string,
    symbol: string,
  ): Promise<PositionStatus> {
    const binanceSymbol = toBinanceSymbol(symbol);
    const positions = await this.rest.getPositionRisk(binanceSymbol);
    const position = positions.find((p) => p.symbol === binanceSymbol);

    if (!position || parseFloat(position.positionAmt) === 0) {
      return {
        symbol,
        side: PositionSide.LONG, // بی‌معنی وقتی isOpen=false
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      };
    }

    const positionAmt = parseFloat(position.positionAmt);
    return {
      symbol,
      side: positionAmt >= 0 ? PositionSide.LONG : PositionSide.SHORT,
      isOpen: true,
      quantity: Math.abs(positionAmt),
      entryPrice: parseFloat(position.entryPrice) || null,
      unrealizedPnl: parseFloat(position.unRealizedProfit) || null,
    };
  }

  async getBalance(accountId: string): Promise<Balance[]> {
    const balances = await this.rest.getBalance();
    return balances
      .filter((b) => parseFloat(b.balance) > 0)
      .map((b) => ({
        asset: b.asset,
        free: parseFloat(b.availableBalance),
        locked: parseFloat(b.balance) - parseFloat(b.availableBalance),
      }));
  }
}
