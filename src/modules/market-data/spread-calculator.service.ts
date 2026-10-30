
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { TickerData } from '../../core/exchange/exchange.types';
import {
  calculateSpread,
  SpreadResult,
} from './spread-calculation.util';
import { MarketHistoryService } from './services/market-history.service';

/** Redis key: price:<exchange>:<normalized-symbol> */
export function buildPriceCacheKey(
  exchangeSlug: string,
  symbol: string,
): string {
  const normalizedSymbol = symbol
    .replace(/[\/_-]/g, '')
    .toUpperCase();

  return `price:${exchangeSlug.toLowerCase()}:${normalizedSymbol}`;
}

/** Last price remains valid for 10 seconds. */
const PRICE_CACHE_TTL_SECONDS = 10;

export const TICKER_UPDATED_EVENT = 'ticker.updated';

export interface TickerUpdatedPayload {
  exchangeSlug: string;
  symbol: string;
}

@Injectable()
export class SpreadCalculatorService {
  private readonly logger = new Logger(SpreadCalculatorService.name);

  constructor(private readonly redisService: RedisService,
      private readonly marketHistoryService: MarketHistoryService,
  ) {}

  async cacheTicker(
    exchangeSlug: string,
    ticker: TickerData,
  ): Promise<void> {
    const key = buildPriceCacheKey(exchangeSlug, ticker.symbol);

    await Promise.all([
      this.marketHistoryService.recordTicker(exchangeSlug, ticker),
      this.redisService.set(
        key,
        JSON.stringify(ticker),
        PRICE_CACHE_TTL_SECONDS,
      ),
    ]);

    // this.logger.debug(`Cached ticker: ${key}`);
  }

  async getCachedTicker(
    exchangeSlug: string,
    symbol: string,
  ): Promise<TickerData | null> {
    const key = buildPriceCacheKey(exchangeSlug, symbol);
    const raw = await this.redisService.get(key);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as TickerData;
    } catch (error) {
      this.logger.warn(`Invalid cached ticker JSON for ${key}`);
      return null;
    }
  }

  async getLiveSpread(
    symbol: string,
    exchangeASlug: string,
    exchangeBSlug: string,
    feeAPercent: number,
    feeBPercent: number,
  ): Promise<SpreadResult> {
    const [tickerA, tickerB] = await Promise.all([
      this.getCachedTicker(exchangeASlug, symbol),
      this.getCachedTicker(exchangeBSlug, symbol),
    ]);

    if (!tickerA) {
      throw new NotFoundException(
        `No live price for ${symbol} on ${exchangeASlug}; cache is empty or expired.`,
      );
    }

    if (!tickerB) {
      throw new NotFoundException(
        `No live price for ${symbol} on ${exchangeBSlug}; cache is empty or expired.`,
      );
    }

    return calculateSpread(
      symbol,
      tickerA,
      tickerB,
      feeAPercent,
      feeBPercent,
    );
  }



  async getAllLiveMarketData(exchangeSlugs: string[]) {
    const symbols: Record<
      string,
      {
        symbol: string;
        exchanges: Record<string, TickerData>;
      }
    > = {};

    await Promise.all(
      exchangeSlugs.map(async (exchangeSlug) => {
        const keys = await this.redisService.scanKeys(
          `price:${exchangeSlug.toLowerCase()}:*`,
        );

        await Promise.all(
          keys.map(async (key) => {
            const raw = await this.redisService.get(key);
            if (!raw) return;

            try {
              const ticker = JSON.parse(raw) as TickerData;
              if (!ticker?.symbol) return;

              const normalizedSymbol = ticker.symbol
                .replace(/[\/_-]/g, '')
                .toUpperCase();

              if (!symbols[normalizedSymbol]) {
                symbols[normalizedSymbol] = {
                  symbol: ticker.symbol,
                  exchanges: {},
                };
              }

              symbols[normalizedSymbol].exchanges[exchangeSlug] = ticker;
            } catch {
              this.logger.warn(`Invalid ticker JSON for key ${key}`);
            }
          }),
        );
      }),
    );

    const result = Object.values(symbols).map((item) => {
      const exchanges = Object.entries(item.exchanges);

      const comparisons = exchanges.flatMap(([exchangeA, tickerA], i) =>
        exchanges.slice(i + 1).flatMap(([exchangeB, tickerB]) =>
          [
            {
              buyExchange: exchangeA,
              sellExchange: exchangeB,
              buyTicker: tickerA,
              sellTicker: tickerB,
            },
            {
              buyExchange: exchangeB,
              sellExchange: exchangeA,
              buyTicker: tickerB,
              sellTicker: tickerA,
            },
          ]
            .map(({ buyExchange, sellExchange, buyTicker, sellTicker }) => {
              const buyPrice = Number(buyTicker.askPrice);
              const sellPrice = Number(sellTicker.bidPrice);
              const buyAskSize = Number(buyTicker.askSize);
              const sellBidSize = Number(sellTicker.bidSize);

              if (
                !Number.isFinite(buyPrice) ||
                !Number.isFinite(sellPrice) ||
                !Number.isFinite(buyAskSize) ||
                !Number.isFinite(sellBidSize) ||
                buyPrice <= 0 ||
                sellPrice <= 0 ||
                buyAskSize <= 0 ||
                sellBidSize <= 0
              ) {
                return null;
              }

              const priceDifference = sellPrice - buyPrice;

              return {
                buyExchange,
                sellExchange,
                buyPrice,
                sellPrice,
                priceDifference,
                spreadPercent: (priceDifference / buyPrice) * 100,
                availableSize: Math.min(buyAskSize, sellBidSize),
                buyAskSize,
                sellBidSize,
              };
            })
            .filter((comparison) => comparison !== null),
        ),
      );

      // Best price spread first
      comparisons.sort((a, b) => b.spreadPercent - a.spreadPercent);

      return {
        symbol: item.symbol,
        exchanges: item.exchanges,
        comparisons,
      };
    });

    return {
      count: result.length,
      symbols: result,
    };
  }


}
