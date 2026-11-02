
import {
  toGateIoSymbol,
  fromGateIoSymbol,
  mapGateIoOrderStatus,
  mapGateIoPositionSide,
  parseGateIoNumber,
} from './gateio.mapper';

import {
  OrderStatus,
  PositionSide,
} from 'src/core/exchange/exchange.types';

describe('GateIoMapper', () => {
  describe('toGateIoSymbol', () => {
    it('should convert internal symbol to Gate.io format', () => {
      expect(toGateIoSymbol('BTC-USDT')).toBe('BTC_USDT');
    });

    it('should replace multiple hyphens and slashes', () => {
      expect(toGateIoSymbol('BTC/USDT-PERP')).toBe('BTC_USDT_PERP');
    });

    it('should convert lowercase symbols to uppercase', () => {
      expect(toGateIoSymbol('btc-usdt')).toBe('BTC_USDT');
    });

    it('should handle symbols without separators', () => {
      expect(toGateIoSymbol('BTCUSDT')).toBe('BTCUSDT');
    });

    it('should handle empty strings', () => {
      expect(toGateIoSymbol('')).toBe('');
    });

    it('should handle symbols with mixed separators', () => {
      expect(toGateIoSymbol('btc/usdt-eth')).toBe('BTC_USDT_ETH');
    });
  });

  describe('fromGateIoSymbol', () => {
    it('should convert Gate.io symbol to internal format', () => {
      expect(fromGateIoSymbol('BTC_USDT')).toBe('BTC-USDT');
    });

    it('should convert lowercase symbols to uppercase', () => {
      expect(fromGateIoSymbol('btc_usdt')).toBe('BTC-USDT');
    });

    it('should replace only the trailing USDT separator', () => {
      expect(fromGateIoSymbol('BTC_USDT_USDT')).toBe('BTC_USDT-USDT');
    });

    it('should replace only the first underscore for non-USDT symbols', () => {
      expect(fromGateIoSymbol('BTC_ETH_PERP')).toBe('BTC-ETH_PERP');
    });

    it('should preserve symbols without underscores', () => {
      expect(fromGateIoSymbol('BTCUSDT')).toBe('BTCUSDT');
    });

    it('should handle empty strings', () => {
      expect(fromGateIoSymbol('')).toBe('');
    });

    it('should handle symbols containing lowercase quote assets', () => {
      expect(fromGateIoSymbol('btc_usdc')).toBe('BTC-USDC');
    });
  });

  describe('mapGateIoOrderStatus', () => {
    it('should map open status to SUBMITTED', () => {
      expect(mapGateIoOrderStatus('open')).toBe(OrderStatus.SUBMITTED);
    });

    it('should map finished status to FILLED', () => {
      expect(mapGateIoOrderStatus('finished')).toBe(OrderStatus.FILLED);
    });

    it('should map cancelled status to CANCELLED', () => {
      expect(mapGateIoOrderStatus('cancelled')).toBe(OrderStatus.CANCELLED);
    });

    it('should handle uppercase statuses', () => {
      expect(mapGateIoOrderStatus('OPEN')).toBe(OrderStatus.SUBMITTED);
      expect(mapGateIoOrderStatus('FINISHED')).toBe(OrderStatus.FILLED);
      expect(mapGateIoOrderStatus('CANCELLED')).toBe(OrderStatus.CANCELLED);
    });

    it('should handle mixed-case statuses', () => {
      expect(mapGateIoOrderStatus('Finished')).toBe(OrderStatus.FILLED);
    });

    it('should return UNKNOWN for unsupported statuses', () => {
      expect(mapGateIoOrderStatus('unknown')).toBe(OrderStatus.UNKNOWN);
      expect(mapGateIoOrderStatus('pending')).toBe(OrderStatus.UNKNOWN);
    });

    it('should return UNKNOWN for empty status', () => {
      expect(mapGateIoOrderStatus('')).toBe(OrderStatus.UNKNOWN);
    });
  });

  describe('mapGateIoPositionSide', () => {
    it('should map positive size to LONG', () => {
      expect(mapGateIoPositionSide(10)).toBe(PositionSide.LONG);
    });

    it('should map negative size to SHORT', () => {
      expect(mapGateIoPositionSide(-10)).toBe(PositionSide.SHORT);
    });

    it('should map zero size to LONG', () => {
      expect(mapGateIoPositionSide(0)).toBe(PositionSide.LONG);
    });

    it('should handle fractional positive size', () => {
      expect(mapGateIoPositionSide(0.001)).toBe(PositionSide.LONG);
    });

    it('should handle fractional negative size', () => {
      expect(mapGateIoPositionSide(-0.001)).toBe(PositionSide.SHORT);
    });
  });

  describe('parseGateIoNumber', () => {
    it('should parse numeric strings', () => {
      expect(parseGateIoNumber('123.45')).toBe(123.45);
    });

    it('should return numbers unchanged', () => {
      expect(parseGateIoNumber(123.45)).toBe(123.45);
    });

    it('should return zero for undefined', () => {
      expect(parseGateIoNumber(undefined)).toBe(0);
    });

    it('should return zero for null', () => {
      expect(parseGateIoNumber(null)).toBe(0);
    });

    it('should return zero for empty strings', () => {
      expect(parseGateIoNumber('')).toBe(0);
    });

    it('should parse zero values', () => {
      expect(parseGateIoNumber('0')).toBe(0);
      expect(parseGateIoNumber(0)).toBe(0);
    });

    it('should parse negative numbers', () => {
      expect(parseGateIoNumber('-12.5')).toBe(-12.5);
    });

    it('should return zero for invalid numeric strings', () => {
      expect(parseGateIoNumber('invalid')).toBe(0);
      expect(parseGateIoNumber('12abc')).toBe(0);
    });

    it('should return zero for Infinity', () => {
      expect(parseGateIoNumber('Infinity')).toBe(0);
      expect(parseGateIoNumber(Infinity)).toBe(0);
    });

    it('should return zero for NaN', () => {
      expect(parseGateIoNumber(NaN)).toBe(0);
    });

    it('should parse scientific notation', () => {
      expect(parseGateIoNumber('1e3')).toBe(1000);
    });
  });
});
