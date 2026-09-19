import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import { mapOkxOrderStatus, mapOkxPositionSide, toOkxSymbol, fromOkxSymbol } from './okx.mapper';

describe('OKX Mapper', () => {
  it('toOkxSymbol باید پسوند SWAP اضافه کند', () => {
    expect(toOkxSymbol('BTC-USDT')).toBe('BTC-USDT-SWAP');
  });

  it('fromOkxSymbol باید پسوند SWAP را حذف کند', () => {
    expect(fromOkxSymbol('BTC-USDT-SWAP')).toBe('BTC-USDT');
  });

  it.each([
    ['live', OrderStatus.SUBMITTED],
    ['partially_filled', OrderStatus.PARTIALLY_FILLED],
    ['filled', OrderStatus.FILLED],
    ['canceled', OrderStatus.CANCELLED],
    ['weird', OrderStatus.UNKNOWN],
  ])('mapOkxOrderStatus باید "%s" را به %s تبدیل کند', (input, expected) => {
    expect(mapOkxOrderStatus(input)).toBe(expected);
  });

  it('mapOkxPositionSide باید در حالت long/short mode مقدار posSide را در نظر بگیرد', () => {
    expect(mapOkxPositionSide('long', 5)).toBe(PositionSide.LONG);
    expect(mapOkxPositionSide('short', 5)).toBe(PositionSide.SHORT);
  });

  it('mapOkxPositionSide باید در حالت net mode بر اساس علامت pos تصمیم بگیرد', () => {
    expect(mapOkxPositionSide('net', 5)).toBe(PositionSide.LONG);
    expect(mapOkxPositionSide('net', -5)).toBe(PositionSide.SHORT);
  });
});
