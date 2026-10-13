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
 */
export interface IExchangeAdapter {
  readonly exchangeId: string;

  // --- اتصال ---
  connectWebSocket(): Promise<void>;
  disconnectWebSocket(): Promise<void>;
  isWebSocketHealthy(): boolean;

  // --- اشتراک در جریان داده ---

  // متدهای تکی (حفظ شده برای سازگاری به عقب یا تست روی یک ارز خاص)
  subscribeTicker(symbol: string, cb: (data: TickerData) => void): void;
  unsubscribeTicker(symbol: string): void;

  // 🌟 متدهای گروهی اضافه شده برای فاز مانیتورینگ وسیع 🌟
  // صرافی‌ها باید در قالب یک پیام WebSocket واحد (مثلا یک آرایه از نمادها) سابسکرایب کنند
  subscribeTickers(symbols: string[], cb: (data: TickerData) => void): void;
  unsubscribeTickers(symbols: string[]): void;

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
 * خطای استاندارد صرافی.
 */
export class ExchangeError extends Error {
  constructor(
    public readonly exchangeId: string,
    public readonly code:
      | 'RATE_LIMIT'
      | 'INSUFFICIENT_BALANCE'
      | 'NETWORK_TIMEOUT'
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
