import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { ArbitragePosition, ArbitragePositionStatus } from './entities/arbitrage-position.entity';
import { PositionLeg } from './entities/position-leg.entity';
import { ExchangeAccountsService } from '../exchange-accounts/exchange-accounts.service';
import { ExchangeRegistry } from '../../core/exchange/exchange-registry';
import { OrderStatus } from '../../core/exchange/exchange.types';

export const RECONCILIATION_INTERVAL_MS = 60_000;

/**
 * این سرویس دقیقا همون چیزیه که در تحلیل ریسک اولیه پروژه به‌عنوان
 * "بزرگ‌ترین ریسک معماری" شناسایی شد: لحظه‌ای که وضعیت دیتابیس با
 * وضعیت واقعی صرافی هماهنگ نیست (Drift).
 *
 * سناریوهایی که این سرویس پوشش می‌ده:
 * - پوزیشنی که به‌خاطر Timeout با وضعیت NEEDS_MANUAL_REVIEW ثبت شده،
 *   ولی در واقع می‌شه با استعلام مستقیم از صرافی فهمید واقعا باز شده یا نه.
 * - پوزیشنی که OPEN ثبت شده ولی روی صرافی به هر دلیلی (مثلا Liquidation)
 *   دیگه باز نیست.
 *
 * این سرویس هرگز خودش تصمیم به بستن پوزیشن نمی‌گیره — فقط دیتابیس رو
 * با واقعیت هماهنگ می‌کنه و اگر ناهماهنگی جدی پیدا کرد، لاگ می‌کنه.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(ArbitragePosition)
    private readonly positionRepo: Repository<ArbitragePosition>,
    @InjectRepository(PositionLeg)
    private readonly legRepo: Repository<PositionLeg>,
    private readonly exchangeAccountsService: ExchangeAccountsService,
    private readonly registry: ExchangeRegistry,
  ) {}

  @Interval(RECONCILIATION_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.reconcileAll();
    } catch (err) {
      this.logger.error(`خطا در چرخه Reconciliation: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async reconcileAll(): Promise<void> {
    const positions = await this.positionRepo.find({
      where: {
        status: In([
          ArbitragePositionStatus.OPEN,
          ArbitragePositionStatus.NEEDS_MANUAL_REVIEW,
          ArbitragePositionStatus.HEDGING,
        ]),
      },
      relations: ['legs', 'legs.exchangeAccount'],
    });

    await Promise.all(positions.map((position) => this.reconcilePosition(position)));
  }

  async reconcilePosition(position: ArbitragePosition): Promise<void> {
    for (const leg of position.legs) {
      await this.reconcileLeg(position, leg);
    }
  }

  private async reconcileLeg(position: ArbitragePosition, leg: PositionLeg): Promise<void> {
    try {
      const config = await this.exchangeAccountsService.buildAdapterConfig(
        leg.exchangeAccount.id,
      );
      const adapter = this.registry.getInstance(config);
      const actualStatus = await adapter.getPositionStatus(leg.exchangeAccount.id, position.symbol);

      const dbThinksOpen = leg.status === OrderStatus.FILLED || leg.status === OrderStatus.PARTIALLY_FILLED;

      if (dbThinksOpen && !actualStatus.isOpen) {
        // دیتابیس فکر می‌کنه باز است ولی روی صرافی بسته شده (مثلا Liquidation یا بسته‌شدن دستی خارج از سیستم)
        this.logger.warn(
          `⚠️ ناهماهنگی پیدا شد: Leg ${leg.id} در دیتابیس باز ثبت شده ولی در صرافی بسته است`,
        );
        leg.status = OrderStatus.CANCELLED;
        await this.legRepo.save(leg);
      } else if (!dbThinksOpen && actualStatus.isOpen && leg.status === OrderStatus.UNKNOWN) {
        // این دقیقا سناریوی Timeout هست: دیتابیس نمی‌دونست، ولی معلوم شد واقعا باز شده
        this.logger.log(
          `✅ Reconcile شد: Leg ${leg.id} که وضعیتش UNKNOWN بود، در واقع باز شده است`,
        );
        leg.status = OrderStatus.FILLED;
        leg.filledQuantity = actualStatus.quantity.toString();
        leg.avgFillPrice = actualStatus.entryPrice?.toString() ?? null;
        await this.legRepo.save(leg);
      }
    } catch (err) {
      this.logger.error(
        `خطا در Reconcile کردن Leg ${leg.id}: ${(err as Error).message}`,
      );
    }
  }
}
