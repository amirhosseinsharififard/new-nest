import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeAccountsService } from '../exchange-accounts/exchange-accounts.service';
import { PriceAggregatorService } from './price-aggregator.service';

export const STRATEGY_WATCH_INTERVAL_MS = 30_000;

/**
 * این سرویس همون "حلقه گمشده"ایه که Strategy ها رو به WebSocket واقعی
 * صرافی‌ها وصل می‌کنه. بدون این سرویس، OpportunityDetectorService هیچ‌وقت
 * قیمتی در Redis پیدا نمی‌کنه، چون هیچ‌چیزی subscribeTicker رو صدا نزده.
 *
 * چرا Interval به‌جای Hook مستقیم روی create/update استراتژی؟
 * - از Circular Dependency بین StrategiesModule و MarketDataModule جلوگیری می‌کنه
 * - اگر اپلیکیشن Restart بشه، به‌صورت خودکار (بدون نیاز به Migration/Seed دستی)
 *   دوباره روی همه استراتژی‌های فعال subscribe می‌کنه
 * - چون PriceAggregatorService خودش subscribe تکراری رو نادیده می‌گیره،
 *   صدا زدن مکرر این متد هیچ ضرری نداره (Idempotent)
 */
@Injectable()
export class StrategyPriceWatcherService {
  private readonly logger = new Logger(StrategyPriceWatcherService.name);

  constructor(
    private readonly strategiesService: StrategiesService,
    private readonly exchangeAccountsService: ExchangeAccountsService,
    private readonly priceAggregatorService: PriceAggregatorService,
  ) {}

  @Interval(STRATEGY_WATCH_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    try {
      await this.ensureWatchingAllActiveStrategies();
    } catch (err) {
      this.logger.error(`خطا در همگام‌سازی Watch لیست استراتژی‌ها: ${(err as Error).message}`);
    }
  }

  async ensureWatchingAllActiveStrategies(): Promise<void> {
    const strategies = await this.strategiesService.findAllActive();

    for (const strategy of strategies) {
      // بدون اکانت معاملاتی مشخص، نمی‌شه Credential برای اتصال WebSocket ساخت
      if (!strategy.exchangeAAccount || !strategy.exchangeBAccount) {
        continue;
      }
      await this.watchStrategy(
        strategy.symbol,
        strategy.exchangeAAccount.id,
        strategy.exchangeBAccount.id,
      );
    }
  }

  async watchStrategy(
    symbol: string,
    exchangeAAccountId: string,
    exchangeBAccountId: string,
  ): Promise<void> {
    const [configA, configB] = await Promise.all([
      this.exchangeAccountsService.buildAdapterConfig(exchangeAAccountId),
      this.exchangeAccountsService.buildAdapterConfig(exchangeBAccountId),
    ]);

    this.priceAggregatorService.watchSymbol(configA, symbol);
    this.priceAggregatorService.watchSymbol(configB, symbol);
  }
}
