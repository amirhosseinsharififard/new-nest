import {
  toOkxSymbol,
  fromOkxSymbol,
  mapOkxOrderStatus,
  mapOkxPositionSide,
} from './okx.mapper';

import {
  OrderStatus,
  PositionSide,
} from '../../core/exchange/exchange.types';

describe('OKX Mapper', () => {
  describe('toOkxSymbol', () => {
    it('should convert BTC-USDT to BTC-USDT-SWAP', () => {
      expect(toOkxSymbol('BTC-USDT')).toBe('BTC-USDT-SWAP');
    });

    it('should convert ETH-USDT to ETH-USDT-SWAP', () => {
      expect(toOkxSymbol('ETH-USDT')).toBe('ETH-USDT-SWAP');
    });

    it('should preserve the original symbol format', () => {
      expect(toOkxSymbol('BTC')).toBe('BTC-SWAP');
    });

    it('should handle an empty symbol', () => {
      expect(toOkxSymbol('')).toBe('-SWAP');
    });
  });

  describe('fromOkxSymbol', () => {
    it('should remove the SWAP suffix', () => {
      expect(fromOkxSymbol('BTC-USDT-SWAP')).toBe('BTC-USDT');
    });

    it('should remove SWAP suffix from ETH symbol', () => {
      expect(fromOkxSymbol('ETH-USDT-SWAP')).toBe('ETH-USDT');
    });

    it('should preserve symbols without SWAP suffix', () => {
      expect(fromOkxSymbol('BTC-USDT')).toBe('BTC-USDT');
    });

    it('should remove the first matching SWAP suffix', () => {
      expect(fromOkxSymbol('BTC-SWAP-USDT-SWAP')).toBe(
        'BTC-USDT-SWAP',
      );
    });
  });

  describe('mapOkxOrderStatus', () => {
    it.each([
      ['live', OrderStatus.SUBMITTED],
      ['partially_filled', OrderStatus.PARTIALLY_FILLED],
      ['filled', OrderStatus.FILLED],
      ['canceled', OrderStatus.CANCELLED],
    ])('should map %s to the correct status', (state, expected) => {
      expect(mapOkxOrderStatus(state)).toBe(expected);
    });

    it.each([
      'unknown',
      'pending',
      'cancelled',
      '',
      'LIVE',
    ])('should return UNKNOWN for unsupported state: %s', (state) => {
      expect(mapOkxOrderStatus(state)).toBe(OrderStatus.UNKNOWN);
    });
  });

  describe('mapOkxPositionSide', () => {
    it('should map long position explicitly', () => {
      expect(mapOkxPositionSide('long', -1)).toBe(PositionSide.LONG);
    });

    it('should map short position explicitly', () => {
      expect(mapOkxPositionSide('short', 1)).toBe(PositionSide.SHORT);
    });

    it('should use positive position size as long in net mode', () => {
      expect(mapOkxPositionSide('net', 2)).toBe(PositionSide.LONG);
    });

    it('should use negative position size as short in net mode', () => {
      expect(mapOkxPositionSide('net', -2)).toBe(PositionSide.SHORT);
    });

    it('should treat zero position size as long in net mode', () => {
      expect(mapOkxPositionSide('net', 0)).toBe(PositionSide.LONG);
    });

    it('should use position sign for unknown position mode', () => {
      expect(mapOkxPositionSide('unknown', -1)).toBe(PositionSide.SHORT);
      expect(mapOkxPositionSide('unknown', 1)).toBe(PositionSide.LONG);
    });
  });
});
