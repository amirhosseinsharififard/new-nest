import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRegistry, ExchangeAccountConfig } from '../../core/exchange/exchange-registry';
import { TickerData } from '../../core/exchange/exchange.types';
import { SpreadCalculatorService } from './spread-calculator.service';

/**
 * این سرویس روی WebSocket چند صرافی هم‌زمان گوش می‌ده و آخرین قیمت هر
 * (صرافی، Symbol) رو در Redis نگه می‌داره (از طریق SpreadCalculatorService.cacheTicker).
 *
 * نکته: subscribeTicker از نظر صرافی‌های CEX نیازی به Auth نداره،
 * ولی چون Adapter های فعلی در Constructor به Credential نیاز دارن،
 * از Config همون اکانتی که کاربر برای معامله وصل کرده استفاده می‌کنیم.
 * در نسخه‌های بعدی می‌شه یک "Market-Data-Only Adapter" جدا بدون نیاز
 * به Credential واقعی ساخت.
 */
@Injectable()
export class PriceAggregatorService {
  private readonly logger = new Logger(PriceAggregatorService.name);
// برای جلوگیری از subscribe تکراری روی یک (exchangeId, accountId, symbol).
  // هر Account می‌تواند اتصال WebSocket و credential مستقل داشته باشد.
  private readonly activeSubscriptions = new Set<string>();

  constructor(
    private readonly registry: ExchangeRegistry,
    private readonly spreadCalculator: SpreadCalculatorService,
  ) {}

  /**
   * شروع گوش دادن به قیمت یک Symbol روی یک صرافی مشخص.
   * هر بار قیمت جدید بیاد، در Redis Cache می‌شه.
   */
  watchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    const subscriptionKey = this.getSubscriptionKey(config, symbol);
        if (this.activeSubscriptions.has(subscriptionKey)) {
      this.logger.debug(`قبلا در حال گوش دادن به ${subscriptionKey} هستیم`);
      return;
    }

    const adapter = this.registry.getInstance(config);
    adapter.subscribeTicker(symbol, (data: TickerData) => {
      this.spreadCalculator.cacheTicker(config.exchangeId, data).catch((err) => {
        this.logger.error(`خطا در Cache کردن قیمت ${subscriptionKey}: ${err.message}`);
      });
    });

    this.activeSubscriptions.add(subscriptionKey);
    this.logger.log(`شروع گوش دادن به قیمت ${symbol} روی ${config.exchangeId}`);
  }

  isWatching(exchangeId: string, symbol: string): boolean {
     return Array.from(this.activeSubscriptions).some((key) =>
      key.startsWith(`${exchangeId}:`) && key.endsWith(`:${symbol}`),
    );
  }

  /** توقف دریافت قیمت پس از حذف یا غیرفعال‌شدن یک strategy. */
  unwatchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    const subscriptionKey = this.getSubscriptionKey(config, symbol);
    if (!this.activeSubscriptions.delete(subscriptionKey)) return;

    const adapter = this.registry.getInstance(config);
    adapter.unsubscribeTicker(symbol);
    this.logger.log(`توقف گوش دادن به قیمت ${symbol} روی ${config.exchangeId}`);
  }

  private getSubscriptionKey(config: ExchangeAccountConfig, symbol: string): string {
    return `${config.exchangeId}:${config.accountId}:${symbol}`;
  }


}
