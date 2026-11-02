
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import {
  fromBybitSymbol,
  mapBybitOrderStatus,
  mapBybitPositionSide,
  toBybitSymbol,
} from './bybit.mapper';

describe('BybitMapper', () => {
  describe('toBybitSymbol', () => {
    it('should convert internal symbols to Bybit format', () => {
      expect(toBybitSymbol('BTC-USDT')).toBe('BTCUSDT');
    });

    it('should convert lowercase symbols to uppercase', () => {
      expect(toBybitSymbol('btc-usdt')).toBe('BTCUSDT');
    });

    it('should remove only the first hyphen', () => {
      expect(toBybitSymbol('BTC-USDT-PERP')).toBe('BTCUSDT-PERP');
    });

    it('should preserve symbols without hyphens', () => {
      expect(toBybitSymbol('BTCUSDT')).toBe('BTCUSDT');
    });

    it('should handle symbols with multiple hyphens', () => {
      expect(toBybitSymbol('btc-usdt-perp')).toBe('BTCUSDT-PERP');
    });

    it('should handle an empty string', () => {
      expect(toBybitSymbol('')).toBe('');
    });
  });

  describe('fromBybitSymbol', () => {
    it('should convert USDT symbols to internal format', () => {
      expect(fromBybitSymbol('BTCUSDT')).toBe('BTC-USDT');
    });

    it('should support a custom quote asset', () => {
      expect(fromBybitSymbol('ETHBTC', 'BTC')).toBe('ETH-BTC');
    });

    it('should preserve symbols without the quote asset suffix', () => {
      expect(fromBybitSymbol('BTCUSDC')).toBe('BTCUSDC');
    });

    it('should preserve symbols when the quote asset is not at the end', () => {
      expect(fromBybitSymbol('USDTBTC')).toBe('USDTBTC');
    });

    it('should handle an empty symbol', () => {
      expect(fromBybitSymbol('')).toBe('');
    });

    it('should handle an empty quote asset', () => {
      expect(fromBybitSymbol('BTCUSDT', '')).toBe('-');
    });
  });

  describe('mapBybitOrderStatus', () => {
    it.each([
      ['Created', OrderStatus.SUBMITTED],
      ['New', OrderStatus.SUBMITTED],
      ['PartiallyFilled', OrderStatus.PARTIALLY_FILLED],
      ['Filled', OrderStatus.FILLED],
      ['Cancelled', OrderStatus.CANCELLED],
      ['Rejected', OrderStatus.FAILED],
    ])('should map %s to the correct order status', (input, expected) => {
      expect(mapBybitOrderStatus(input)).toBe(expected);
    });

    it.each([
      '',
      'Unknown',
      'PendingCancel',
      'Deactivated',
      'PartiallyFilledCanceled',
      'created',
    ])('should return UNKNOWN for unsupported status: %s', (status) => {
      expect(mapBybitOrderStatus(status)).toBe(OrderStatus.UNKNOWN);
    });
  });

  describe('mapBybitPositionSide', () => {
    it('should map Buy to LONG', () => {
      expect(mapBybitPositionSide('Buy')).toBe(PositionSide.LONG);
    });

    it('should map Sell to SHORT', () => {
      expect(mapBybitPositionSide('Sell')).toBe(PositionSide.SHORT);
    });

    it('should map unknown values to SHORT according to implementation', () => {
      expect(mapBybitPositionSide('Unknown')).toBe(PositionSide.SHORT);
    });

    it('should map an empty string to SHORT according to implementation', () => {
      expect(mapBybitPositionSide('')).toBe(PositionSide.SHORT);
    });
  });
});
