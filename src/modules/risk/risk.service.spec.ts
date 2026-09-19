import { RiskService } from './risk.service';

describe('RiskService', () => {
  let service: RiskService;
  let riskConfigRepo: any;
  let positionRepo: any;

  const defaultConfig = () => ({
    id: '00000000-0000-0000-0000-000000000001',
    maxConcurrentPositions: 5,
    consecutiveFailureLimit: 3,
    consecutiveFailureCount: 0,
    killSwitchActive: false,
    killSwitchReason: null,
  });

  beforeEach(() => {
    riskConfigRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => ({ ...defaultConfig(), ...data })),
      save: jest.fn(async (data) => data),
    };
    positionRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    service = new RiskService(riskConfigRepo, positionRepo);
  });

  describe('getConfig', () => {
    it('اگر رکورد وجود نداشته باشد باید با مقادیر پیش‌فرض بسازد', async () => {
      riskConfigRepo.findOne.mockResolvedValue(null);

      const config = await service.getConfig();

      expect(riskConfigRepo.save).toHaveBeenCalled();
      expect(config.maxConcurrentPositions).toBe(5);
    });

    it('اگر رکورد وجود داشته باشد باید همان را برگرداند (نه ساخت رکورد جدید)', async () => {
      riskConfigRepo.findOne.mockResolvedValue(defaultConfig());

      await service.getConfig();

      expect(riskConfigRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('canOpenNewPosition', () => {
    it('اگر Kill Switch فعال باشد باید allowed=false برگرداند', async () => {
      riskConfigRepo.findOne.mockResolvedValue(
        defaultConfig() && { ...defaultConfig(), killSwitchActive: true, killSwitchReason: 'test' },
      );

      const result = await service.canOpenNewPosition();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill Switch');
    });

    it('اگر تعداد پوزیشن‌های باز به سقف رسیده باشد باید allowed=false برگرداند', async () => {
      riskConfigRepo.findOne.mockResolvedValue({ ...defaultConfig(), maxConcurrentPositions: 2 });
      positionRepo.count.mockResolvedValue(2);

      const result = await service.canOpenNewPosition();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('سقف');
    });

    it('اگر هیچ محدودیتی فعال نباشد باید allowed=true برگرداند', async () => {
      riskConfigRepo.findOne.mockResolvedValue(defaultConfig());
      positionRepo.count.mockResolvedValue(1);

      const result = await service.canOpenNewPosition();

      expect(result.allowed).toBe(true);
    });
  });

  describe('recordExecutionOutcome', () => {
    it('با success=true باید شمارنده شکست را صفر کند', async () => {
      riskConfigRepo.findOne.mockResolvedValue({ ...defaultConfig(), consecutiveFailureCount: 2 });

      await service.recordExecutionOutcome(true);

      expect(riskConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailureCount: 0 }),
      );
    });

    it('با success=false باید شمارنده شکست را یکی افزایش دهد', async () => {
      riskConfigRepo.findOne.mockResolvedValue({ ...defaultConfig(), consecutiveFailureCount: 1 });

      await service.recordExecutionOutcome(false);

      expect(riskConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailureCount: 2, killSwitchActive: false }),
      );
    });

    it('وقتی شمارنده شکست به حد نصاب برسد، باید Kill Switch خودکار فعال شود', async () => {
      riskConfigRepo.findOne.mockResolvedValue({
        ...defaultConfig(),
        consecutiveFailureCount: 2,
        consecutiveFailureLimit: 3,
      });

      await service.recordExecutionOutcome(false);

      expect(riskConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailureCount: 3, killSwitchActive: true }),
      );
    });
  });

  describe('activateKillSwitch / deactivateKillSwitch', () => {
    it('activateKillSwitch باید killSwitchActive=true و reason را ست کند', async () => {
      riskConfigRepo.findOne.mockResolvedValue(defaultConfig());

      const result = await service.activateKillSwitch('توقف دستی توسط ادمین');

      expect(result.killSwitchActive).toBe(true);
      expect(result.killSwitchReason).toBe('توقف دستی توسط ادمین');
    });

    it('deactivateKillSwitch باید killSwitchActive=false و شمارنده را صفر کند', async () => {
      riskConfigRepo.findOne.mockResolvedValue({
        ...defaultConfig(),
        killSwitchActive: true,
        consecutiveFailureCount: 5,
      });

      const result = await service.deactivateKillSwitch();

      expect(result.killSwitchActive).toBe(false);
      expect(result.consecutiveFailureCount).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('باید فقط فیلدهای ارسال‌شده را به‌روزرسانی کند', async () => {
      riskConfigRepo.findOne.mockResolvedValue(defaultConfig());

      await service.updateConfig({ maxConcurrentPositions: 10 });

      expect(riskConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ maxConcurrentPositions: 10, consecutiveFailureLimit: 3 }),
      );
    });
  });
});
