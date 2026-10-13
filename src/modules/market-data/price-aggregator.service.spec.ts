import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PriceAggregatorService } from './price-aggregator.service';
import { ExchangeRegistry } from '../../core/exchange/exchange-registry';
import { SpreadCalculatorService } from './spread-calculator.service';
import { IExchangeAdapter } from '../../core/exchange/exchange-adapter.interface';
import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';

describe('PriceAggregatorService', () => {
  let service: PriceAggregatorService;
  let registry: ExchangeRegistry;
  let spreadCalculator: SpreadCalculatorService;
  let eventEmitter: EventEmitter2;

  // ماک کردن Adapter صرافی با متدهای گروهی جدید
  const mockAdapter: Partial<IExchangeAdapter> = {
    subscribeTickers: jest.fn(),
    unsubscribeTickers: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceAggregatorService,
        {
          provide: ExchangeRegistry,
          useValue: {
            getInstance: jest.fn().mockReturnValue(mockAdapter),
          },
        },
        {
          provide: SpreadCalculatorService,
          useValue: {
            cacheTicker: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PriceAggregatorService>(PriceAggregatorService);
    registry = module.get<ExchangeRegistry>(ExchangeRegistry);
    spreadCalculator = module.get<SpreadCalculatorService>(SpreadCalculatorService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('watchSymbols (Batch Subscription)', () => {
    it('should subscribe to symbols, cache prices, and emit events', () => {
      const config = { exchangeId: 'binance', accountId: 'acc-1' } as ExchangeAccountConfig;
      const symbols = ['BTC-USDT'];

      // متغیری با مقدار اولیه برای جلوگیری از خطای TS2454
      let capturedCallback: any = null;

      // ضبط کردن Callback ای که به صرافی پاس داده می‌شود
      (mockAdapter.subscribeTickers as jest.Mock).mockImplementation((syms, cb) => {
        capturedCallback = cb;
      });

      // 1. فراخوانی متد سرویس
      service.watchSymbols(config, symbols);

      // 2. بررسی اینکه آیا متدِ صرافی به درستی صدا زده شده یا خیر
      expect(registry.getInstance).toHaveBeenCalledWith(config);
      expect(mockAdapter.subscribeTickers).toHaveBeenCalledWith(symbols, expect.any(Function));
      expect(service.isWatching('binance', 'BTC-USDT')).toBe(true);

      // 3. شبیه‌سازی دریافت قیمت جدید از صرافی (رسیدن داده از WebSocket)
      const tickerData = { exchangeId: 'binance', symbol: 'BTC-USDT', bidPrice: 100, askPrice: 101, timestamp: Date.now() };

      // اطمینان از اینکه Callback ضبط شده است
      expect(capturedCallback).not.toBeNull();
      capturedCallback!(tickerData);

      // 4. بررسی اینکه آیا در دیتابیس (Redis) ذخیره شد و ایونت شلیک شد
      expect(spreadCalculator.cacheTicker).toHaveBeenCalledWith('binance', tickerData);
      expect(eventEmitter.emit).toHaveBeenCalledWith('ticker.updated', {
        exchangeId: 'binance',
        symbol: 'BTC-USDT',
      });
    });
  });
});
