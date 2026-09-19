import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskConfig } from './entities/risk-config.entity';
import { ArbitragePosition, ArbitragePositionStatus } from '../positions/entities/arbitrage-position.entity';

// شناسه ثابت رکورد Singleton
const RISK_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    @InjectRepository(RiskConfig)
    private readonly riskConfigRepo: Repository<RiskConfig>,
    @InjectRepository(ArbitragePosition)
    private readonly positionRepo: Repository<ArbitragePosition>,
  ) {}

  /** رکورد Config را برمی‌گرداند؛ اگر وجود نداشته باشد، با مقادیر پیش‌فرض می‌سازد */
  async getConfig(): Promise<RiskConfig> {
    let config = await this.riskConfigRepo.findOne({ where: { id: RISK_CONFIG_SINGLETON_ID } });
    if (!config) {
      config = this.riskConfigRepo.create({ id: RISK_CONFIG_SINGLETON_ID });
      config = await this.riskConfigRepo.save(config);
    }
    return config;
  }

  async updateConfig(updates: Partial<Pick<RiskConfig, 'maxConcurrentPositions' | 'consecutiveFailureLimit'>>): Promise<RiskConfig> {
    const config = await this.getConfig();
    if (updates.maxConcurrentPositions !== undefined) {
      config.maxConcurrentPositions = updates.maxConcurrentPositions;
    }
    if (updates.consecutiveFailureLimit !== undefined) {
      config.consecutiveFailureLimit = updates.consecutiveFailureLimit;
    }
    return this.riskConfigRepo.save(config);
  }

  async activateKillSwitch(reason: string): Promise<RiskConfig> {
    const config = await this.getConfig();
    config.killSwitchActive = true;
    config.killSwitchReason = reason;
    this.logger.warn(`🛑 Kill Switch فعال شد: ${reason}`);
    return this.riskConfigRepo.save(config);
  }

  async deactivateKillSwitch(): Promise<RiskConfig> {
    const config = await this.getConfig();
    config.killSwitchActive = false;
    config.killSwitchReason = null;
    config.consecutiveFailureCount = 0;
    this.logger.log('Kill Switch غیرفعال شد؛ شمارنده شکست‌ها ریست شد');
    return this.riskConfigRepo.save(config);
  }

  /**
   * بعد از هر تلاش اجرای پوزیشن (چه موفق چه ناموفق) این متد صدا زده میشه.
   * اگر شکست‌های پشت‌سرهم به حد نصاب برسه، Kill Switch خودکار فعال میشه.
   */
  async recordExecutionOutcome(success: boolean): Promise<void> {
    const config = await this.getConfig();

    if (success) {
      if (config.consecutiveFailureCount !== 0) {
        config.consecutiveFailureCount = 0;
        await this.riskConfigRepo.save(config);
      }
      return;
    }

    config.consecutiveFailureCount += 1;
    if (config.consecutiveFailureCount >= config.consecutiveFailureLimit) {
      config.killSwitchActive = true;
      config.killSwitchReason = `${config.consecutiveFailureCount} شکست اجرای پشت‌سرهم`;
      this.logger.error(
        `🛑 Kill Switch خودکار فعال شد: ${config.consecutiveFailureCount} شکست پشت‌سرهم`,
      );
    }
    await this.riskConfigRepo.save(config);
  }

  /**
   * چک نهایی قبل از باز کردن هر پوزیشن جدید. اگر false برگردونه،
   * OpportunityDetectorService نباید اجرا رو صدا بزنه.
   */
  async canOpenNewPosition(): Promise<{ allowed: boolean; reason?: string }> {
    const config = await this.getConfig();

    if (config.killSwitchActive) {
      return { allowed: false, reason: `Kill Switch فعال است: ${config.killSwitchReason}` };
    }

    const openCount = await this.positionRepo.count({
      where: [
        { status: ArbitragePositionStatus.OPEN },
        { status: ArbitragePositionStatus.OPENING },
        { status: ArbitragePositionStatus.HEDGING },
        { status: ArbitragePositionStatus.NEEDS_MANUAL_REVIEW },
      ],
    });

    if (openCount >= config.maxConcurrentPositions) {
      return {
        allowed: false,
        reason: `سقف پوزیشن‌های هم‌زمان پر است (${openCount}/${config.maxConcurrentPositions})`,
      };
    }

    return { allowed: true };
  }
}
