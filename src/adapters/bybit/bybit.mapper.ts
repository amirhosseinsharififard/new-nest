import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

export function toBybitSymbol(internalSymbol: string): string {
  return internalSymbol.replace('-', '').toUpperCase();
}

export function fromBybitSymbol(bybitSymbol: string, quoteAsset = 'USDT'): string {
  if (bybitSymbol.endsWith(quoteAsset)) {
    const base = bybitSymbol.slice(0, -quoteAsset.length);
    return `${base}-${quoteAsset}`;
  }
  return bybitSymbol;
}

export function mapBybitOrderStatus(status: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    Created: OrderStatus.SUBMITTED,
    New: OrderStatus.SUBMITTED,
    PartiallyFilled: OrderStatus.PARTIALLY_FILLED,
    Filled: OrderStatus.FILLED,
    Cancelled: OrderStatus.CANCELLED,
    Rejected: OrderStatus.FAILED,
  };
  return map[status] ?? OrderStatus.UNKNOWN;
}

export function mapBybitPositionSide(side: string): PositionSide {
  return side === 'Buy' ? PositionSide.LONG : PositionSide.SHORT;
}
