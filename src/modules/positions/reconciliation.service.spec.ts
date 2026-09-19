import { ReconciliationService } from './reconciliation.service';
import { ArbitragePositionStatus } from './entities/arbitrage-position.entity';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let positionRepo: any;
  let legRepo: any;
  let exchangeAccountsService: any;
  let registry: any;
  let fakeAdapter: any;

  beforeEach(() => {
    positionRepo = { find: jest.fn() };
    legRepo = { save: jest.fn(async (data) => data) };
    exchangeAccountsService = {
      buildAdapterConfig: jest.fn().mockResolvedValue({
        accountId: 'account-a',
        exchangeId: 'binance',
        restBaseUrl: 'https://x',
        wsBaseUrl: 'wss://x',
      }),
    };
    fakeAdapter = { getPositionStatus: jest.fn() };
    registry = { getInstance: jest.fn().mockReturnValue(fakeAdapter) };

    service = new ReconciliationService(positionRepo, legRepo, exchangeAccountsService, registry);
  });

  const buildLeg = (overrides = {}) => ({
    id: 'leg-1',
    status: OrderStatus.FILLED,
    side: PositionSide.LONG,
    filledQuantity: '0.01',
    requestedQuantity: '0.01',
    avgFillPrice: '100',
    exchangeAccount: { id: 'account-a' },
    ...overrides,
  });

  const buildPosition = (legs: any[]) => ({
    id: 'position-1',
    symbol: 'BTC-USDT',
    status: ArbitragePositionStatus.OPEN,
    legs,
  });

  describe('reconcileAll', () => {
    it('باید فقط پوزیشن‌های OPEN/HEDGING/NEEDS_MANUAL_REVIEW را بررسی کند', async () => {
      positionRepo.find.mockResolvedValue([]);

      await service.reconcileAll();

      expect(positionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expect.anything() }),
        }),
      );
    });
  });

  describe('reconcilePosition — سناریوی دیتابیس باز، صرافی بسته', () => {
    it('اگر دیتابیس FILLED باشد ولی صرافی isOpen=false بدهد، باید leg را CANCELLED کند', async () => {
      const leg = buildLeg({ status: OrderStatus.FILLED });
      const position = buildPosition([leg]);
      fakeAdapter.getPositionStatus.mockResolvedValue({ isOpen: false });

      await service.reconcilePosition(position as any);

      expect(legRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.CANCELLED }),
      );
    });
  });

  describe('reconcilePosition — سناریوی UNKNOWN که در واقع باز شده (بازیابی از Timeout)', () => {
    it('اگر leg وضعیت UNKNOWN داشته باشد ولی صرافی بگوید واقعا باز است، باید به‌روزرسانی شود', async () => {
      const leg = buildLeg({ status: OrderStatus.UNKNOWN, filledQuantity: null });
      const position = buildPosition([leg]);
      fakeAdapter.getPositionStatus.mockResolvedValue({
        isOpen: true,
        quantity: 0.01,
        entryPrice: 100,
      });

      await service.reconcilePosition(position as any);

      expect(legRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.FILLED,
          filledQuantity: '0.01',
          avgFillPrice: '100',
        }),
      );
    });
  });

  describe('reconcilePosition — بدون ناهماهنگی', () => {
    it('اگر دیتابیس و صرافی هم‌راستا باشند نباید هیچ save ای انجام شود', async () => {
      const leg = buildLeg({ status: OrderStatus.FILLED });
      const position = buildPosition([leg]);
      fakeAdapter.getPositionStatus.mockResolvedValue({ isOpen: true });

      await service.reconcilePosition(position as any);

      expect(legRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('خطای شبکه هنگام Reconcile', () => {
    it('اگر adapter خطا بدهد، نباید کل فرآیند متوقف شود', async () => {
      const leg = buildLeg();
      const position = buildPosition([leg]);
      fakeAdapter.getPositionStatus.mockRejectedValue(new Error('Network error'));

      await expect(service.reconcilePosition(position as any)).resolves.not.toThrow();
    });
  });

  describe('handleInterval (جلوگیری از Overlap)', () => {
    it('اگر دور قبلی هنوز در جریان است، نباید دور جدید شروع شود', async () => {
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      positionRepo.find.mockImplementation(async () => {
        await firstPromise;
        return [];
      });

      const first = service.handleInterval();
      const second = service.handleInterval();

      await second;
      expect(positionRepo.find).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await first;
    });
  });
});
