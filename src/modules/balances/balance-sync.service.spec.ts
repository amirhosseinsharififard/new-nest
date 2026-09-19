import { BalanceSyncService } from './balance-sync.service';

describe('BalanceSyncService', () => {
  let service: BalanceSyncService;
  let balanceRepo: any;
  let accountRepo: any;
  let exchangeAccountsService: any;
  let registry: any;
  let fakeAdapter: any;

  beforeEach(() => {
    balanceRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };
    accountRepo = { find: jest.fn() };
    exchangeAccountsService = {
      buildAdapterConfig: jest.fn().mockResolvedValue({
        accountId: 'account-1',
        exchangeId: 'binance',
        restBaseUrl: 'https://x',
        wsBaseUrl: 'wss://x',
      }),
    };
    fakeAdapter = { getBalance: jest.fn() };
    registry = { getInstance: jest.fn().mockReturnValue(fakeAdapter) };

    service = new BalanceSyncService(balanceRepo, accountRepo, exchangeAccountsService, registry);
  });

  describe('syncAccount', () => {
    it('اگر رکورد قبلی برای Asset وجود نداشته باشد باید رکورد جدید بسازد', async () => {
      fakeAdapter.getBalance.mockResolvedValue([{ asset: 'USDT', free: 1000, locked: 50 }]);
      balanceRepo.findOne.mockResolvedValue(null);

      await service.syncAccount('account-1');

      expect(balanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ asset: 'USDT' }),
      );
      expect(balanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ free: '1000', locked: '50' }),
      );
    });

    it('اگر رکورد قبلی وجود داشته باشد باید همان را به‌روزرسانی کند (نه رکورد جدید)', async () => {
      fakeAdapter.getBalance.mockResolvedValue([{ asset: 'USDT', free: 900, locked: 0 }]);
      const existing = { id: 'balance-1', asset: 'USDT', free: '500', locked: '0' };
      balanceRepo.findOne.mockResolvedValue(existing);

      await service.syncAccount('account-1');

      expect(balanceRepo.create).not.toHaveBeenCalled();
      expect(balanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'balance-1', free: '900' }),
      );
    });

    it('باید برای چند Asset مختلف چند بار Upsert کند', async () => {
      fakeAdapter.getBalance.mockResolvedValue([
        { asset: 'USDT', free: 100, locked: 0 },
        { asset: 'BTC', free: 0.5, locked: 0.1 },
      ]);
      balanceRepo.findOne.mockResolvedValue(null);

      await service.syncAccount('account-1');

      expect(balanceRepo.save).toHaveBeenCalledTimes(2);
    });

    it('اگر گرفتن موجودی از صرافی خطا بدهد، نباید کل فرآیند متوقف شود', async () => {
      fakeAdapter.getBalance.mockRejectedValue(new Error('Network error'));

      await expect(service.syncAccount('account-1')).resolves.not.toThrow();
      expect(balanceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('syncAllActiveAccounts', () => {
    it('باید فقط اکانت‌های isActive=true را Sync کند', async () => {
      accountRepo.find.mockResolvedValue([{ id: 'account-1' }, { id: 'account-2' }]);
      fakeAdapter.getBalance.mockResolvedValue([]);

      await service.syncAllActiveAccounts();

      expect(accountRepo.find).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(exchangeAccountsService.buildAdapterConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleInterval (جلوگیری از Overlap)', () => {
    it('اگر دور قبلی هنوز در جریان است، نباید دور جدید اجرا شود', async () => {
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      accountRepo.find.mockImplementation(async () => {
        await firstPromise;
        return [];
      });

      const first = service.handleInterval();
      const second = service.handleInterval();

      await second;
      expect(accountRepo.find).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await first;
    });
  });
});
