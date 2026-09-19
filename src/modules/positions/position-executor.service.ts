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
 * مسئول باز کردن هم‌زمان دو Leg یک پوزیشن آربیتراژ.
 *
 * قوانین حیاتی این سرویس (طبق تحلیل ریسک اولیه پروژه):
 * ۱. قبل از هر اجرا، یک Lock روی استراتژی گرفته می‌شه تا دو اجرای
 *    هم‌زمان (مثلا از دو تیک قیمت پشت‌سرهم) با هم تداخل نکنن.
 * ۲. هر دو Leg با Promise.allSettled به‌صورت موازی باز می‌شن، نه پشت‌سرهم.
 * ۳. اگر یکی موفق و دیگری fail بشه، بلافاصله Leg موفق بسته می‌شه (Hedge-Close).
 * ۴. اگر یک Leg با وضعیت UNKNOWN (Timeout) برگرده، به‌جای فرض کردن
 *    fail/success، پوزیشن با وضعیت NEEDS_MANUAL_REVIEW ثبت می‌شه —
 *    چون بستن یک پوزیشنی که شاید اصلا باز نشده، خودش می‌تونه ریسک جدید بسازه.
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
   * تلاش برای باز کردن پوزیشن جفتی بر اساس یک فرصت شناسایی‌شده.
   * اگر قفل گرفته نشه (اجرای هم‌زمان دیگری در جریانه)، wasLocked=true
   * برمی‌گرده و هیچ پوزیشنی ساخته نمیشه.
   */
  async openPairFromOpportunity(
    strategy: ArbitrageStrategy,
    direction: SpreadDirection,
  ): Promise<OpenPairResult | { wasLocked: true }> {
    const lockKey = this.lockKey(strategy.id);
    const acquired = await this.redisService.acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (!acquired) {
      this.logger.warn(`قفل استراتژی ${strategy.id} گرفته نشد، اجرای دیگری در جریان است`);
      return { wasLocked: true };
    }

    try {
      const result = await this.executeOpenPair(strategy, direction);
      return { position: result, wasLocked: false };
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  private async executeOpenPair(
    strategy: ArbitrageStrategy,
    direction: SpreadDirection,
  ): Promise<ArbitragePosition> {
    if (!strategy.exchangeAAccount || !strategy.exchangeBAccount) {
      throw new Error(
        `استراتژی ${strategy.id} اکانت معاملاتی برای یکی از دو صرافی ندارد`,
      );
    }

    const idempotencyKey = crypto.randomUUID();
    const quantity = parseFloat(strategy.orderQuantity);

    // جهت "buyOn: A" یعنی روی صرافی A باید Long باز کنیم (خرید)،
    // و روی صرافی B باید Short باز کنیم (فروش) — و برعکس.
    const sideOnA = direction.buyOn === 'A' ? PositionSide.LONG : PositionSide.SHORT;
    const sideOnB = direction.buyOn === 'B' ? PositionSide.LONG : PositionSide.SHORT;

    let position = this.positionRepo.create({
      strategy,
      symbol: strategy.symbol,
      status: ArbitragePositionStatus.OPENING,
      idempotencyKey,
      expectedNetSpreadPercent: direction.netSpreadPercent.toString(),
    });
    position = await this.positionRepo.save(position);

    const [resultA, resultB] = await Promise.allSettled([
      this.openSingleLeg(strategy.exchangeAAccount.id, strategy.symbol, sideOnA, quantity, `${idempotencyKey}-A`),
      this.openSingleLeg(strategy.exchangeBAccount.id, strategy.symbol, sideOnB, quantity, `${idempotencyKey}-B`),
    ]);

    const legA = await this.persistLeg(position, strategy.exchangeAAccount.id, sideOnA, quantity, resultA);
    const legB = await this.persistLeg(position, strategy.exchangeBAccount.id, sideOnB, quantity, resultB);

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
      this.logger.error(`باز کردن Leg شکست خورد: ${settled.reason?.message ?? settled.reason}`);
      leg.status = OrderStatus.FAILED;
    }

    return this.legRepo.save(leg);
  }

  /**
   * تعیین وضعیت نهایی پوزیشن بر اساس نتیجه دو Leg، و در صورت لزوم
   * اجرای Hedge-Close (بستن Legی که موفق باز شده، وقتی طرف مقابل fail شده).
   */
  private async resolveFinalStatus(
    strategy: ArbitrageStrategy,
    legA: PositionLeg,
    legB: PositionLeg,
  ): Promise<ArbitragePositionStatus> {
    const isSuccessfulFill = (leg: PositionLeg) =>
      leg.status === OrderStatus.FILLED || leg.status === OrderStatus.PARTIALLY_FILLED;
    const isUnknown = (leg: PositionLeg) => leg.status === OrderStatus.UNKNOWN;

    // هر دو موفق => پوزیشن باز است
    if (isSuccessfulFill(legA) && isSuccessfulFill(legB)) {
      return ArbitragePositionStatus.OPEN;
    }

    // هر دو fail شدند => هیچ اقدامی لازم نیست
    if (!isSuccessfulFill(legA) && !isSuccessfulFill(legB) && !isUnknown(legA) && !isUnknown(legB)) {
      return ArbitragePositionStatus.FAILED;
    }

    // اگر هرکدوم UNKNOWN (Timeout) باشه، بستن دستی خطرناکه — نیاز به بررسی انسانی
    if (isUnknown(legA) || isUnknown(legB)) {
      this.logger.warn(
        `پوزیشن ${strategy.id} نیازمند بررسی دستی است (وضعیت یکی از Legها نامشخص/Timeout)`,
      );
      return ArbitragePositionStatus.NEEDS_MANUAL_REVIEW;
    }

    // یکی موفق، دیگری fail => باید موفق رو ببندیم (Hedge-Close)
    const [successfulLeg, failedAccountId] = isSuccessfulFill(legA)
      ? [legA, null]
      : [legB, null];

    if (successfulLeg) {
      this.logger.warn(
        `یک پا از پوزیشن ${strategy.id} باز شد ولی طرف مقابل fail شد — در حال Hedge-Close`,
      );
      await this.hedgeClose(successfulLeg);
      return ArbitragePositionStatus.FAILED;
    }

    return ArbitragePositionStatus.FAILED;
  }

  private async hedgeClose(leg: PositionLeg): Promise<void> {
    try {
      const config = await this.exchangeAccountsService.buildAdapterConfig(
        leg.exchangeAccount.id,
      );
      const adapter = this.registry.getInstance(config);
      const filledQty = parseFloat(leg.filledQuantity ?? leg.requestedQuantity);

      await adapter.closePosition({
        accountId: leg.exchangeAccount.id,
        symbol: leg.position?.symbol ?? '',
        side: leg.side,
        quantity: filledQty,
        idempotencyKey: `hedge-close-${leg.id}`,
      });

      this.logger.log(`Hedge-Close برای Leg ${leg.id} با موفقیت انجام شد`);
    } catch (err) {
      // اگر Hedge-Close هم fail بشه، این دیگه یک حالت بحرانیه که باید
      // فوری به کاربر/ادمین اطلاع داده بشه (Notification System در فاز بعد)
      this.logger.error(
        `⚠️ Hedge-Close برای Leg ${leg.id} شکست خورد! نیاز به بررسی فوری دستی: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /** آیا در حال حاضر پوزیشن بازی از این استراتژی وجود دارد؟ (برای جلوگیری از Duplicate Entry) */
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
   * بستن دستی هر دو Leg یک پوزیشن با یک فراخوانی.
   * هر دو Leg موازی بسته می‌شوند؛ اگر یکی fail بشه، دیگری همچنان
   * تلاش می‌شه بسته بشه (برخلاف Hedge-Close، اینجا کاربر صراحتاً
   * درخواست خروج داده، پس نباید نیمه‌کاره متوقف بشه).
   */
  async closePair(positionId: string): Promise<ArbitragePosition> {
    const position = await this.positionRepo.findOne({
      where: { id: positionId },
      relations: ['legs', 'legs.exchangeAccount', 'strategy'],
    });
    if (!position) {
      throw new NotFoundException('پوزیشن یافت نشد');
    }
    if (position.legs.length !== 2) {
      throw new ConflictException('این پوزیشن دقیقا دو Leg ندارد، بستن خودکار امکان‌پذیر نیست');
    }

    const [resultA, resultB] = await Promise.allSettled(
      position.legs.map((leg) => this.closeSingleLegInternal(leg)),
    );

    const bothClosed = resultA.status === 'fulfilled' && resultB.status === 'fulfilled';
    position.status = bothClosed
      ? ArbitragePositionStatus.CLOSED
      : ArbitragePositionStatus.NEEDS_MANUAL_REVIEW;

    if (!bothClosed) {
      this.logger.error(
        `بستن پوزیشن ${positionId} ناقص انجام شد؛ نیاز به بررسی دستی دارد`,
      );
    }

    return this.positionRepo.save(position);
  }

  /** بستن فقط یک Leg مشخص از یک پوزیشن (نه هر دو) */
  async closeSingleLeg(positionId: string, legId: string): Promise<PositionLeg> {
    const position = await this.positionRepo.findOne({
      where: { id: positionId },
      relations: ['legs', 'legs.exchangeAccount'],
    });
    if (!position) {
      throw new NotFoundException('پوزیشن یافت نشد');
    }
    const leg = position.legs.find((l) => l.id === legId);
    if (!leg) {
      throw new NotFoundException('Leg مورد نظر در این پوزیشن یافت نشد');
    }

    const updatedLeg = await this.closeSingleLegInternal(leg);

    // اگر Leg دیگری همچنان باز باشد، پوزیشن در وضعیت HEDGING باقی می‌مونه
    // (چون دیگه Hedge کامل نیست)؛ اگر این آخرین Leg باز بود، CLOSED می‌شه.
    const remainingOpenLegs = position.legs.filter(
      (l) => l.id !== legId && (l.status === OrderStatus.FILLED || l.status === OrderStatus.PARTIALLY_FILLED),
    );
    position.status =
      remainingOpenLegs.length > 0 ? ArbitragePositionStatus.HEDGING : ArbitragePositionStatus.CLOSED;
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
