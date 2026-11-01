
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

  // Normalized symbol => Original exchange symbol
  symbols: Map<string, string>;
}

@Injectable()
export class MarketDataSubscriptionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    MarketDataSubscriptionService.name,
  );

  // Exchange => Normalized symbol => Original symbol
  private readonly subscribedSymbols = new Map<
    string,
    Map<string, string>
  >();

  private readonly subscribedConfigs = new Map<
    string,
    ExchangeAccountConfig
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
      `Market refresh scheduled every ${
        this.refreshIntervalMs / 60000
      } minutes`,
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

      const activeExchangeSlugs = new Set(
        exchanges.map((exchange) => exchange.slug),
      );

      const discovered = new Map<string, ExchangeMarket>();

      // 1. Discover markets from every active exchange
      for (const exchange of exchanges) {
        const config: ExchangeAccountConfig = {
          accountId: `public-market-data:${exchange.slug}`,
          exchangeId: exchange.slug,
          restBaseUrl: exchange.restBaseUrl,
          wsBaseUrl: exchange.wsBaseUrl,
        };

        try {
          const adapter =
            this.exchangeRegistry.getInstance(config);

          if (!adapter.getMarketSymbols) {
            throw new Error(
              'getMarketSymbols() is not implemented',
            );
          }

          const symbols = await adapter.getMarketSymbols();

          if (!symbols.length) {
            throw new Error(
              'Empty market symbols response',
            );
          }

          const normalizedSymbols = new Map<string, string>();

          for (const originalSymbol of symbols) {
            const normalizedSymbol =
              this.normalizeSymbol(originalSymbol);

            if (!normalizedSymbol) continue;

            normalizedSymbols.set(
              normalizedSymbol,
              originalSymbol,
            );
          }

          discovered.set(exchange.slug, {
            config,
            symbols: normalizedSymbols,
          });

          this.logger.log(
            `${exchange.slug}: discovered ${normalizedSymbols.size} markets`,
          );
        } catch (error) {
          this.logger.error(
            `${exchange.slug}: discovery failed: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`,
          );
        }
      }

      // 2. Remove subscriptions for exchanges no longer active
      for (const [exchangeSlug, currentSymbols] of this.subscribedSymbols) {
        if (activeExchangeSlugs.has(exchangeSlug)) {
          continue;
        }

        const config =
          this.subscribedConfigs.get(exchangeSlug);

        if (config && currentSymbols.size) {
          this.priceAggregatorService.unwatchSymbols(
            config,
            [...currentSymbols.values()],
          );
        }

        this.subscribedSymbols.delete(exchangeSlug);
        this.subscribedConfigs.delete(exchangeSlug);

        this.logger.log(
          `${exchangeSlug}: removed inactive exchange subscriptions`,
        );
      }

      if (discovered.size < 2) {
        this.logger.warn(
          'Not enough exchanges for common market discovery',
        );
        return;
      }

      // 3. Count how many exchanges contain each normalized symbol
      const symbolExchanges = new Map<string, Set<string>>();

      for (const [exchangeSlug, market] of discovered) {
        for (const normalizedSymbol of market.symbols.keys()) {
          const exchangeSet =
            symbolExchanges.get(normalizedSymbol) ??
            new Set<string>();

          exchangeSet.add(exchangeSlug);

          symbolExchanges.set(
            normalizedSymbol,
            exchangeSet,
          );
        }
      }

      // 4. Keep only symbols available on at least two exchanges
      const commonSymbols = new Set(
        [...symbolExchanges.entries()]
          .filter(([, exchangeSet]) => exchangeSet.size >= 2)
          .map(([symbol]) => symbol),
      );

      this.logger.log(
        `Found ${commonSymbols.size} common markets across exchanges`,
      );

      // 5. Reconcile subscriptions for every successfully discovered exchange
      for (const [exchangeSlug, market] of discovered) {
        const desiredSymbols = new Map<string, string>();

        for (const normalizedSymbol of commonSymbols) {
          const originalSymbol =
            market.symbols.get(normalizedSymbol);

          if (originalSymbol) {
            desiredSymbols.set(
              normalizedSymbol,
              originalSymbol,
            );
          }
        }

        const currentSymbols =
          this.subscribedSymbols.get(exchangeSlug) ??
          new Map<string, string>();

        // Symbols that are no longer common
        const toUnsubscribe = [
          ...currentSymbols.entries(),
        ].filter(
          ([normalizedSymbol]) =>
            !desiredSymbols.has(normalizedSymbol),
        );

        // Newly common symbols
        const toSubscribe = [
          ...desiredSymbols.entries(),
        ].filter(
          ([normalizedSymbol]) =>
            !currentSymbols.has(normalizedSymbol),
        );

        // 6. Unsubscribe obsolete symbols using original exchange names
        if (toUnsubscribe.length) {
          const originalSymbols = toUnsubscribe.map(
            ([, originalSymbol]) => originalSymbol,
          );

          this.priceAggregatorService.unwatchSymbols(
            market.config,
            originalSymbols,
          );

          for (const [normalizedSymbol] of toUnsubscribe) {
            currentSymbols.delete(normalizedSymbol);
          }

          this.logger.log(
            `${exchangeSlug}: unsubscribed ${originalSymbols.length} obsolete symbols`,
          );
        }

        // 7. Subscribe newly common symbols
        if (toSubscribe.length) {
          const originalSymbols = toSubscribe.map(
            ([, originalSymbol]) => originalSymbol,
          );

          this.priceAggregatorService.watchSymbols(
            market.config,
            originalSymbols,
          );

          for (const [normalizedSymbol, originalSymbol] of toSubscribe) {
            currentSymbols.set(
              normalizedSymbol,
              originalSymbol,
            );
          }

          this.logger.log(
            `${exchangeSlug}: subscribed ${originalSymbols.length} new common symbols`,
          );
        }

        this.subscribedSymbols.set(
          exchangeSlug,
          currentSymbols,
        );

        this.subscribedConfigs.set(
          exchangeSlug,
          market.config,
        );

        this.logger.log(
          `${exchangeSlug}: +${toSubscribe.length} / -${toUnsubscribe.length} / active ${currentSymbols.size}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Market refresh failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    } finally {
      this.isRefreshing = false;
    }
  }

  private normalizeSymbol(symbol: string): string {
    return symbol
      .replace(/[/_-]/g, '')
      .toUpperCase();
  }
}
