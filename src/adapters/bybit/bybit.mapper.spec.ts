import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import {
  fromBybitSymbol,
  mapBybitOrderStatus,
  mapBybitPositionSide,
  toBybitSymbol,
} from './bybit.mapper';

describe('Bybit Mapper', () => {
  it('toBybitSymbol باید خط تیره را حذف کند', () => {
    expect(toBybitSymbol('BTC-USDT')).toBe('BTCUSDT');
  });

  it('fromBybitSymbol باید خط تیره را برگرداند', () => {
    expect(fromBybitSymbol('BTCUSDT')).toBe('BTC-USDT');
  });

  it.each([
    ['New', OrderStatus.SUBMITTED],
    ['PartiallyFilled', OrderStatus.PARTIALLY_FILLED],
    ['Filled', OrderStatus.FILLED],
    ['Cancelled', OrderStatus.CANCELLED],
    ['Rejected', OrderStatus.FAILED],
    ['WeirdStatus', OrderStatus.UNKNOWN],
  ])('mapBybitOrderStatus باید "%s" را به %s تبدیل کند', (input, expected) => {
    expect(mapBybitOrderStatus(input)).toBe(expected);
  });

  it('mapBybitPositionSide باید "Buy" را LONG کند', () => {
    expect(mapBybitPositionSide('Buy')).toBe(PositionSide.LONG);
  });

  it('mapBybitPositionSide باید "Sell" را SHORT کند', () => {
    expect(mapBybitPositionSide('Sell')).toBe(PositionSide.SHORT);
  });
});
