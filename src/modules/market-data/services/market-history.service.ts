
import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import { TickerData } from 'src/core/exchange/exchange.types'; 

export const MARKET_HISTORY_STREAM = 'market:history:ticks';

@Injectable()
export class MarketHistoryService {
  constructor(private readonly redisService: RedisService) {}

  async recordTicker(
    exchangeSlug: string,
    ticker: TickerData,
  ): Promise<void> {
    await this.redisService.addToStream(MARKET_HISTORY_STREAM, {
      exchangeSlug,
      symbol: ticker.symbol,
      bidPrice: String(ticker.bidPrice),
      bidSize: String(ticker.bidSize),
      askPrice: String(ticker.askPrice),
      askSize: String(ticker.askSize),
      exchangeTimestamp:
        ticker.timestamp == null ? '' : String(ticker.timestamp),
      receivedAt: new Date().toISOString(),
    });
  }
}
