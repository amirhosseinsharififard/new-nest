import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ArbitragePosition, ArbitragePositionStatus } from './entities/arbitrage-position.entity';
import { PositionLeg } from './entities/position-leg.entity';
import { ArbitrageStrategy } from '../strategies/entities/arbitrage-strategy.entity';
import { ExchangeAccountsService } from '../exchange-accounts/exchange-accounts.service';
import { ExchangeRegistry } from '../../core/exchange/exchange-registry';
import { RedisService } from '../../common/redis/redis.service';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';
import { SpreadDirection } from '../market-data/spread-calculation.util';

const LOCK_TTL_SECONDS = 30;

export interface OpenPairResult {
  position: ArbitragePosition;
  wasLocked: boolean;
}

/**
 * Responsible for concurrently opening both legs of an arbitrage position.
 *
 * Critical rules (based on system risk analysis):
 * 1. A Redis lock is acquired per strategy before execution to prevent concurrent
 *    duplicate executions (e.g., from rapid consecutive price ticks).
 * 2. Both legs are opened simultaneously using Promise.allSettled, not sequentially.
 * 3. If one leg succeeds and the other fails, the successful leg is immediately
 *    closed (Hedge-Close) to avoid market exposure.
 * 4. If any leg returns an UNKNOWN state (e.g., Network Timeout), the position
 *    is marked as NEEDS_MANUAL_REVIEW instead of assuming success/failure. Blindly
 *    closing an unknown position can create severe new risks.
 */
@Injectable()
export class PositionExecutorService {
  private readonly logger = new Logger(PositionExecutorService.name);

  constructor(
    @InjectRepository(ArbitragePosition)
    private readonly positionRepo: Repository<ArbitragePosition>,
    @InjectRepository(PositionLeg)
    private readonly legRepo: Repository<PositionLeg>,
    private readonly exchangeAccountsService: ExchangeAccountsService,
    private readonly registry: ExchangeRegistry,
    private readonly redisService: RedisService,
  ) {}

  private lockKey(strategyId: string): string {
    return `lock:strategy-execution:${strategyId}`;
  }

  /**
   * Attempts to open a paired position based on a detected opportunity.
   * Returns { wasLocked: true } if another execution for this strategy is currently running.
   */
  async openPairFromOpportunity(
    strategy: ArbitrageStrategy,
    direction: SpreadDirection,
  ): Promise<OpenPairResult | { wasLocked: true }> {
    const lockKey = this.lockKey(strategy.id);

    // Attempt to acquire execution lock
    const acquired = await this.redisService.acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (!acquired) {
      this.logger.warn(`Failed to acquire lock for strategy ${strategy.id}. Another execution is in progress.`);
      return { wasLocked: true };
    }

    try {
      const result = await this.executeOpenPair(strategy, direction);
      return { position: result, wasLocked: false };
    } finally {
      // Always release the lock, whether execution succeeded or failed
      await this.redisService.releaseLock(lockKey);
    }
  }

  private async executeOpenPair(
    strategy: ArbitrageStrategy,
    direction: SpreadDirection,
  ): Promise<ArbitragePosition> {
    if (!strategy.exchangeAAccount || !strategy.exchangeBAccount) {
      throw new Error(`Strategy ${strategy.id} is missing a trading account for one of the exchanges.`);
    }

    const idempotencyKey = crypto.randomUUID();
    const quantity = parseFloat(strategy.orderQuantity);

    // If direction says "buyOn: A", we go LONG on Exchange A and SHORT on Exchange B (and vice versa)
    const sideOnA = direction.buyOn === 'A' ? PositionSide.LONG : PositionSide.SHORT;
    const sideOnB = direction.buyOn === 'B' ? PositionSide.LONG : PositionSide.SHORT;

    // Create the initial position record
    let position = this.positionRepo.create({
      strategy,
      symbol: strategy.symbol,
      status: ArbitragePositionStatus.OPENING,
      idempotencyKey,
      expectedNetSpreadPercent: direction.netSpreadPercent.toString(),
    });
    position = await this.positionRepo.save(position);

    // Execute both orders concurrently to minimize slippage
    const [resultA, resultB] = await Promise.allSettled([
      this.openSingleLeg(strategy.exchangeAAccount.id, strategy.symbol, sideOnA, quantity, `${idempotencyKey}-A`),
      this.openSingleLeg(strategy.exchangeBAccount.id, strategy.symbol, sideOnB, quantity, `${idempotencyKey}-B`),
    ]);

    // Persist leg results to the database
    const legA = await this.persistLeg(position, strategy.exchangeAAccount.id, sideOnA, quantity, resultA);
    const legB = await this.persistLeg(position, strategy.exchangeBAccount.id, sideOnB, quantity, resultB);

    // Determine final position status (and trigger hedge-close if necessary)
    position.status = await this.resolveFinalStatus(strategy, legA, legB);
    return this.positionRepo.save(position);
  }

  private async openSingleLeg(
    exchangeAccountId: string,
    symbol: string,
    side: PositionSide,
    quantity: number,
    idempotencyKey: string,
  ) {
    const config = await this.exchangeAccountsService.buildAdapterConfig(exchangeAccountId);
    const adapter = this.registry.getInstance(config);
    return adapter.openPosition({ accountId: exchangeAccountId, symbol, side, quantity, idempotencyKey });
  }

  private async persistLeg(
    position: ArbitragePosition,
    exchangeAccountId: string,
    side: PositionSide,
    requestedQuantity: number,
    settled: PromiseSettledResult<Awaited<ReturnType<PositionExecutorService['openSingleLeg']>>>,
  ): Promise<PositionLeg> {
    const leg = this.legRepo.create({
      position,
      exchangeAccount: { id: exchangeAccountId } as any,
      side,
      requestedQuantity: requestedQuantity.toString(),
      status: OrderStatus.FAILED,
    });

    if (settled.status === 'fulfilled') {
      leg.status = settled.value.status;
      leg.filledQuantity = settled.value.filledQuantity.toString();
      leg.avgFillPrice = settled.value.avgFillPrice?.toString() ?? null;
      leg.exchangeOrderId = settled.value.exchangeOrderId;
    } else {
      this.logger.error(`Failed to open Leg: ${settled.reason?.message ?? settled.reason}`);
      leg.status = OrderStatus.FAILED;
    }

    return this.legRepo.save(leg);
  }

  /**
   * Determines the final status of the position based on both legs' outcomes.
   * If one leg succeeded while the other failed, it automatically triggers a Hedge-Close.
   */
  private async resolveFinalStatus(
    strategy: ArbitrageStrategy,
    legA: PositionLeg,
    legB: PositionLeg,
  ): Promise<ArbitragePositionStatus> {
    const isSuccessfulFill = (leg: PositionLeg) =>
      leg.status === OrderStatus.FILLED || leg.status === OrderStatus.PARTIALLY_FILLED;
    const isUnknown = (leg: PositionLeg) => leg.status === OrderStatus.UNKNOWN;

    // Both legs opened successfully
    if (isSuccessfulFill(legA) && isSuccessfulFill(legB)) {
      return ArbitragePositionStatus.OPEN;
    }

    // Both legs failed (no market exposure)
    if (!isSuccessfulFill(legA) && !isSuccessfulFill(legB) && !isUnknown(legA) && !isUnknown(legB)) {
      return ArbitragePositionStatus.FAILED;
    }

    // If either leg is UNKNOWN (e.g., Timeout), automatic closing is dangerous.
    // We must flag it for manual human review.
    if (isUnknown(legA) || isUnknown(legB)) {
      this.logger.warn(`Position ${strategy.id} requires MANUAL REVIEW (One or both legs timed out / UNKNOWN state).`);
      return ArbitragePositionStatus.NEEDS_MANUAL_REVIEW;
    }

    // Exactly ONE leg succeeded, and the other failed. We must close the successful one (Hedge-Close).
    const successfulLeg = isSuccessfulFill(legA) ? legA : legB;

    this.logger.warn(`One leg of position ${strategy.id} succeeded while the other failed. Initiating Hedge-Close.`);
    await this.hedgeClose(successfulLeg);

    // The overall arbitrage strategy failed to execute properly
    return ArbitragePositionStatus.FAILED;
  }

  /**
   * Closes an successfully opened leg when its paired leg fails to open.
   */
  private async hedgeClose(leg: PositionLeg): Promise<void> {
    try {
      const config = await this.exchangeAccountsService.buildAdapterConfig(leg.exchangeAccount.id);
      const adapter = this.registry.getInstance(config);
      const filledQty = parseFloat(leg.filledQuantity ?? leg.requestedQuantity);

      await adapter.closePosition({
        accountId: leg.exchangeAccount.id,
        symbol: leg.position?.symbol ?? '',
        side: leg.side,
        quantity: filledQty,
        idempotencyKey: `hedge-close-${leg.id}`,
      });

      this.logger.log(`Hedge-Close for Leg ${leg.id} executed successfully.`);
    } catch (err) {
      // If Hedge-Close fails, it's a critical state requiring immediate admin notification.
      this.logger.error(`⚠️ CRITICAL: Hedge-Close for Leg ${leg.id} FAILED! Manual intervention required immediately: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Checks if there's any active position currently open or opening for a given strategy. */
  async hasOpenPosition(strategyId: string): Promise<boolean> {
    const count = await this.positionRepo.count({
      where: [
        { strategy: { id: strategyId }, status: ArbitragePositionStatus.OPEN },
        { strategy: { id: strategyId }, status: ArbitragePositionStatus.OPENING },
        { strategy: { id: strategyId }, status: ArbitragePositionStatus.HEDGING },
        { strategy: { id: strategyId }, status: ArbitragePositionStatus.NEEDS_MANUAL_REVIEW },
      ],
    });
    return count > 0;
  }

  /**
   * Manually closes both legs of a paired position.
   * Both legs are closed in parallel. If one fails, the other still attempts to close.
   */
  async closePair(positionId: string): Promise<ArbitragePosition> {
    const position = await this.positionRepo.findOne({
      where: { id: positionId },
      relations: ['legs', 'legs.exchangeAccount', 'strategy'],
    });

    if (!position) {
      throw new NotFoundException('Position not found');
    }
    if (position.legs.length !== 2) {
      throw new ConflictException('This position does not have exactly two legs. Auto-close is not possible.');
    }

    const [resultA, resultB] = await Promise.allSettled(
      position.legs.map((leg) => this.closeSingleLegInternal(leg)),
    );

    const bothClosed = resultA.status === 'fulfilled' && resultB.status === 'fulfilled';
    position.status = bothClosed
      ? ArbitragePositionStatus.CLOSED
      : ArbitragePositionStatus.NEEDS_MANUAL_REVIEW;

    if (!bothClosed) {
      this.logger.error(`Partial failure while closing position ${positionId}. Requires manual review.`);
    }

    return this.positionRepo.save(position);
  }

  /** Manually closes a single specific leg of a position. */
  async closeSingleLeg(positionId: string, legId: string): Promise<PositionLeg> {
    const position = await this.positionRepo.findOne({
      where: { id: positionId },
      relations: ['legs', 'legs.exchangeAccount'],
    });

    if (!position) {
      throw new NotFoundException('Position not found');
    }

    const leg = position.legs.find((l) => l.id === legId);
    if (!leg) {
      throw new NotFoundException('Specified leg not found in this position');
    }

    const updatedLeg = await this.closeSingleLegInternal(leg);

    // Check if any other legs remain open
    const remainingOpenLegs = position.legs.filter(
      (l) => l.id !== legId && (l.status === OrderStatus.FILLED || l.status === OrderStatus.PARTIALLY_FILLED),
    );

    position.status = remainingOpenLegs.length > 0
      ? ArbitragePositionStatus.HEDGING
      : ArbitragePositionStatus.CLOSED;

    await this.positionRepo.save(position);

    return updatedLeg;
  }

  private async closeSingleLegInternal(leg: PositionLeg): Promise<PositionLeg> {
    const config = await this.exchangeAccountsService.buildAdapterConfig(leg.exchangeAccount.id);
    const adapter = this.registry.getInstance(config);
    const quantity = parseFloat(leg.filledQuantity ?? leg.requestedQuantity);

    const result = await adapter.closePosition({
      accountId: leg.exchangeAccount.id,
      symbol: leg.position?.symbol ?? '',
      side: leg.side,
      quantity,
      idempotencyKey: `manual-close-${leg.id}`,
    });

    leg.status = result.status;
    leg.filledQuantity = result.filledQuantity.toString();
    leg.avgFillPrice = result.avgFillPrice?.toString() ?? leg.avgFillPrice;

    return this.legRepo.save(leg);
  }
}
