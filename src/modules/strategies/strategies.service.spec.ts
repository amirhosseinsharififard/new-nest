import { ConflictException, NotFoundException } from '@nestjs/common';
import { StrategiesService } from './strategies.service';

describe('StrategiesService', () => {
  let service: StrategiesService;
  let strategyRepo: any;
  let exchangeRepo: any;
  let accountRepo: any;

  beforeEach(() => {
    strategyRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'strategy-1', ...data })),
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    exchangeRepo = { findOne: jest.fn() };
    accountRepo = { findOne: jest.fn() };

    service = new StrategiesService(strategyRepo, exchangeRepo, accountRepo);
  });

  const validDto = {
    symbol: 'BTC-USDT',
    exchangeAId: 'exchange-a',
    exchangeBId: 'exchange-b',
    minSpreadPercent: 0.5,
    maxPositionSize: 1000,
    orderQuantity: 0.01,
  };

  describe('create', () => {
    it('اگر exchangeA و exchangeB یکسان باشند باید ConflictException بدهد', async () => {
      await expect(
        service.create({ ...validDto, exchangeBId: 'exchange-a' }),
      ).rejects.toThrow(ConflictException);
    });

    it('اگر یکی از صرافی‌ها یافت نشود باید NotFoundException بدهد', async () => {
      exchangeRepo.findOne
        .mockResolvedValueOnce({ id: 'exchange-a' })
        .mockResolvedValueOnce(null);

      await expect(service.create(validDto)).rejects.toThrow(NotFoundException);
    });

    it('اگر استراتژی تکراری وجود داشته باشد باید ConflictException بدهد', async () => {
      exchangeRepo.findOne
        .mockResolvedValueOnce({ id: 'exchange-a' })
        .mockResolvedValueOnce({ id: 'exchange-b' });
      strategyRepo.findOne.mockResolvedValue({ id: 'existing-strategy' });

      await expect(service.create(validDto)).rejects.toThrow(ConflictException);
    });

    it('باید مقادیر عددی را به‌صورت string ذخیره کند', async () => {
      exchangeRepo.findOne
        .mockResolvedValueOnce({ id: 'exchange-a' })
        .mockResolvedValueOnce({ id: 'exchange-b' });
      strategyRepo.findOne.mockResolvedValue(null);

      await service.create(validDto);

      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          minSpreadPercent: '0.5',
          maxPositionSize: '1000',
          orderQuantity: '0.01',
          autoExecute: false,
        }),
      );
    });

    it('اگر autoExecute=true باشد ولی اکانتی مشخص نشده باشد باید ConflictException بدهد', async () => {
      exchangeRepo.findOne
        .mockResolvedValueOnce({ id: 'exchange-a' })
        .mockResolvedValueOnce({ id: 'exchange-b' });
      strategyRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...validDto, autoExecute: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('با autoExecute=true و هر دو اکانت معتبر باید با موفقیت ساخته شود', async () => {
      exchangeRepo.findOne
        .mockResolvedValueOnce({ id: 'exchange-a' })
        .mockResolvedValueOnce({ id: 'exchange-b' });
      strategyRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne
        .mockResolvedValueOnce({ id: 'account-a' })
        .mockResolvedValueOnce({ id: 'account-b' });

      await service.create({
        ...validDto,
        autoExecute: true,
        exchangeAAccountId: 'account-a',
        exchangeBAccountId: 'account-b',
      });

      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          autoExecute: true,
          exchangeAAccount: { id: 'account-a' },
          exchangeBAccount: { id: 'account-b' },
        }),
      );
    });

    it('اگر exchangeAAccountId نامعتبر باشد باید NotFoundException بدهد', async () => {
      exchangeRepo.findOne
        .mockResolvedValueOnce({ id: 'exchange-a' })
        .mockResolvedValueOnce({ id: 'exchange-b' });
      strategyRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          ...validDto,
          autoExecute: true,
          exchangeAAccountId: 'bad-id',
          exchangeBAccountId: 'account-b',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('اگر یافت نشود باید NotFoundException بدهد', async () => {
      strategyRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllActive', () => {
    it('باید فقط استراتژی‌های isActive=true را برگرداند', async () => {
      strategyRepo.find.mockResolvedValue([{ id: 's1', isActive: true }]);
      await service.findAllActive();

      expect(strategyRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        relations: ['exchangeA', 'exchangeB', 'exchangeAAccount', 'exchangeBAccount'],
      });
    });
  });

  describe('update', () => {
    it('باید فقط فیلدهای ارسال‌شده را به‌روزرسانی کند', async () => {
      strategyRepo.findOne.mockResolvedValue({
        id: 'strategy-1',
        minSpreadPercent: '0.5',
        isActive: true,
        autoExecute: false,
      });

      await service.update('strategy-1', { isActive: false });

      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, minSpreadPercent: '0.5' }),
      );
    });

    it('اگر بخواهند autoExecute را روشن کنند بدون اینکه اکانت‌ها قبلا ست شده باشند، باید خطا بدهد', async () => {
      strategyRepo.findOne.mockResolvedValue({
        id: 'strategy-1',
        exchangeAAccount: null,
        exchangeBAccount: null,
        autoExecute: false,
      });

      await expect(
        service.update('strategy-1', { autoExecute: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('اگر اکانت‌ها از قبل ست شده باشند، روشن کردن autoExecute باید موفق باشد', async () => {
      strategyRepo.findOne.mockResolvedValue({
        id: 'strategy-1',
        exchangeAAccount: { id: 'account-a' },
        exchangeBAccount: { id: 'account-b' },
        autoExecute: false,
      });

      await service.update('strategy-1', { autoExecute: true });

      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ autoExecute: true }),
      );
    });
  });

  describe('remove', () => {
    it('اگر استراتژی یافت نشود باید NotFoundException بدهد', async () => {
      strategyRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('با استراتژی معتبر باید حذف را انجام دهد', async () => {
      const strategy = { id: 'strategy-1' };
      strategyRepo.findOne.mockResolvedValue(strategy);

      await service.remove('strategy-1');

      expect(strategyRepo.remove).toHaveBeenCalledWith(strategy);
    });
  });
});
