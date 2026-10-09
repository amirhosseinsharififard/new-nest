import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  SpreadCalculatorService,
  TICKER_UPDATED_EVENT,
  TickerUpdatedPayload,
} from './spread-calculator.service';

import { SymbolMappingService } from './symbol-mapping.service';

@Injectable()
export class LiveSpreadMonitorService {
  private readonly logger = new Logger(
    LiveSpreadMonitorService.name,
  );

  constructor(
    private readonly spreadCalculator: SpreadCalculatorService,
    private readonly symbolMappingService: SymbolMappingService,
  ) {}

  @OnEvent(TICKER_UPDATED_EVENT)
  async handleTickerUpdated(
    payload: TickerUpdatedPayload,
  ): Promise<void> {
    const { exchangeSlug, symbol } = payload;

    try {
      const mappings =
        await this.symbolMappingService.getActiveMappings(symbol);

      if (mappings.length < 2) {
        return;
      }

      const otherExchanges = mappings
        .map((mapping) => mapping.exchange.slug)
        .filter((slug) => slug !== exchangeSlug);

      if (otherExchanges.length === 0) {
        return;
      }

      for (const otherExchangeSlug of otherExchanges) {
        const result =
          await this.spreadCalculator.getLiveSpread(
            symbol,
            exchangeSlug,
            otherExchangeSlug,
            0,
            0,
          );

        this.logger.log(
          `SPREAD ${symbol} | ` +
            `${exchangeSlug} ↔ ${otherExchangeSlug} | ` +
            `Best: ${result.bestDirection.buyOn} → ` +
            `${result.bestDirection.sellOn} | ` +
            `${result.bestDirection.netSpreadPercent.toFixed(4)}%`,
        );
      }
    } catch (error) {
      this.logger.error(
        `خطا در محاسبه Spread برای ${exchangeSlug}:${symbol}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
