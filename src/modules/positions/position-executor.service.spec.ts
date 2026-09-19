import { PositionExecutorService } from './position-executor.service';
import { ArbitragePositionStatus } from './entities/arbitrage-position.entity';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import { SpreadDirection } from '../market-data/spread-calculation.util';

describe('PositionExecutorService', () => {
  let service: PositionExecutorService;
  let positionRepo: any;
  let legRepo: any;
  let exchangeAccountsService: any;
  let registry: any;
  let redisService: any;
  let fakeAdapterA: any;
  let fakeAdapterB: any;

  const strategy: any = {
    id: 'strategy-1',
    symbol: 'BTC-USDT',
    orderQuantity: '0.01',
    exchangeAAccount: { id: 'account-a' },
    exchangeBAccount: { id: 'account-b' },
  };

  const directionAtoB: SpreadDirection = {
    buyOn: 'A',
    sellOn: 'B',
    buyPrice: 100,
    sellPrice: 102,
    grossSpreadPercent: 2,
    netSpreadPercent: 1.92,
  };

  const successResult = (overrides = {}) => ({
    exchangeOrderId: 'order-123',
    status: OrderStatus.FILLED,
    filledQuantity: 0.01,
    avgFillPrice: 100,
    ...overrides,
  });

  beforeEach(() => {
    positionRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: data.id ?? 'position-1', ...data })),
      count: jest.fn(),
      findOne: jest.fn(),
    };
    legRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'leg-' + Math.random(), ...data })),
    };
    exchangeAccountsService = {
      buildAdapterConfig: jest.fn(async (accountId: string) => ({
        accountId,
        exchangeId: accountId === 'account-a' ? 'binance' : 'bybit',
        restBaseUrl: 'https://x',
        wsBaseUrl: 'wss://x',
      })),
    };
    fakeAdapterA = { openPosition: jest.fn(), closePosition: jest.fn() };
    fakeAdapterB = { openPosition: jest.fn(), closePosition: jest.fn() };
    registry = {
      getInstance: jest.fn((config: any) =>
        config.accountId === 'account-a' ? fakeAdapterA : fakeAdapterB,
      ),
    };
    redisService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };

    service = new PositionExecutorService(
      positionRepo,
      legRepo,
      exchangeAccountsService,
      registry,
      redisService,
    );
  });

  describe('قفل Redis', () => {
    it('اگر قفل گرفته نشود، هیچ پوزیشنی نباید ساخته شود و wasLocked=true برگردد', async () => {
      redisService.acquireLock.mockResolvedValue(false);

      const result = await service.openPairFromOpportunity(strategy, directionAtoB);

      expect('wasLocked' in result && result.wasLocked).toBe(true);
      expect(positionRepo.save).not.toHaveBeenCalled();
    });

    it('بعد از اجرا (موفق یا ناموفق) باید قفل آزاد شود', async () => {
      fakeAdapterA.openPosition.mockResolvedValue(successResult());
      fakeAdapterB.openPosition.mockResolvedValue(successResult());

      await service.openPairFromOpportunity(strategy, directionAtoB);

      expect(redisService.releaseLock).toHaveBeenCalledWith(
        'lock:strategy-execution:strategy-1',
      );
    });
  });

  describe('سناریوی موفق (هر دو Leg باز شدند)', () => {
    it('باید side درست را بر اساس جهت Spread تعیین کند و پوزیشن را OPEN کند', async () => {
      fakeAdapterA.openPosition.mockResolvedValue(successResult());
      fakeAdapterB.openPosition.mockResolvedValue(successResult());

      const result: any = await service.openPairFromOpportunity(strategy, directionAtoB);

      // جهت buyOn:'A' یعنی روی A باید LONG باز بشه و روی B باید SHORT
      expect(fakeAdapterA.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ side: PositionSide.LONG }),
      );
      expect(fakeAdapterB.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ side: PositionSide.SHORT }),
      );
      expect(result.position.status).toBe(ArbitragePositionStatus.OPEN);
    });

    it('باید هر دو Leg را به‌صورت موازی (نه پشت‌سرهم) اجرا کند', async () => {
      const callOrder: string[] = [];
      fakeAdapterA.openPosition.mockImplementation(async () => {
        callOrder.push('A-start');
        await new Promise((r) => setTimeout(r, 20));
        callOrder.push('A-end');
        return successResult();
      });
      fakeAdapterB.openPosition.mockImplementation(async () => {
        callOrder.push('B-start');
        await new Promise((r) => setTimeout(r, 5));
        callOrder.push('B-end');
        return successResult();
      });

      await service.openPairFromOpportunity(strategy, directionAtoB);

      // اگر موازی باشه، B-end باید قبل از A-end بیاد (چون B سریع‌تره ولی هم‌زمان شروع شدن)
      expect(callOrder.indexOf('B-start')).toBeLessThan(callOrder.indexOf('A-end'));
    });
  });

  describe('سناریوی Hedge-Close (یک پا موفق، دیگری fail)', () => {
    it('اگر Leg B fail شود، باید Leg A (که موفق بوده) بسته شود', async () => {
      fakeAdapterA.openPosition.mockResolvedValue(successResult());
      fakeAdapterB.openPosition.mockRejectedValue(new Error('Insufficient balance'));
      fakeAdapterA.closePosition.mockResolvedValue(successResult());

      const result: any = await service.openPairFromOpportunity(strategy, directionAtoB);

      expect(fakeAdapterA.closePosition).toHaveBeenCalledWith(
        expect.objectContaining({ side: PositionSide.LONG, quantity: 0.01 }),
      );
      expect(result.position.status).toBe(ArbitragePositionStatus.FAILED);
    });

    it('اگر Leg A fail شود، باید Leg B (که موفق بوده) بسته شود', async () => {
      fakeAdapterA.openPosition.mockRejectedValue(new Error('Network error'));
      fakeAdapterB.openPosition.mockResolvedValue(successResult());
      fakeAdapterB.closePosition.mockResolvedValue(successResult());

      await service.openPairFromOpportunity(strategy, directionAtoB);

      expect(fakeAdapterB.closePosition).toHaveBeenCalledWith(
        expect.objectContaining({ side: PositionSide.SHORT }),
      );
    });
  });

  describe('سناریوی هر دو Fail', () => {
    it('نباید هیچ closePosition ای صدا زده شود و وضعیت FAILED باشد', async () => {
      fakeAdapterA.openPosition.mockRejectedValue(new Error('err A'));
      fakeAdapterB.openPosition.mockRejectedValue(new Error('err B'));

      const result: any = await service.openPairFromOpportunity(strategy, directionAtoB);

      expect(fakeAdapterA.closePosition).not.toHaveBeenCalled();
      expect(fakeAdapterB.closePosition).not.toHaveBeenCalled();
      expect(result.position.status).toBe(ArbitragePositionStatus.FAILED);
    });
  });

  describe('سناریوی UNKNOWN (Timeout) — نباید خودکار بسته شود', () => {
    it('اگر یکی از Legها UNKNOWN باشد، باید NEEDS_MANUAL_REVIEW شود و هیچ Hedge-Close ای انجام نشود', async () => {
      fakeAdapterA.openPosition.mockResolvedValue(
        successResult({ status: OrderStatus.UNKNOWN, filledQuantity: 0, avgFillPrice: null }),
      );
      fakeAdapterB.openPosition.mockResolvedValue(successResult());

      const result: any = await service.openPairFromOpportunity(strategy, directionAtoB);

      expect(fakeAdapterA.closePosition).not.toHaveBeenCalled();
      expect(fakeAdapterB.closePosition).not.toHaveBeenCalled();
      expect(result.position.status).toBe(ArbitragePositionStatus.NEEDS_MANUAL_REVIEW);
    });
  });

  describe('hasOpenPosition', () => {
    it('باید true برگرداند اگر پوزیشن باز/در حال باز شدن/نیازمند بررسی وجود داشته باشد', async () => {
      positionRepo.count.mockResolvedValue(1);
      const result = await service.hasOpenPosition('strategy-1');
      expect(result).toBe(true);
    });

    it('باید false برگرداند اگر هیچ پوزیشن فعالی نباشد', async () => {
      positionRepo.count.mockResolvedValue(0);
      const result = await service.hasOpenPosition('strategy-1');
      expect(result).toBe(false);
    });
  });

  describe('خطای پیکربندی', () => {
    it('اگر استراتژی اکانت معاملاتی نداشته باشد باید خطای واضح بدهد', async () => {
      const badStrategy = { ...strategy, exchangeAAccount: null };

      await expect(
        service.openPairFromOpportunity(badStrategy, directionAtoB),
      ).rejects.toThrow(/اکانت معاملاتی/);
    });
  });

  describe('closePair (بستن دستی جفت پوزیشن)', () => {
    const buildLeg = (overrides = {}) => ({
      id: 'leg-a',
      side: PositionSide.LONG,
      status: OrderStatus.FILLED,
      filledQuantity: '0.01',
      requestedQuantity: '0.01',
      exchangeAccount: { id: 'account-a' },
      position: { symbol: 'BTC-USDT' },
      ...overrides,
    });

    it('اگر پوزیشن یافت نشود باید NotFoundException بدهد', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      await expect(service.closePair('non-existent')).rejects.toThrow(/یافت نشد/);
    });

    it('اگر پوزیشن دقیقا دو Leg نداشته باشد باید ConflictException بدهد', async () => {
      positionRepo.findOne.mockResolvedValue({
        id: 'position-1',
        legs: [buildLeg()],
      });

      await expect(service.closePair('position-1')).rejects.toThrow(/دو Leg/);
    });

    it('با هر دو Leg موفق، باید هر دو را ببندد و وضعیت را CLOSED کند', async () => {
      const legA = buildLeg({ id: 'leg-a', exchangeAccount: { id: 'account-a' } });
      const legB = buildLeg({ id: 'leg-b', side: PositionSide.SHORT, exchangeAccount: { id: 'account-b' } });
      positionRepo.findOne.mockResolvedValue({ id: 'position-1', legs: [legA, legB] });
      fakeAdapterA.closePosition.mockResolvedValue(successResult());
      fakeAdapterB.closePosition.mockResolvedValue(successResult());

      const result = await service.closePair('position-1');

      expect(fakeAdapterA.closePosition).toHaveBeenCalled();
      expect(fakeAdapterB.closePosition).toHaveBeenCalled();
      expect(result.status).toBe(ArbitragePositionStatus.CLOSED);
    });

    it('اگر یکی از دو بستن fail شود، باید NEEDS_MANUAL_REVIEW شود', async () => {
      const legA = buildLeg({ id: 'leg-a', exchangeAccount: { id: 'account-a' } });
      const legB = buildLeg({ id: 'leg-b', side: PositionSide.SHORT, exchangeAccount: { id: 'account-b' } });
      positionRepo.findOne.mockResolvedValue({ id: 'position-1', legs: [legA, legB] });
      fakeAdapterA.closePosition.mockResolvedValue(successResult());
      fakeAdapterB.closePosition.mockRejectedValue(new Error('خطای شبکه'));

      const result = await service.closePair('position-1');

      expect(result.status).toBe(ArbitragePositionStatus.NEEDS_MANUAL_REVIEW);
    });
  });

  describe('closeSingleLeg (بستن دستی یک Leg)', () => {
    const buildLeg = (overrides = {}) => ({
      id: 'leg-a',
      side: PositionSide.LONG,
      status: OrderStatus.FILLED,
      filledQuantity: '0.01',
      requestedQuantity: '0.01',
      exchangeAccount: { id: 'account-a' },
      position: { symbol: 'BTC-USDT' },
      ...overrides,
    });

    it('اگر پوزیشن یافت نشود باید NotFoundException بدهد', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      await expect(service.closeSingleLeg('non-existent', 'leg-a')).rejects.toThrow(/یافت نشد/);
    });

    it('اگر Leg مورد نظر در این پوزیشن نباشد باید NotFoundException بدهد', async () => {
      positionRepo.findOne.mockResolvedValue({ id: 'position-1', legs: [buildLeg({ id: 'leg-x' })] });
      await expect(service.closeSingleLeg('position-1', 'leg-a')).rejects.toThrow(/Leg مورد نظر/);
    });

    it('اگر Leg دیگر همچنان باز باشد، پوزیشن باید HEDGING شود (نه CLOSED)', async () => {
      const legA = buildLeg({ id: 'leg-a' });
      const legB = buildLeg({ id: 'leg-b', status: OrderStatus.FILLED });
      positionRepo.findOne.mockResolvedValue({ id: 'position-1', legs: [legA, legB] });
      fakeAdapterA.closePosition.mockResolvedValue(successResult());

      await service.closeSingleLeg('position-1', 'leg-a');

      expect(positionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ArbitragePositionStatus.HEDGING }),
      );
    });

    it('اگر این آخرین Leg باز بود، پوزیشن باید CLOSED شود', async () => {
      const legA = buildLeg({ id: 'leg-a' });
      const legB = buildLeg({ id: 'leg-b', status: OrderStatus.CANCELLED });
      positionRepo.findOne.mockResolvedValue({ id: 'position-1', legs: [legA, legB] });
      fakeAdapterA.closePosition.mockResolvedValue(successResult());

      await service.closeSingleLeg('position-1', 'leg-a');

      expect(positionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ArbitragePositionStatus.CLOSED }),
      );
    });
  });
});
