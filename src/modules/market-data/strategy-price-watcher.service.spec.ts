import { StrategyPriceWatcherService } from './strategy-price-watcher.service';

describe('StrategyPriceWatcherService', () => {
  let service: StrategyPriceWatcherService;
  let strategiesService: any;
  let exchangeAccountsService: any;
  let priceAggregatorService: any;

  const buildStrategy = (overrides = {}) => ({
    id: 'strategy-1',
    symbol: 'BTC-USDT',
    exchangeAAccount: { id: 'account-a' },
    exchangeBAccount: { id: 'account-b' },
    ...overrides,
  });

  beforeEach(() => {
    strategiesService = { findAllActive: jest.fn() };
    exchangeAccountsService = {
      buildAdapterConfig: jest.fn(async (accountId: string) => ({
        accountId,
        exchangeId: accountId === 'account-a' ? 'binance' : 'bybit',
        restBaseUrl: 'https://x',
        wsBaseUrl: 'wss://x',
      })),
    };
    priceAggregatorService = { watchSymbol: jest.fn() };

    service = new StrategyPriceWatcherService(
      strategiesService,
      exchangeAccountsService,
      priceAggregatorService,
    );
  });

  describe('watchStrategy', () => {
    it('باید Config هر دو اکانت را بسازد و watchSymbol را برای هر دو صدا بزند', async () => {
      await service.watchStrategy('BTC-USDT', 'account-a', 'account-b');

      expect(exchangeAccountsService.buildAdapterConfig).toHaveBeenCalledWith('account-a');
      expect(exchangeAccountsService.buildAdapterConfig).toHaveBeenCalledWith('account-b');
      expect(priceAggregatorService.watchSymbol).toHaveBeenCalledTimes(2);
      expect(priceAggregatorService.watchSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'account-a' }),
        'BTC-USDT',
      );
      expect(priceAggregatorService.watchSymbol).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'account-b' }),
        'BTC-USDT',
      );
    });
  });

  describe('ensureWatchingAllActiveStrategies', () => {
    it('باید همه استراتژی‌های فعال با هر دو اکانت مشخص را watch کند', async () => {
      strategiesService.findAllActive.mockResolvedValue([
        buildStrategy({ id: 's1', symbol: 'BTC-USDT' }),
        buildStrategy({ id: 's2', symbol: 'ETH-USDT' }),
      ]);

      await service.ensureWatchingAllActiveStrategies();

      // هر استراتژی یعنی ۲ فراخوانی watchSymbol (یکی برای هر صرافی)
      expect(priceAggregatorService.watchSymbol).toHaveBeenCalledTimes(4);
    });

    it('باید استراتژی‌هایی که اکانت معاملاتی ندارند را نادیده بگیرد', async () => {
      strategiesService.findAllActive.mockResolvedValue([
        buildStrategy({ id: 's1', exchangeAAccount: null }),
        buildStrategy({ id: 's2', exchangeBAccount: null }),
        buildStrategy({ id: 's3' }), // این یکی کامله
      ]);

      await service.ensureWatchingAllActiveStrategies();

      expect(priceAggregatorService.watchSymbol).toHaveBeenCalledTimes(2); // فقط s3
    });

    it('اگر هیچ استراتژی فعالی نباشد نباید هیچ watchSymbol ای صدا زده شود', async () => {
      strategiesService.findAllActive.mockResolvedValue([]);

      await service.ensureWatchingAllActiveStrategies();

      expect(priceAggregatorService.watchSymbol).not.toHaveBeenCalled();
    });
  });

  describe('handleInterval', () => {
    it('اگر خطا رخ بدهد نباید کل اپلیکیشن متوقف شود', async () => {
      strategiesService.findAllActive.mockRejectedValue(new Error('DB down'));

      await expect(service.handleInterval()).resolves.not.toThrow();
    });
  });
});
