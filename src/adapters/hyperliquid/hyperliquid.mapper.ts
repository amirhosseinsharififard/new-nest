import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

// در Hyperliquid نماد داخلی asset معمولا فقط اسم Coin است، مثلا "BTC" (نه BTC-USDT)
export function toHyperliquidAsset(internalSymbol: string): string {
  return internalSymbol.split('-')[0];
}

export function mapHyperliquidPositionSide(szi: number): PositionSide {
  return szi >= 0 ? PositionSide.LONG : PositionSide.SHORT;
}

export function mapHyperliquidOrderStatus(status: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    resting: OrderStatus.SUBMITTED,
    filled: OrderStatus.FILLED,
    canceled: OrderStatus.CANCELLED,
    rejected: OrderStatus.FAILED,
  };
  return map[status] ?? OrderStatus.UNKNOWN;
}
