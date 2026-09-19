import { OpportunityDetectorService } from './opportunity-detector.service';
import { OpportunityOutcome } from './entities/arbitrage-opportunity.entity';
import { ArbitragePositionStatus } from '../positions/entities/arbitrage-position.entity';

describe('OpportunityDetectorService', () => {
  let service: OpportunityDetectorService;
  let strategiesService: any;
  let spreadCalculator: any;
  let positionExecutor: any;
  let riskService: any;
  let opportunityRepo: any;

  const buildStrategy = (overrides = {}): any => ({
    id: 'strategy-1',
    symbol: 'BTC-USDT',
    minSpreadPercent: '1.0',
    takerFeeAPercent: '0.04',
    takerFeeBPercent: '0.04',
    autoExecute: false,
    exchangeA: { slug: 'binance' },
    exchangeB: { slug: 'bybit' },
    ...overrides,
  });

  const buildSpreadResult = (netSpreadPercent: number) => ({
    symbol: 'BTC-USDT',
    bestDirection: {
      buyOn: 'A' as const,
      sellOn: 'B' as const,
      buyPrice: 100,
      sellPrice: 102,
      grossSpreadPercent: 2,
      netSpreadPercent,
    },
    bothDirections: [],
    timestamp: Date.now(),
  });

  beforeEach(() => {
    strategiesService = { findAllActive: jest.fn() };
    spreadCalculator = { getLiveSpread: jest.fn() };
    positionExecutor = {
      hasOpenPosition: jest.fn().mockResolvedValue(false),
      openPairFromOpportunity: jest.fn(),
    };
    riskService = {
      canOpenNewPosition: jest.fn().mockResolvedValue({ allowed: true }),
      recordExecutionOutcome: jest.fn().mockResolvedValue(undefined),
    };
    opportunityRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };

    service = new OpportunityDetectorService(
      strategiesService,
      spreadCalculator,
      positionExecutor,
      riskService,
      opportunityRepo,
    );
  });

  describe('checkStrategy', () => {
    it('اگر قیمت زنده در دسترس نباشد، نباید خطا پرتاب کند و فقط رد شود', async () => {
      const strategy = buildStrategy();
      spreadCalculator.getLiveSpread.mockRejectedValue(new Error('قیمت موجود نیست'));

      await expect(service.checkStrategy(strategy)).resolves.not.toThrow();
      expect(opportunityRepo.save).not.toHaveBeenCalled();
    });

    it('اگر Spread زیر Threshold باشد، باید BELOW_THRESHOLD ثبت شود و اجرا نشود', async () => {
      const strategy = buildStrategy({ minSpreadPercent: '2.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.0));

      await service.checkStrategy(strategy);

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: OpportunityOutcome.BELOW_THRESHOLD }),
      );
      expect(positionExecutor.openPairFromOpportunity).not.toHaveBeenCalled();
    });

    it('اگر سودآور باشد ولی autoExecute خاموش باشد، باید DETECTED_NOT_EXECUTED ثبت شود', async () => {
      const strategy = buildStrategy({ autoExecute: false, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));

      await service.checkStrategy(strategy);

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: OpportunityOutcome.DETECTED_NOT_EXECUTED }),
      );
      expect(positionExecutor.openPairFromOpportunity).not.toHaveBeenCalled();
    });

    it('اگر سودآور و autoExecute روشن باشد، باید PositionExecutor اجرا شود', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      positionExecutor.openPairFromOpportunity.mockResolvedValue({
        position: { id: 'position-1', status: ArbitragePositionStatus.OPEN },
        wasLocked: false,
      });

      await service.checkStrategy(strategy);

      expect(positionExecutor.openPairFromOpportunity).toHaveBeenCalledWith(
        strategy,
        expect.objectContaining({ netSpreadPercent: 1.92 }),
      );
      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: OpportunityOutcome.EXECUTED,
          resultingPositionId: 'position-1',
        }),
      );
    });

    it('اگر اجرا با خطا/شکست مواجه شود، باید EXECUTION_FAILED ثبت شود', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      positionExecutor.openPairFromOpportunity.mockResolvedValue({
        position: { id: 'position-1', status: ArbitragePositionStatus.FAILED },
        wasLocked: false,
      });

      await service.checkStrategy(strategy);

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: OpportunityOutcome.EXECUTION_FAILED }),
      );
    });

    it('اگر از قبل پوزیشن باز/در حال اجرایی برای این استراتژی باشد، نباید دوباره اجرا کند', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      positionExecutor.hasOpenPosition.mockResolvedValue(true);

      await service.checkStrategy(strategy);

      expect(positionExecutor.openPairFromOpportunity).not.toHaveBeenCalled();
      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: OpportunityOutcome.SKIPPED_POSITION_OPEN }),
      );
    });

    it('اگر قفل گرفته نشود (اجرای هم‌زمان دیگری در جریان است)، باید SKIPPED_LOCKED ثبت شود', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      positionExecutor.openPairFromOpportunity.mockResolvedValue({ wasLocked: true });

      await service.checkStrategy(strategy);

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: OpportunityOutcome.SKIPPED_LOCKED }),
      );
    });

    it('اگر Risk Management اجازه ندهد، باید RISK_BLOCKED ثبت شود و اجرا نشود', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      riskService.canOpenNewPosition.mockResolvedValue({
        allowed: false,
        reason: 'Kill Switch فعال است',
      });

      await service.checkStrategy(strategy);

      expect(positionExecutor.openPairFromOpportunity).not.toHaveBeenCalled();
      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: OpportunityOutcome.RISK_BLOCKED }),
      );
    });

    it('بعد از اجرای موفق باید recordExecutionOutcome(true) صدا زده شود', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      positionExecutor.openPairFromOpportunity.mockResolvedValue({
        position: { id: 'position-1', status: ArbitragePositionStatus.OPEN },
        wasLocked: false,
      });

      await service.checkStrategy(strategy);

      expect(riskService.recordExecutionOutcome).toHaveBeenCalledWith(true);
    });

    it('بعد از اجرای ناموفق باید recordExecutionOutcome(false) صدا زده شود', async () => {
      const strategy = buildStrategy({ autoExecute: true, minSpreadPercent: '1.0' });
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(1.92));
      positionExecutor.openPairFromOpportunity.mockResolvedValue({
        position: { id: 'position-1', status: ArbitragePositionStatus.FAILED },
        wasLocked: false,
      });

      await service.checkStrategy(strategy);

      expect(riskService.recordExecutionOutcome).toHaveBeenCalledWith(false);
    });
  });

  describe('checkAllActiveStrategies', () => {
    it('باید همه استراتژی‌های فعال را (به‌صورت موازی) چک کند', async () => {
      const strategies = [buildStrategy({ id: 's1' }), buildStrategy({ id: 's2' })];
      strategiesService.findAllActive.mockResolvedValue(strategies);
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(0.1));

      await service.checkAllActiveStrategies();

      expect(spreadCalculator.getLiveSpread).toHaveBeenCalledTimes(2);
    });

    it('اگر یک استراتژی خطا بدهد، نباید بقیه را متوقف کند', async () => {
      const strategies = [buildStrategy({ id: 's1' }), buildStrategy({ id: 's2' })];
      strategiesService.findAllActive.mockResolvedValue(strategies);
      spreadCalculator.getLiveSpread
        .mockRejectedValueOnce(new Error('fail on s1'))
        .mockResolvedValueOnce(buildSpreadResult(0.1));

      await expect(service.checkAllActiveStrategies()).resolves.not.toThrow();
    });
  });

  describe('onTickerUpdated (مسیر Event-driven)', () => {
    it('باید فقط استراتژی‌هایی که symbol و exchange منطبق دارند را چک کند', async () => {
      const matchingStrategy = buildStrategy({ id: 's1', symbol: 'BTC-USDT' });
      const otherSymbolStrategy = buildStrategy({ id: 's2', symbol: 'ETH-USDT' });
      const otherExchangeStrategy = buildStrategy({
        id: 's3',
        symbol: 'BTC-USDT',
        exchangeA: { slug: 'okx' },
        exchangeB: { slug: 'hyperliquid' },
      });

      strategiesService.findAllActive.mockResolvedValue([
        matchingStrategy,
        otherSymbolStrategy,
        otherExchangeStrategy,
      ]);
      spreadCalculator.getLiveSpread.mockRejectedValue(new Error('not ready yet'));
      await service.checkAllActiveStrategies(); // برای پر شدن Cache
      spreadCalculator.getLiveSpread.mockClear();
      spreadCalculator.getLiveSpread.mockResolvedValue(buildSpreadResult(0.1));

      await service.onTickerUpdated({ exchangeSlug: 'binance', symbol: 'BTC-USDT' });

      // فقط matchingStrategy باید چک بشه (exchangeA.slug='binance' و symbol یکسان)
      expect(spreadCalculator.getLiveSpread).toHaveBeenCalledTimes(1);
    });

    it('اگر هیچ استراتژی منطبقی نباشد نباید هیچ چکی انجام شود', async () => {
      strategiesService.findAllActive.mockResolvedValue([buildStrategy({ symbol: 'ETH-USDT' })]);
      spreadCalculator.getLiveSpread.mockRejectedValue(new Error('not ready yet'));
      await service.checkAllActiveStrategies();
      spreadCalculator.getLiveSpread.mockClear();

      await service.onTickerUpdated({ exchangeSlug: 'binance', symbol: 'BTC-USDT' });

      expect(spreadCalculator.getLiveSpread).not.toHaveBeenCalled();
    });
  });

  describe('checkStrategyGuarded (جلوگیری از چک هم‌زمان یک استراتژی)', () => {
    it('اگر یک استراتژی همزمان در حال چک شدن باشد، فراخوانی دوم باید نادیده گرفته شود', async () => {
      const strategy = buildStrategy({ id: 's1' });
      strategiesService.findAllActive.mockResolvedValue([strategy]);
      spreadCalculator.getLiveSpread.mockRejectedValue(new Error('not ready yet'));
      await service.checkAllActiveStrategies();
      spreadCalculator.getLiveSpread.mockClear(); // پاک کردن تاریخچه فراخوانی مربوط به مرحله populate کردن Cache

      let resolveSpread: (value: any) => void;
      spreadCalculator.getLiveSpread.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSpread = resolve;
          }),
      );

      // یک تیک قیمت باعث شروع چک میشه که هنوز تموم نشده
      const firstCheck = service.onTickerUpdated({ exchangeSlug: 'binance', symbol: 'BTC-USDT' });
      // بلافاصله یک تیک دیگه هم می‌رسه (شبیه‌سازی WS پرسرعت)
      const secondCheck = service.onTickerUpdated({ exchangeSlug: 'binance', symbol: 'BTC-USDT' });

      resolveSpread!(buildSpreadResult(0.1));
      await Promise.all([firstCheck, secondCheck]);

      // getLiveSpread فقط یک‌بار باید صدا زده شده باشه، نه دوبار
      expect(spreadCalculator.getLiveSpread).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleInterval (جلوگیری از Overlap)', () => {
    it('اگر دور قبلی هنوز در حال اجراست، نباید دور جدید اجرا شود', async () => {
      let resolveFirst: () => void;
      const firstCallPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      strategiesService.findAllActive.mockImplementation(async () => {
        await firstCallPromise;
        return [];
      });

      const firstCall = service.handleInterval();
      const secondCall = service.handleInterval(); // باید فورا برگرده چون isRunning=true

      await secondCall;
      expect(strategiesService.findAllActive).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await firstCall;
    });
  });
});
