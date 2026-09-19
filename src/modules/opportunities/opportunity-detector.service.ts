import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { StrategiesService } from '../strategies/strategies.service';
import {
  SpreadCalculatorService,
  TICKER_UPDATED_EVENT,
  TickerUpdatedPayload,
} from '../market-data/spread-calculator.service';
import { PositionExecutorService } from '../positions/position-executor.service';
import { RiskService } from '../risk/risk.service';
import { ArbitrageOpportunity, OpportunityOutcome } from './entities/arbitrage-opportunity.entity';
import { ArbitrageStrategy } from '../strategies/entities/arbitrage-strategy.entity';
import { isSpreadProfitable } from '../market-data/spread-calculation.util';

/** هر چند میلی‌ثانیه یک‌بار همه استراتژی‌های فعال چک بشن (Fallback؛ مسیر اصلی Event-driven است) */
export const OPPORTUNITY_CHECK_INTERVAL_MS = 5000;

/**
 * قلب "بررسی مداوم" که کاربر خواسته بود.
 *
 * دو مسیر موازی برای رسیدن به این هدف وجود داره:
 *
 * ۱) **Event-driven (مسیر اصلی، بدون تاخیر)**: هر بار که یک قیمت جدید
 *    از WebSocket صرافی می‌رسه (`TICKER_UPDATED_EVENT` از SpreadCalculatorService)،
 *    بلافاصله همون استراتژی‌هایی که به اون Symbol/صرافی مربوطن چک می‌شن —
 *    نه اینکه صبر کنیم تا Interval بعدی. این یعنی از لحظه‌ای که Spread واقعا
 *    به Threshold می‌رسه تا لحظه بررسی، عملاً تاخیری وجود نداره (فقط زمان
 *    پردازش، نه صبر برای Timer).
 *
 * ۲) **Interval (Fallback ایمنی، هر ۵ ثانیه)**: برای پوشش حالت‌هایی که یک
 *    Event به هر دلیلی از دست بره (مثلا خطای گذرا)، این Interval مثل قبل
 *    همه استراتژی‌های فعال رو دوره‌ای چک می‌کنه.
 *
 * هر نتیجه (چه اجرا بشه چه نشه) در ArbitrageOpportunity ثبت میشه —
 * این تنها راهیه که بعدا بفهمیم چرا یک فرصت خاص از دست رفت یا اجرا شد.
 */
@Injectable()
export class OpportunityDetectorService {
  private readonly logger = new Logger(OpportunityDetectorService.name);
  private isRunning = false; // جلوگیری از overlap در Interval
  // جلوگیری از چک هم‌زمان یک استراتژی از دو مسیر مختلف (Event و Interval)
  // یا از چند Event پشت‌سرهم که WebSocket ممکنه sub-second بفرسته
  private readonly checkingStrategyIds = new Set<string>();
  // Cache استراتژی‌های فعال؛ توسط Interval رفرش می‌شه و توسط Event Handler
  // برای جلوگیری از Query زدن به دیتابیس با هر تیک قیمت استفاده می‌شه
  private activeStrategiesCache: ArbitrageStrategy[] = [];

  constructor(
    private readonly strategiesService: StrategiesService,
    private readonly spreadCalculator: SpreadCalculatorService,
    private readonly positionExecutor: PositionExecutorService,
    private readonly riskService: RiskService,
    @InjectRepository(ArbitrageOpportunity)
    private readonly opportunityRepo: Repository<ArbitrageOpportunity>,
  ) {}

  @Interval(OPPORTUNITY_CHECK_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('دور قبلی هنوز در حال اجراست، این دور رد می‌شود');
      return;
    }
    this.isRunning = true;
    try {
      await this.checkAllActiveStrategies();
    } catch (err) {
      this.logger.error(`خطا در چرخه بررسی فرصت‌ها: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async checkAllActiveStrategies(): Promise<void> {
    const strategies = await this.strategiesService.findAllActive();
    this.activeStrategiesCache = strategies; // برای استفاده مسیر Event-driven
    // استراتژی‌ها مستقل از هم هستن، پس موازی چک می‌شن تا سرعت واکنش بالا بمونه
    await Promise.all(strategies.map((strategy) => this.checkStrategyGuarded(strategy)));
  }

  /**
   * مسیر اصلی Event-driven: با هر تیک قیمت جدید صدا زده میشه.
   * از Cache استراتژی‌های فعال استفاده می‌کنه (نه Query مستقیم دیتابیس)
   * چون این Handler ممکنه در ثانیه چندین بار صدا زده بشه.
   */
  @OnEvent(TICKER_UPDATED_EVENT)
  async onTickerUpdated(payload: TickerUpdatedPayload): Promise<void> {
    const matchingStrategies = this.activeStrategiesCache.filter(
      (s) =>
        s.symbol === payload.symbol &&
        (s.exchangeA.slug === payload.exchangeSlug || s.exchangeB.slug === payload.exchangeSlug),
    );

    await Promise.all(matchingStrategies.map((strategy) => this.checkStrategyGuarded(strategy)));
  }

  /** جلوگیری از چک هم‌زمان یک استراتژی از دو مسیر مختلف (Event/Interval) یا چند Event پشت‌سرهم */
  private async checkStrategyGuarded(strategy: ArbitrageStrategy): Promise<void> {
    if (this.checkingStrategyIds.has(strategy.id)) {
      return;
    }
    this.checkingStrategyIds.add(strategy.id);
    try {
      await this.checkStrategy(strategy);
    } finally {
      this.checkingStrategyIds.delete(strategy.id);
    }
  }

  async checkStrategy(strategy: ArbitrageStrategy): Promise<void> {
    let spreadResult;
    try {
      spreadResult = await this.spreadCalculator.getLiveSpread(
        strategy.symbol,
        strategy.exchangeA.slug,
        strategy.exchangeB.slug,
        parseFloat(strategy.takerFeeAPercent),
        parseFloat(strategy.takerFeeBPercent),
      );
    } catch (err) {
      // یعنی قیمت زنده هنوز موجود نیست (WebSocket تازه وصل شده یا قطع شده) — طبیعیه، فقط رد کن
      this.logger.debug(
        `قیمت زنده برای استراتژی ${strategy.id} در دسترس نیست: ${(err as Error).message}`,
      );
      return;
    }

    const minSpread = parseFloat(strategy.minSpreadPercent);
    const profitable = isSpreadProfitable(spreadResult, minSpread);

    if (!profitable) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.BELOW_THRESHOLD,
      }, strategy);
      return;
    }

    if (!strategy.autoExecute) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.DETECTED_NOT_EXECUTED,
      }, strategy);
      return;
    }

    // جلوگیری از باز کردن پوزیشن جدید وقتی از قبل یکی باز/در حال باز شدن هست
    const alreadyOpen = await this.positionExecutor.hasOpenPosition(strategy.id);
    if (alreadyOpen) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.SKIPPED_POSITION_OPEN,
      }, strategy);
      return;
    }

    // چک نهایی Risk Management (Kill Switch یا سقف پوزیشن هم‌زمان)
    const riskCheck = await this.riskService.canOpenNewPosition();
    if (!riskCheck.allowed) {
      await this.logOpportunity(
        strategy,
        spreadResult.bestDirection.netSpreadPercent,
        {
          buyOn: spreadResult.bestDirection.buyOn,
          sellOn: spreadResult.bestDirection.sellOn,
          outcome: OpportunityOutcome.RISK_BLOCKED,
        },
        strategy,
        null,
        riskCheck.reason,
      );
      return;
    }

    const execResult = await this.positionExecutor.openPairFromOpportunity(
      strategy,
      spreadResult.bestDirection,
    );

    if ('wasLocked' in execResult && execResult.wasLocked) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.SKIPPED_LOCKED,
      }, strategy);
      return;
    }

    const executionSucceeded = execResult.position.status === 'open';
    await this.riskService.recordExecutionOutcome(executionSucceeded);

    const outcome = executionSucceeded
      ? OpportunityOutcome.EXECUTED
      : OpportunityOutcome.EXECUTION_FAILED;

    await this.logOpportunity(
      strategy,
      spreadResult.bestDirection.netSpreadPercent,
      {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome,
      },
      strategy,
      execResult.position.id,
    );
  }

  private async logOpportunity(
    strategy: ArbitrageStrategy,
    netSpreadPercent: number,
    info: { buyOn: 'A' | 'B'; sellOn: 'A' | 'B'; outcome: OpportunityOutcome },
    strategyForSlug: ArbitrageStrategy,
    resultingPositionId: string | null = null,
    note: string | null = null,
  ): Promise<void> {
    const buySlug = info.buyOn === 'A' ? strategyForSlug.exchangeA.slug : strategyForSlug.exchangeB.slug;
    const sellSlug = info.sellOn === 'A' ? strategyForSlug.exchangeA.slug : strategyForSlug.exchangeB.slug;

    const record = this.opportunityRepo.create({
      strategy,
      netSpreadPercent: netSpreadPercent.toString(),
      buyOnExchangeSlug: buySlug,
      sellOnExchangeSlug: sellSlug,
      outcome: info.outcome,
      resultingPositionId,
      note,
    });

    await this.opportunityRepo.save(record);
  }
}
