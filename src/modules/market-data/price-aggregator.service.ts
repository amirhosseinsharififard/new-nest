import { Injectable, Logger } from '@nestjs/common';
import {
  ExchangeRegistry,
  ExchangeAccountConfig,
} from '../../core/exchange/exchange-registry';
import { TickerData } from '../../core/exchange/exchange.types';
import { SpreadCalculatorService } from './spread-calculator.service';

@Injectable()
export class PriceAggregatorService {
  private readonly logger = new Logger(PriceAggregatorService.name);
  private readonly activeSubscriptions = new Set<string>();

  constructor(
    private readonly registry: ExchangeRegistry,
    private readonly spreadCalculator: SpreadCalculatorService,
  ) {}

  watchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    const subscriptionKey = this.getSubscriptionKey(config, symbol);

    if (this.activeSubscriptions.has(subscriptionKey)) {
      this.logger.debug(
        `قبلا در حال گوش دادن به ${subscriptionKey} هستیم`,
      );
      return;
    }

    const adapter = this.registry.getInstance(config);

    adapter.subscribeTicker(symbol, (data: TickerData) => {
      this.logger.log(
        `TICKER RECEIVED ${config.exchangeId} ${symbol}: ${JSON.stringify(data)}`,
      );

      this.spreadCalculator
        .cacheTicker(config.exchangeId, data)
        .catch((err) => {
          this.logger.error(
            `خطا در Cache کردن قیمت ${subscriptionKey}: ${err.message}`,
          );
        });
    });

    // ثبت subscription بعد از subscribe
    this.activeSubscriptions.add(subscriptionKey);

    this.logger.log(
      `شروع گوش دادن به ${symbol} روی ${config.exchangeId}`,
    );
  }

  isWatching(exchangeId: string, symbol: string): boolean {
    return Array.from(this.activeSubscriptions).some(
      (key) =>
        key.startsWith(`${exchangeId}:`) &&
        key.endsWith(`:${symbol}`),
    );
  }

  unwatchSymbol(
    config: ExchangeAccountConfig,
    symbol: string,
  ): void {
    const subscriptionKey = this.getSubscriptionKey(config, symbol);

    if (!this.activeSubscriptions.delete(subscriptionKey)) {
      return;
    }

    const adapter = this.registry.getInstance(config);

    adapter.unsubscribeTicker(symbol);

    this.logger.log(
      `توقف گوش دادن به قیمت ${symbol} روی ${config.exchangeId}`,
    );
  }

  private getSubscriptionKey(
    config: ExchangeAccountConfig,
    symbol: string,
  ): string {
    return `${config.exchangeId}:${config.accountId}:${symbol}`;
  }
}
