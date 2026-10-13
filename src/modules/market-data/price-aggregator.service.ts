import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
      (sym) => !this.activeSubscriptions.has(this.getSubscriptionKey(config, sym)),
    );

    if (newSymbols.length === 0) {
      this.logger.debug(
        `All ${symbols.length} symbols are already subscribed on ${config.exchangeId}.`,
      );
      return;
    }

    const adapter = this.registry.getInstance(config);

    adapter.subscribeTickers(newSymbols, (data: TickerData) => {
      // گارد اعتبارسنجی: جلوگیری از کرش در صورت نبود symbol
      if (!data || !data.symbol) {
        this.logger.warn(
          `[MALFORMED TICKER] Dropped ticker without symbol from ${config.exchangeId}: ${JSON.stringify(data)}`,
        );
        return;
      }

      this.spreadCalculator
        .cacheTicker(config.exchangeId, data)
        .catch((err) => {
          this.logger.error(
            `Error caching price for ${data.symbol}: ${err.message}`,
          );
        });

      this.eventEmitter.emit('ticker.updated', {
        exchangeId: config.exchangeId,
        symbol: data.symbol,
      });
    });

    for (const sym of newSymbols) {
      this.activeSubscriptions.add(this.getSubscriptionKey(config, sym));
    }

    this.logger.log(
      `Started listening to ${newSymbols.length} new symbols on ${config.exchangeId}`,
    );
  }

  unwatchSymbols(config: ExchangeAccountConfig, symbols: string[]): void {
    const symbolsToRemove = symbols.filter((sym) =>
      this.activeSubscriptions.has(this.getSubscriptionKey(config, sym)),
    );

    if (symbolsToRemove.length === 0) return;

    const adapter = this.registry.getInstance(config);
    adapter.unsubscribeTickers(symbolsToRemove);

    for (const sym of symbolsToRemove) {
      this.activeSubscriptions.delete(this.getSubscriptionKey(config, sym));
    }

    this.logger.log(
      `Stopped listening to ${symbolsToRemove.length} symbols on ${config.exchangeId}`,
    );
  }

  isWatching(exchangeId: string, symbol: string): boolean {
    return Array.from(this.activeSubscriptions).some(
      (key) =>
        key.startsWith(`${exchangeId}:`) && key.endsWith(`:${symbol}`),
    );
  }

  private getSubscriptionKey(
    config: ExchangeAccountConfig,
    symbol: string,
  ): string {
    return `${config.exchangeId}:${config.accountId}:${symbol}`;
  }
}
