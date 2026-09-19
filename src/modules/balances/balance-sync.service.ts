import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { Balance } from './entities/balance.entity';
import { ExchangeAccount } from '../exchange-accounts/entities/exchange-account.entity';
import { ExchangeAccountsService } from '../exchange-accounts/exchange-accounts.service';
import { ExchangeRegistry } from '../../core/exchange/exchange-registry';

export const BALANCE_SYNC_INTERVAL_MS = 60_000;

/**
 * بدون این سرویس، جدول balances هیچ‌وقت به‌روزرسانی نمیشه و
 * GET /exchange-accounts/:id/balance همیشه خالی/قدیمی برمی‌گردونه.
 *
 * این سرویس هر ۶۰ ثانیه موجودی واقعی هر اکانت فعال رو از صرافی می‌گیره
 * و در دیتابیس Upsert می‌کنه (بر اساس exchangeAccount+asset که Unique هست).
 */
@Injectable()
export class BalanceSyncService {
  private readonly logger = new Logger(BalanceSyncService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(ExchangeAccount)
    private readonly accountRepo: Repository<ExchangeAccount>,
    private readonly exchangeAccountsService: ExchangeAccountsService,
    private readonly registry: ExchangeRegistry,
  ) {}

  @Interval(BALANCE_SYNC_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.syncAllActiveAccounts();
    } catch (err) {
      this.logger.error(`خطا در چرخه Sync موجودی: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async syncAllActiveAccounts(): Promise<void> {
    const accounts = await this.accountRepo.find({ where: { isActive: true } });
    await Promise.all(accounts.map((account) => this.syncAccount(account.id)));
  }

  async syncAccount(accountId: string): Promise<void> {
    try {
      const config = await this.exchangeAccountsService.buildAdapterConfig(accountId);
      const adapter = this.registry.getInstance(config);
      const balances = await adapter.getBalance(accountId);

      for (const b of balances) {
        await this.upsertBalance(accountId, b.asset, b.free, b.locked);
      }
    } catch (err) {
      this.logger.error(`خطا در Sync موجودی اکانت ${accountId}: ${(err as Error).message}`);
    }
  }

  private async upsertBalance(
    exchangeAccountId: string,
    asset: string,
    free: number,
    locked: number,
  ): Promise<void> {
    let record = await this.balanceRepo.findOne({
      where: { exchangeAccount: { id: exchangeAccountId }, asset },
    });

    if (!record) {
      record = this.balanceRepo.create({
        exchangeAccount: { id: exchangeAccountId } as any,
        asset,
      });
    }

    record.free = free.toString();
    record.locked = locked.toString();
    await this.balanceRepo.save(record);
  }
}
