import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

// OKX از فرمت "BTC-USDT-SWAP" برای Perpetual Futures استفاده می‌کنه
export function toOkxSymbol(internalSymbol: string): string {
  return `${internalSymbol}-SWAP`;
}

export function fromOkxSymbol(okxSymbol: string): string {
  return okxSymbol.replace('-SWAP', '');
}

export function mapOkxOrderStatus(state: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    live: OrderStatus.SUBMITTED,
    partially_filled: OrderStatus.PARTIALLY_FILLED,
    filled: OrderStatus.FILLED,
    canceled: OrderStatus.CANCELLED,
  };
  return map[state] ?? OrderStatus.UNKNOWN;
}

export function mapOkxPositionSide(posSide: string, pos: number): PositionSide {
  if (posSide === 'long') return PositionSide.LONG;
  if (posSide === 'short') return PositionSide.SHORT;
  // در حالت net mode، علامت pos تعیین‌کننده جهته
  return pos >= 0 ? PositionSide.LONG : PositionSide.SHORT;
}
