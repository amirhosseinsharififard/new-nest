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

/** How often to check all active strategies (Fallback; Main path is Event-driven) */
export const OPPORTUNITY_CHECK_INTERVAL_MS = 5000;

/**
 * The core engine for detecting arbitrage opportunities.
 *
 * It uses two parallel paths:
 *
 * 1) **Event-driven (Primary, Zero-latency)**: Whenever a new price arrives
 *    via WebSocket (`TICKER_UPDATED_EVENT`), matching strategies are checked
 *    instantly. This ensures zero delay between threshold breach and execution.
 *
 * 2) **Interval (Fallback, every 5s)**: Ensures no opportunity is missed if an
 *    event is dropped (e.g., transient network issues).
 *
 * Every detection attempt (executed or skipped) is logged in ArbitrageOpportunity
 * for audit and historical analysis.
 */
@Injectable()
export class OpportunityDetectorService {
  private readonly logger = new Logger(OpportunityDetectorService.name);
  private isRunning = false; // Prevents overlap in the interval loop

  // In-memory lock to prevent checking the same strategy simultaneously
  // from both Event and Interval paths, or from rapid sequential events.
  private readonly checkingStrategyIds = new Set<string>();

  // Cache of active strategies, refreshed by the interval to prevent
  // hitting the DB on every single high-frequency tick.
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
      this.logger.debug('Previous interval cycle is still running, skipping...');
      return;
    }
    this.isRunning = true;
    try {
      await this.checkAllActiveStrategies();
    } catch (err) {
      this.logger.error(`Error in opportunity interval cycle: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async checkAllActiveStrategies(): Promise<void> {
    const strategies = await this.strategiesService.findAllActive();
    this.activeStrategiesCache = strategies; // Update cache for event-driven path

    // Strategies are independent, so we check them in parallel for speed
    await Promise.all(strategies.map((strategy) => this.checkStrategyGuarded(strategy)));
  }

  /**
   * Main Event-driven path: Triggered on every new price tick.
   * Uses the cached strategies to avoid DB queries.
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

  /** Guards against concurrent checks of the same strategy */
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
      // Live price is not yet available in Redis (e.g., WS just connected). Skip.
      this.logger.debug(
        `Live price not available for strategy ${strategy.id}: ${(err as Error).message}`,
      );
      return;
    }

    const minSpread = parseFloat(strategy.minSpreadPercent);
    const profitable = isSpreadProfitable(spreadResult, minSpread);

    if (!profitable) {
      // Do not log every single below-threshold tick in DB to prevent DB bloat.
      // Alternatively, throttle this log or only log if it was previously profitable.
      // For now, we return early to save DB IO.
      return;
    }

    if (!strategy.autoExecute) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.DETECTED_NOT_EXECUTED,
      });
      return;
    }

    // Check if a position is already open for this strategy
    const alreadyOpen = await this.positionExecutor.hasOpenPosition(strategy.id);
    if (alreadyOpen) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.SKIPPED_POSITION_OPEN,
      });
      return;
    }

    // Global Risk Management Check (Kill Switch, Max Concurrent Positions)
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
        null,
        riskCheck.reason,
      );
      return;
    }

    // Hand over to PositionExecutorService (which MUST use a Redis Lock)
    const execResult = await this.positionExecutor.openPairFromOpportunity(
      strategy,
      spreadResult.bestDirection,
    );

    if ('wasLocked' in execResult && execResult.wasLocked) {
      await this.logOpportunity(strategy, spreadResult.bestDirection.netSpreadPercent, {
        buyOn: spreadResult.bestDirection.buyOn,
        sellOn: spreadResult.bestDirection.sellOn,
        outcome: OpportunityOutcome.SKIPPED_LOCKED,
      });
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
      execResult.position.id,
    );
  }

  private async logOpportunity(
    strategy: ArbitrageStrategy,
    netSpreadPercent: number,
    info: { buyOn: 'A' | 'B'; sellOn: 'A' | 'B'; outcome: OpportunityOutcome },
    resultingPositionId: string | null = null,
    note: string | null = null,
  ): Promise<void> {
    const buySlug = info.buyOn === 'A' ? strategy.exchangeA.slug : strategy.exchangeB.slug;
    const sellSlug = info.sellOn === 'A' ? strategy.exchangeA.slug : strategy.exchangeB.slug;

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
