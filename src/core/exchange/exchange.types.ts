/**
 * این فایل مدل‌های داده مشترک بین همه صرافی‌ها رو تعریف می‌کنه.
 * هیچ Adapter ای حق نداره فرمت خام صرافی خودش رو مستقیم به Core بده،
 * همیشه باید از طریق Mapper به این مدل‌ها تبدیل بشه.
 */

export enum PositionSide {
  LONG = 'long',
  SHORT = 'short',
}

export enum OrderStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  FILLED = 'filled',
  PARTIALLY_FILLED = 'partially_filled',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  UNKNOWN = 'unknown', // برای حالت Timeout که وضعیت واقعی نامشخصه
}

export interface TickerData {
  exchangeId: string;
  symbol: string; // نماد نرمالایز شده داخلی، مثلا "BTC-USDT"
  bidPrice: number;
  askPrice: number;
  timestamp: number;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

export interface OpenPositionParams {
  accountId: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  leverage?: number;
  idempotencyKey: string;
}

export interface ClosePositionParams {
  accountId: string;
  symbol: string;
  side: PositionSide; // سمتی که باید بسته بشه
  quantity: number;
  idempotencyKey: string;
}

export interface OrderResult {
  exchangeOrderId: string | null;
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice: number | null;
  rawResponse?: unknown; // برای دیباگ، هیچ‌وقت مستقیم استفاده نشه در منطق تصمیم‌گیری
}

export interface PositionUpdate {
  exchangeId: string;
  accountId: string;
  symbol: string;
  side: PositionSide;
  status: OrderStatus;
  quantity: number;
  entryPrice: number | null;
  timestamp: number;
}

export interface PositionStatus {
  symbol: string;
  side: PositionSide;
  isOpen: boolean;
  quantity: number;
  entryPrice: number | null;
  unrealizedPnl: number | null;
}
