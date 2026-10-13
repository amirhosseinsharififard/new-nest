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
    // Used to trigger the arbitrage engine immediately upon receiving new prices (Phase 5)
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // --- Single-symbol methods (Kept for backward compatibility) ---
  watchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    this.watchSymbols(config, [symbol]);
  }

  unwatchSymbol(config: ExchangeAccountConfig, symbol: string): void {
    this.unwatchSymbols(config, [symbol]);
  }

  // --- Batch methods (Optimized for multiple symbols) ---
  watchSymbols(config: ExchangeAccountConfig, symbols: string[]): void {
    // Filter out symbols that are already subscribed
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

    // Call the adapter's batch subscribe method
    adapter.subscribeTickers(newSymbols, (data: TickerData) => {
      // Note: This callback is triggered hundreds of times per second

      // 1. Cache the live price in Redis (short TTL is handled in SpreadCalculator)
      this.spreadCalculator
        .cacheTicker(config.exchangeId, data)
        .catch((err) => {
          this.logger.error(
            `Error caching price for ${data.symbol}: ${err.message}`,
          );
        });

      // 2. Emit real-time event to wake up OpportunityDetectorService instantly
      this.eventEmitter.emit('ticker.updated', {
        exchangeId: config.exchangeId,
        symbol: data.symbol,
      });
    });

    // Register new symbols in the active subscriptions set
    for (const sym of newSymbols) {
      this.activeSubscriptions.add(this.getSubscriptionKey(config, sym));
    }

    this.logger.log(
      `Started listening to ${newSymbols.length} new symbols on ${config.exchangeId}`,
    );
  }

  unwatchSymbols(config: ExchangeAccountConfig, symbols: string[]): void {
    // Find symbols that are actually active and need to be removed
    const symbolsToRemove = symbols.filter((sym) =>
      this.activeSubscriptions.has(this.getSubscriptionKey(config, sym)),
    );

    if (symbolsToRemove.length === 0) return;

    const adapter = this.registry.getInstance(config);
    adapter.unsubscribeTickers(symbolsToRemove);

    // Remove from the active subscriptions set
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
