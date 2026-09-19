import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

/**
 * تبدیل نماد داخلی (مثلا "BTC-USDT") به فرمت Binance ("BTCUSDT") و برعکس.
 * این تبدیل باید در symbol_mappings دیتابیس (فاز ۴) هم منعکس بشه؛
 * فعلا یک تبدیل ساده Rule-based کافیه.
 */
export function toBinanceSymbol(internalSymbol: string): string {
  return internalSymbol.replace('-', '').toUpperCase();
}

export function fromBinanceSymbol(binanceSymbol: string, quoteAsset = 'USDT'): string {
  if (binanceSymbol.endsWith(quoteAsset)) {
    const base = binanceSymbol.slice(0, -quoteAsset.length);
    return `${base}-${quoteAsset}`;
  }
  return binanceSymbol;
}

export function mapBinanceOrderStatus(status: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    NEW: OrderStatus.SUBMITTED,
    PARTIALLY_FILLED: OrderStatus.PARTIALLY_FILLED,
    FILLED: OrderStatus.FILLED,
    CANCELED: OrderStatus.CANCELLED,
    EXPIRED: OrderStatus.CANCELLED,
    REJECTED: OrderStatus.FAILED,
  };
  return map[status] ?? OrderStatus.UNKNOWN;
}

export function mapBinancePositionSide(positionAmt: number): PositionSide {
  return positionAmt >= 0 ? PositionSide.LONG : PositionSide.SHORT;
}
