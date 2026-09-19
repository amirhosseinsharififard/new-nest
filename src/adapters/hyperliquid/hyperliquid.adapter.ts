import { Logger } from '@nestjs/common';
import { IExchangeAdapter } from '../../core/exchange/exchange-adapter.interface';
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
import { HyperliquidInfoClient } from './hyperliquid.rest';
import { HyperliquidWsManager } from './hyperliquid.ws';
import { NktkasHyperliquidExchangeClient } from './hyperliquid.exchange-client';
import { mapHyperliquidPositionSide, toHyperliquidAsset } from './hyperliquid.mapper';

/**
 * Adapter برای Hyperliquid (اولین DEX Perpetual پیاده‌سازی‌شده در این پروژه).
 *
 * تفاوت کلیدی با CEX ها:
 * - "apiKey" وجود نداره؛ به‌جاش از publicKey (آدرس کیف‌پول) و privateKey
 *   (کلید خصوصی کیف‌پول) استفاده می‌کنیم که در ExchangeAccountConfig تعریف شده.
 * - عملیات نوشتنی (باز/بستن پوزیشن) با SDK رسمی امضا میشه، نه دستی.
 *
 * ⚠️ قبل از استفاده با پول واقعی حتما روی Testnet تست کنید و مطمئن بشید
 * SDK رسمی (@nktkas/hyperliquid) نصب و به‌روز است.
 */
export class HyperliquidAdapter implements IExchangeAdapter {
  readonly exchangeId = 'hyperliquid';
  private readonly logger = new Logger(HyperliquidAdapter.name);
  private readonly info: HyperliquidInfoClient;
  private readonly wsManager: HyperliquidWsManager;
  private readonly exchangeClient: NktkasHyperliquidExchangeClient;
  private readonly walletAddress: string;

  constructor(private readonly config: ExchangeAccountConfig) {
    if (!config.publicKey || !config.privateKey) {
      throw new Error(
        'Hyperliquid Adapter نیازمند publicKey (آدرس کیف‌پول) و privateKey (کلید خصوصی) است',
      );
    }
    this.walletAddress = config.publicKey;
    this.info = new HyperliquidInfoClient(config.restBaseUrl);
    this.wsManager = new HyperliquidWsManager(config.wsBaseUrl);
    this.exchangeClient = new NktkasHyperliquidExchangeClient(config.privateKey);
  }

  async connectWebSocket(): Promise<void> {
    this.logger.log(`اتصال به Hyperliquid برای کیف‌پول ${this.walletAddress}`);
  }

  async disconnectWebSocket(): Promise<void> {
    this.wsManager.disconnect();
  }

  isWebSocketHealthy(): boolean {
    return this.wsManager.isHealthy();
  }

  subscribeTicker(symbol: string, cb: (data: TickerData) => void): void {
    this.wsManager.connectTicker(toHyperliquidAsset(symbol), cb).catch((err) => {
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
    this.wsManager
      .subscribeAccount(this.walletAddress, (update) => cb({ ...update, accountId }))
      .catch((err) => {
        this.logger.error(`خطا در اتصال Account Stream: ${err.message}`);
      });
  }

  async openPosition(params: OpenPositionParams): Promise<OrderResult> {
    return this.executeOrder({
      asset: toHyperliquidAsset(params.symbol),
      isBuy: params.side === PositionSide.LONG,
      size: params.quantity,
      reduceOnly: false,
    });
  }

  async closePosition(params: ClosePositionParams): Promise<OrderResult> {
    // برای بستن Long باید Sell بزنیم، برای بستن Short باید Buy بزنیم
    return this.executeOrder({
      asset: toHyperliquidAsset(params.symbol),
      isBuy: params.side !== PositionSide.LONG,
      size: params.quantity,
      reduceOnly: true,
    });
  }

  private async executeOrder(params: {
    asset: string;
    isBuy: boolean;
    size: number;
    reduceOnly: boolean;
  }): Promise<OrderResult> {
    // نکته: Hyperliquid idempotency key جدا نمی‌گیره (خودش nonce مدیریت می‌کنه
    // در سطح SDK)، پس این پارامتر اینجا استفاده نمیشه.
    const result = await this.exchangeClient.placeMarketOrder(params);

    return {
      exchangeOrderId: String(result.orderId),
      status:
        result.status === 'filled'
          ? OrderStatus.FILLED
          : result.status === 'resting'
            ? OrderStatus.SUBMITTED
            : OrderStatus.UNKNOWN,
      filledQuantity: result.filledSize,
      avgFillPrice: result.avgPrice,
      rawResponse: result,
    };
  }

  async getPositionStatus(accountId: string, symbol: string): Promise<PositionStatus> {
    const asset = toHyperliquidAsset(symbol);
    const state = await this.info.getClearinghouseState(this.walletAddress);
    const found = state.assetPositions.find((p) => p.position.coin === asset);

    if (!found || parseFloat(found.position.szi) === 0) {
      return {
        symbol,
        side: PositionSide.LONG,
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      };
    }

    const szi = parseFloat(found.position.szi);
    return {
      symbol,
      side: mapHyperliquidPositionSide(szi),
      isOpen: true,
      quantity: Math.abs(szi),
      entryPrice: parseFloat(found.position.entryPx) || null,
      unrealizedPnl: parseFloat(found.position.unrealizedPnl) || null,
    };
  }

  async getBalance(accountId: string): Promise<Balance[]> {
    const state = await this.info.getClearinghouseState(this.walletAddress);
    // Hyperliquid فقط با USDC به‌عنوان Collateral کار می‌کنه (در Perp DEX Layer)
    return [
      {
        asset: 'USDC',
        free: parseFloat(state.withdrawable),
        locked:
          parseFloat(state.marginSummary.accountValue) - parseFloat(state.withdrawable),
      },
    ];
  }
}
