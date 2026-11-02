
import {
  fromBinanceSymbol,
  mapBinanceOrderStatus,
  mapBinancePositionSide,
  toBinanceSymbol,
} from './binance.mapper';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

describe('BinanceMapper', () => {
  describe('toBinanceSymbol', () => {
    it('should convert internal symbols to Binance format', () => {
      expect(toBinanceSymbol('BTC-USDT')).toBe('BTCUSDT');
    });

    it('should convert lowercase symbols to uppercase', () => {
      expect(toBinanceSymbol('btc-usdt')).toBe('BTCUSDT');
    });

    it('should support symbols without separators', () => {
      expect(toBinanceSymbol('BTCUSDT')).toBe('BTCUSDT');
    });

    it('should remove only the first hyphen', () => {
      expect(toBinanceSymbol('BTC-USDT-PERP')).toBe('BTCUSDT-PERP');
    });

    it('should handle empty strings', () => {
      expect(toBinanceSymbol('')).toBe('');
    });
  });

  describe('fromBinanceSymbol', () => {
    it('should convert USDT symbols to internal format', () => {
      expect(fromBinanceSymbol('BTCUSDT')).toBe('BTC-USDT');
    });

    it('should support custom quote assets', () => {
      expect(fromBinanceSymbol('ETHBTC', 'BTC')).toBe('ETH-BTC');
    });

    it('should return the original symbol when quote asset does not match', () => {
      expect(fromBinanceSymbol('BTCUSDC')).toBe('BTCUSDC');
    });

    it('should handle symbols equal to the quote asset', () => {
      expect(fromBinanceSymbol('USDT')).toBe('-USDT');
    });

    it('should handle empty symbols', () => {
      expect(fromBinanceSymbol('')).toBe('');
    });
  });

  describe('mapBinanceOrderStatus', () => {
    it.each([
      ['NEW', OrderStatus.SUBMITTED],
      ['PARTIALLY_FILLED', OrderStatus.PARTIALLY_FILLED],
      ['FILLED', OrderStatus.FILLED],
      ['CANCELED', OrderStatus.CANCELLED],
      ['EXPIRED', OrderStatus.CANCELLED],
      ['REJECTED', OrderStatus.FAILED],
    ])('should map Binance status %s correctly', (input, expected) => {
      expect(mapBinanceOrderStatus(input)).toBe(expected);
    });

    it.each([
      'PENDING',
      'UNKNOWN_STATUS',
      '',
      'new',
      'PARTIALLY_CANCELLED',
    ])('should return UNKNOWN for unsupported status: %s', (status) => {
      expect(mapBinanceOrderStatus(status)).toBe(OrderStatus.UNKNOWN);
    });
  });

  describe('mapBinancePositionSide', () => {
    it('should return LONG for positive position amounts', () => {
      expect(mapBinancePositionSide(1)).toBe(PositionSide.LONG);
    });

    it('should return SHORT for negative position amounts', () => {
      expect(mapBinancePositionSide(-1)).toBe(PositionSide.SHORT);
    });

    it('should return LONG for zero position amounts', () => {
      expect(mapBinancePositionSide(0)).toBe(PositionSide.LONG);
    });

    it('should handle fractional position amounts', () => {
      expect(mapBinancePositionSide(-0.001)).toBe(PositionSide.SHORT);
    });
  });
});
