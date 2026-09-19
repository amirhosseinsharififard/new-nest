import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import {
  mapHyperliquidOrderStatus,
  mapHyperliquidPositionSide,
  toHyperliquidAsset,
} from './hyperliquid.mapper';

describe('Hyperliquid Mapper', () => {
  it('toHyperliquidAsset باید فقط اسم Coin را برگرداند (بدون Quote Asset)', () => {
    expect(toHyperliquidAsset('BTC-USDT')).toBe('BTC');
    expect(toHyperliquidAsset('ETH-USDC')).toBe('ETH');
  });

  it('mapHyperliquidPositionSide باید مقدار مثبت را LONG کند', () => {
    expect(mapHyperliquidPositionSide(1.5)).toBe(PositionSide.LONG);
  });

  it('mapHyperliquidPositionSide باید مقدار منفی را SHORT کند', () => {
    expect(mapHyperliquidPositionSide(-1.5)).toBe(PositionSide.SHORT);
  });

  it.each([
    ['resting', OrderStatus.SUBMITTED],
    ['filled', OrderStatus.FILLED],
    ['canceled', OrderStatus.CANCELLED],
    ['rejected', OrderStatus.FAILED],
    ['odd', OrderStatus.UNKNOWN],
  ])('mapHyperliquidOrderStatus باید "%s" را به %s تبدیل کند', (input, expected) => {
    expect(mapHyperliquidOrderStatus(input)).toBe(expected);
  });
});
