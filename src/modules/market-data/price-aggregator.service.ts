
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ExchangeRegistry,
  ExchangeAccountConfig,
} from '../../core/exchange/exchange-registry';
import { TickerData } from '../../core/exchange/exchange.types';
import {
  SpreadCalculatorService,
  TICKER_UPDATED_EVENT,
} from './spread-calculator.service';

@Injectable()
export class PriceAggregatorService {
  private readonly logger = new Logger(PriceAggregatorService.name);
  private readonly activeSubscriptions = new Set<string>();

  constructor(
    private readonly registry: ExchangeRegistry,
    private readonly spreadCalculator: SpreadCalculatorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  watchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    this.watchSymbols(config, [symbol]);
  }

  unwatchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    this.unwatchSymbols(config, [symbol]);
  }

  watchSymbols(config: ExchangeAccountConfig, symbols: string[]): void {
    const newSymbols = symbols.filter(
      (symbol) =>
        !this.activeSubscriptions.has(
          this.getSubscriptionKey(config, symbol),
        ),
    );

    if (newSymbols.length === 0) {
      this.logger.debug(
        `All ${symbols.length} symbols are already subscribed on ${config.exchangeId}.`,
      );
      return;
    }

    const adapter = this.registry.getInstance(config);

    adapter.subscribeTickers(newSymbols, (data: TickerData) => {
      if (!data?.symbol) {
        this.logger.warn(
          `[MALFORMED TICKER] Dropped ticker from ${config.exchangeId}: ${JSON.stringify(data)}`,
        );
        return;
      }

      void this.spreadCalculator
        .cacheTicker(config.exchangeId, data)
        .then(() => {
          this.eventEmitter.emit(TICKER_UPDATED_EVENT, {
            exchangeSlug: config.exchangeId,
            symbol: data.symbol,
          });
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);

          this.logger.error(
            `Error caching price for ${data.symbol} on ${config.exchangeId}: ${message}`,
          );
        });
    });

    for (const symbol of newSymbols) {
      this.activeSubscriptions.add(
        this.getSubscriptionKey(config, symbol),
      );
    }

    this.logger.log(
      `Started listening to ${newSymbols.length} new symbols on ${config.exchangeId}`,
    );
  }

  unwatchSymbols(
    config: ExchangeAccountConfig,
    symbols: string[],
  ): void {
    const symbolsToRemove = symbols.filter((symbol) =>
      this.activeSubscriptions.has(
        this.getSubscriptionKey(config, symbol),
      ),
    );

    if (symbolsToRemove.length === 0) {
      return;
    }

    const adapter = this.registry.getInstance(config);
    adapter.unsubscribeTickers(symbolsToRemove);

    for (const symbol of symbolsToRemove) {
      this.activeSubscriptions.delete(
        this.getSubscriptionKey(config, symbol),
      );
    }

    this.logger.log(
      `Stopped listening to ${symbolsToRemove.length} symbols on ${config.exchangeId}`,
    );
  }

  isWatching(exchangeId: string, symbol: string): boolean {
  const normalizedExchange = exchangeId.toLowerCase();
  const normalizedSymbol = this.normalizeSymbol(symbol);

  return Array.from(this.activeSubscriptions).some((key) => {
    const prefix = `${normalizedExchange}:`;
    if (!key.startsWith(prefix)) {
      return false;
    }

    return key.endsWith(`:${normalizedSymbol}`);
  });
  }

  private getSubscriptionKey(
    config: ExchangeAccountConfig,
    symbol: string,
  ): string {
    return `${config.exchangeId.toLowerCase()}:${config.accountId}:${this.normalizeSymbol(symbol)}`;
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace(/[\/_-]/g, '').toUpperCase();
  }
}
