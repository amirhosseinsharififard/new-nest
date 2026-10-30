
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Exchange } from '../exchanges/entities/exchange.entity';
import {
  ExchangeAccountConfig,
  ExchangeRegistry,
} from '../../core/exchange/exchange-registry';
import { PriceAggregatorService } from './price-aggregator.service';

interface ExchangeMarket {
  config: ExchangeAccountConfig;
  symbols: Set<string>;
}

@Injectable()
export class MarketDataSubscriptionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    MarketDataSubscriptionService.name,
  );

  private readonly subscribedSymbols = new Map<
    string,
    Set<string>
  >();

  private refreshTimer?: NodeJS.Timeout;
  private isRefreshing = false;

  private readonly refreshIntervalMs =
    this.getRefreshIntervalMs();

  constructor(
    @InjectRepository(Exchange)
    private readonly exchangeRepository: Repository<Exchange>,
    private readonly exchangeRegistry: ExchangeRegistry,
    private readonly priceAggregatorService: PriceAggregatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.startSubscriptions();

    this.refreshTimer = setInterval(() => {
      void this.startSubscriptions();
    }, this.refreshIntervalMs);

    this.logger.log(
      `Market refresh scheduled every ${this.refreshIntervalMs / 60000} minutes`,
    );
  }

  onApplicationShutdown(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private getRefreshIntervalMs(): number {
    const configured = Number(
      process.env.MARKET_SYMBOLS_REFRESH_MINUTES ?? 10,
    );

    const minutes =
      Number.isFinite(configured) &&
      configured >= 5 &&
      configured <= 20
        ? configured
        : 10;

    return minutes * 60 * 1000;
  }

  async startSubscriptions(): Promise<void> {
    if (this.isRefreshing) {
      this.logger.warn('Market refresh already running');
      return;
    }

    this.isRefreshing = true;

    try {
      const exchanges = await this.exchangeRepository.find({
        where: { isActive: true },
      });

      const discovered = new Map<string, ExchangeMarket>();

      let discoveryFailed = false;

      // 1. دریافت بازارهای تمام صرافی‌ها
      for (const exchange of exchanges) {
        const config: ExchangeAccountConfig = {
          accountId: `public-market-data:${exchange.slug}`,
          exchangeId: exchange.slug,
          restBaseUrl: exchange.restBaseUrl,
          wsBaseUrl: exchange.wsBaseUrl,
        };

        try {
          const adapter = this.exchangeRegistry.getInstance(config);

          if (!adapter.getMarketSymbols) {
            throw new Error('getMarketSymbols() is not implemented');
          }

          const symbols = await adapter.getMarketSymbols();

          if (!symbols.length) {
            throw new Error('Empty market symbols response');
          }

          discovered.set(exchange.slug, {
            config,
            symbols: new Set(
              symbols.map((symbol) => this.normalizeSymbol(symbol)),
            ),
          });

          this.logger.log(
            `${exchange.slug}: discovered ${symbols.length} markets`,
          );
        } catch (error) {
          discoveryFailed = true;

          this.logger.error(
            `${exchange.slug}: discovery failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      // محافظه‌کارانه: در صورت خطای حتی یک صرافی،
      // هیچ تغییری در اشتراک‌های فعلی ایجاد نکن.
      if (discoveryFailed) {
        this.logger.warn(
          'Discovery incomplete. Keeping all existing subscriptions unchanged.',
        );
        return;
      }

      if (discovered.size < 2) {
        this.logger.warn('Not enough exchanges for common market discovery');
        return;
      }

      // 2. پیدا کردن نمادهایی که حداقل در دو صرافی وجود دارند
      const symbolExchanges = new Map<string, string[]>();

      for (const [exchangeSlug, market] of discovered) {
        for (const symbol of market.symbols) {
          const exchangeList = symbolExchanges.get(symbol) ?? [];
          exchangeList.push(exchangeSlug);
          symbolExchanges.set(symbol, exchangeList);
        }
      }

      const commonSymbols = new Set(
        [...symbolExchanges.entries()]
          .filter(([, exchangeList]) => exchangeList.length >= 2)
          .map(([symbol]) => symbol),
      );

      this.logger.log(
        `Found ${commonSymbols.size} common markets across exchanges`,
      );

      // 3. ساخت لیست اشتراک موردنیاز برای هر صرافی
      for (const [exchangeSlug, market] of discovered) {
        const desiredSymbols = new Set(
          [...market.symbols].filter((symbol) =>
            commonSymbols.has(symbol),
          ),
        );

        const currentSymbols =
          this.subscribedSymbols.get(exchangeSlug) ?? new Set<string>();

        const toSubscribe = [...desiredSymbols].filter(
          (symbol) => !currentSymbols.has(symbol),
        );

        const toUnsubscribe = [...currentSymbols].filter(
          (symbol) => !desiredSymbols.has(symbol),
        );

        // 4. لغو اشتراک نمادهای دیگر
        if (toUnsubscribe.length) {
          this.priceAggregatorService.unwatchSymbols(
            market.config,
            toUnsubscribe,
          );

          for (const symbol of toUnsubscribe) {
            currentSymbols.delete(symbol);
          }
        }

        // 5. اشتراک نمادهای مشترک جدید
        if (toSubscribe.length) {
          this.priceAggregatorService.watchSymbols(
            market.config,
            toSubscribe,
          );

          for (const symbol of toSubscribe) {
            currentSymbols.add(symbol);
          }
        }

        this.subscribedSymbols.set(exchangeSlug, currentSymbols);

        this.logger.log(
          `${exchangeSlug}: +${toSubscribe.length} / -${toUnsubscribe.length} / active ${currentSymbols.size}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Market refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace(/[\/_-]/g, '').toUpperCase();
  }
}
