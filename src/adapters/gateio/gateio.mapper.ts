
import {
  OrderStatus,
  PositionSide,
} from 'src/core/exchange/exchange.types';

/**
 * تبدیل نماد داخلی BTC-USDT به فرمت قرارداد Gate.io یعنی BTC_USDT
 */
export function toGateIoSymbol(internalSymbol: string): string {
  return internalSymbol
    .replace(/[-/]/g, '_')
    .toUpperCase();
}

/**
 * تبدیل نماد Gate.io یعنی BTC_USDT به نماد داخلی BTC-USDT
 */
export function fromGateIoSymbol(gateSymbol: string): string {
  const normalized = gateSymbol.toUpperCase();

  if (normalized.endsWith('_USDT')) {
    return normalized.replace(/_USDT$/, '-USDT');
  }

  return normalized.replace('_', '-');
}

/**
 * تبدیل وضعیت سفارش Gate.io به وضعیت استاندارد پروژه
 */
export function mapGateIoOrderStatus(status: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    open: OrderStatus.SUBMITTED,
    finished: OrderStatus.FILLED,
    cancelled: OrderStatus.CANCELLED,
  };

  return map[status.toLowerCase()] ?? OrderStatus.UNKNOWN;
}

/**
 * تعیین جهت پوزیشن بر اساس اندازه پوزیشن
 */
export function mapGateIoPositionSide(size: number): PositionSide {
  return size >= 0 ? PositionSide.LONG : PositionSide.SHORT;
}

/**
 * تبدیل مقدار عددی دریافتی از API
 */
export function parseGateIoNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
