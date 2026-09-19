import {
  Balance,
  ClosePositionParams,
  OpenPositionParams,
  OrderResult,
  PositionStatus,
  PositionUpdate,
  TickerData,
} from './exchange.types';

/**
 * قرارداد مشترکی که هر صرافی جدید باید پیاده‌سازی کنه.
 * Core Engine فقط با این Interface کار می‌کنه، هیچ‌وقت مستقیم با
 * کلاس Binance/Bybit/... سروکار نداره.
 *
 * نکته مهم: تمام متدها باید Error handling داخلی داشته باشن و
 * هیچ‌وقت Exception خام صرافی (مثلا axios error) رو مستقیم throw نکنن.
 * باید به یک نوع استاندارد (مثلا ExchangeError) تبدیل بشه.
 */
export interface IExchangeAdapter {
  readonly exchangeId: string;

  // --- اتصال ---
  connectWebSocket(): Promise<void>;
  disconnectWebSocket(): Promise<void>;
  isWebSocketHealthy(): boolean;

  // --- اشتراک در جریان داده ---
  subscribeTicker(symbol: string, cb: (data: TickerData) => void): void;
  unsubscribeTicker(symbol: string): void;
  subscribePositionUpdates(
    accountId: string,
    cb: (data: PositionUpdate) => void,
  ): void;

  // --- عملیات معاملاتی ---
  openPosition(params: OpenPositionParams): Promise<OrderResult>;
  closePosition(params: ClosePositionParams): Promise<OrderResult>;

  // --- استعلام وضعیت (برای Reconciliation) ---
  getPositionStatus(
    accountId: string,
    symbol: string,
  ): Promise<PositionStatus>;
  getBalance(accountId: string): Promise<Balance[]>;
}

/**
 * خطای استاندارد صرافی. هر Adapter باید خطاهای خودش رو
 * به این فرمت تبدیل کنه تا Core بتونه یکسان تصمیم بگیره.
 */
export class ExchangeError extends Error {
  constructor(
    public readonly exchangeId: string,
    public readonly code:
      | 'RATE_LIMIT'
      | 'INSUFFICIENT_BALANCE'
      | 'NETWORK_TIMEOUT' // این کد خیلی مهمه: یعنی وضعیت واقعی نامشخصه
      | 'INVALID_PARAMS'
      | 'AUTH_ERROR'
      | 'UNKNOWN',
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}
