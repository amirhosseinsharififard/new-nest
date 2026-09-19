import { NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RedisMock = require('ioredis-mock');
import { RedisService } from '../../common/redis/redis.service';
import { SpreadCalculatorService, buildPriceCacheKey } from './spread-calculator.service';
import { TickerData } from '../../core/exchange/exchange.types';

describe('SpreadCalculatorService', () => {
  let service: SpreadCalculatorService;
  let redisService: RedisService;
  let client: any;
  let eventEmitter: any;

  beforeEach(() => {
    client = new RedisMock();
    redisService = new RedisService(client);
    eventEmitter = { emit: jest.fn() };
    service = new SpreadCalculatorService(redisService, eventEmitter);
  });

  afterEach(async () => {
    // ioredis-mock به‌طور پیش‌فرض داده را بین نمونه‌های مختلف به اشتراک می‌گذارد
    // (شبیه‌سازی یک سرور Redis واحد)، پس باید بعد از هر تست state را پاک کنیم.
    await client.flushall();
  });

  const buildTicker = (overrides: Partial<TickerData> = {}): TickerData => ({
    exchangeId: 'binance',
    symbol: 'BTC-USDT',
    bidPrice: 100,
    askPrice: 100.1,
    timestamp: Date.now(),
    ...overrides,
  });

  describe('cacheTicker / getCachedTicker', () => {
    it('باید یک Ticker را ذخیره و همان را برگرداند', async () => {
      const ticker = buildTicker();
      await service.cacheTicker('binance', ticker);

      const cached = await service.getCachedTicker('binance', 'BTC-USDT');
      expect(cached).toEqual(ticker);
    });

    it('اگر قیمتی Cache نشده باشد باید null برگرداند', async () => {
      const cached = await service.getCachedTicker('binance', 'NON-EXISTENT');
      expect(cached).toBeNull();
    });

    it('کلید Redis باید فرمت صحیح داشته باشد', () => {
      expect(buildPriceCacheKey('binance', 'BTC-USDT')).toBe('price:binance:BTC-USDT');
    });

    it('باید با هر cacheTicker یک TICKER_UPDATED_EVENT emit کند', async () => {
      const ticker = buildTicker({ exchangeId: 'binance', symbol: 'BTC-USDT' });
      await service.cacheTicker('binance', ticker);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'ticker.updated',
        expect.objectContaining({ exchangeSlug: 'binance', symbol: 'BTC-USDT' }),
      );
    });
  });

  describe('getLiveSpread', () => {
    it('باید با دو قیمت Cache شده، Spread صحیح محاسبه کند', async () => {
      await service.cacheTicker('binance', buildTicker({ exchangeId: 'binance', bidPrice: 100, askPrice: 100.1 }));
      await service.cacheTicker(
        'bybit',
        buildTicker({ exchangeId: 'bybit', bidPrice: 102, askPrice: 102.1 }),
      );

      const result = await service.getLiveSpread('BTC-USDT', 'binance', 'bybit', 0.04, 0.04);

      expect(result.bestDirection.buyOn).toBe('A');
      expect(result.bestDirection.sellOn).toBe('B');
      expect(result.bestDirection.netSpreadPercent).toBeGreaterThan(0);
    });

    it('اگر قیمت صرافی A موجود نباشد باید NotFoundException بدهد', async () => {
      await service.cacheTicker('bybit', buildTicker({ exchangeId: 'bybit' }));

      await expect(
        service.getLiveSpread('BTC-USDT', 'binance', 'bybit', 0.04, 0.04),
      ).rejects.toThrow(NotFoundException);
    });

    it('اگر قیمت صرافی B موجود نباشد باید NotFoundException بدهد', async () => {
      await service.cacheTicker('binance', buildTicker({ exchangeId: 'binance' }));

      await expect(
        service.getLiveSpread('BTC-USDT', 'binance', 'bybit', 0.04, 0.04),
      ).rejects.toThrow(NotFoundException);
    });

    it('اگر هیچ قیمتی موجود نباشد باید NotFoundException بدهد', async () => {
      await expect(
        service.getLiveSpread('BTC-USDT', 'binance', 'bybit', 0.04, 0.04),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
