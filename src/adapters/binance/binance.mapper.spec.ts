import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import {
  fromBinanceSymbol,
  mapBinanceOrderStatus,
  mapBinancePositionSide,
  toBinanceSymbol,
} from './binance.mapper';

describe('Binance Mapper', () => {
  describe('toBinanceSymbol / fromBinanceSymbol', () => {
    it('باید نماد داخلی را به فرمت Binance تبدیل کند', () => {
      expect(toBinanceSymbol('BTC-USDT')).toBe('BTCUSDT');
    });

    it('باید فرمت Binance را به نماد داخلی برگرداند', () => {
      expect(fromBinanceSymbol('BTCUSDT')).toBe('BTC-USDT');
    });

    it('رفت‌وبرگشت باید نتیجه یکسان بدهد', () => {
      const original = 'ETH-USDT';
      expect(fromBinanceSymbol(toBinanceSymbol(original))).toBe(original);
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
      ['SOME_UNKNOWN_STATUS', OrderStatus.UNKNOWN],
    ])('باید وضعیت "%s" را به %s تبدیل کند', (input, expected) => {
      expect(mapBinanceOrderStatus(input)).toBe(expected);
    });
  });

  describe('mapBinancePositionSide', () => {
    it('باید مقدار مثبت را LONG تشخیص دهد', () => {
      expect(mapBinancePositionSide(0.5)).toBe(PositionSide.LONG);
    });

    it('باید مقدار منفی را SHORT تشخیص دهد', () => {
      expect(mapBinancePositionSide(-0.5)).toBe(PositionSide.SHORT);
    });

    it('باید صفر را LONG در نظر بگیرد (بدون پوزیشن باز)', () => {
      expect(mapBinancePositionSide(0)).toBe(PositionSide.LONG);
    });
  });
});
