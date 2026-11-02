
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import {
  toHyperliquidAsset,
  mapHyperliquidPositionSide,
  mapHyperliquidOrderStatus,
} from './hyperliquid.mapper';

describe('Hyperliquid Mapper', () => {
  describe('toHyperliquidAsset', () => {
    it('should convert BTC-USDT to BTC', () => {
      expect(toHyperliquidAsset('BTC-USDT')).toBe('BTC');
    });

    it('should return the first part of a symbol containing multiple hyphens', () => {
      expect(toHyperliquidAsset('BTC-USDT-PERP')).toBe('BTC');
    });

    it('should return the original symbol when no hyphen exists', () => {
      expect(toHyperliquidAsset('BTC')).toBe('BTC');
    });

    it('should return an empty string when the input starts with a hyphen', () => {
      expect(toHyperliquidAsset('-USDT')).toBe('');
    });

    it('should preserve the original casing', () => {
      expect(toHyperliquidAsset('btc-usdt')).toBe('btc');
    });
  });

  describe('mapHyperliquidPositionSide', () => {
    it('should map positive size to LONG', () => {
      expect(mapHyperliquidPositionSide(1)).toBe(PositionSide.LONG);
    });

    it('should map negative size to SHORT', () => {
      expect(mapHyperliquidPositionSide(-1)).toBe(PositionSide.SHORT);
    });

    it('should map zero size to LONG', () => {
      expect(mapHyperliquidPositionSide(0)).toBe(PositionSide.LONG);
    });

    it('should map negative zero to LONG', () => {
      expect(mapHyperliquidPositionSide(-0)).toBe(PositionSide.LONG);
    });
  });

  describe('mapHyperliquidOrderStatus', () => {
    it.each([
      ['resting', OrderStatus.SUBMITTED],
      ['filled', OrderStatus.FILLED],
      ['canceled', OrderStatus.CANCELLED],
      ['rejected', OrderStatus.FAILED],
    ])('should map %s status correctly', (status, expected) => {
      expect(mapHyperliquidOrderStatus(status)).toBe(expected);
    });

    it.each([
      'open',
      'cancelled',
      'pending',
      'unknown',
      '',
    ])('should map unsupported status "%s" to UNKNOWN', (status) => {
      expect(mapHyperliquidOrderStatus(status)).toBe(OrderStatus.UNKNOWN);
    });

    it('should be case-sensitive', () => {
      expect(mapHyperliquidOrderStatus('FILLED')).toBe(OrderStatus.UNKNOWN);
    });
  });
});
