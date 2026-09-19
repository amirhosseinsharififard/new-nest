import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '../../common/redis/redis.service';
import { TickerData } from '../../core/exchange/exchange.types';
import { calculateSpread, SpreadResult } from './spread-calculation.util';

/** ساخت کلید Redis برای ذخیره آخرین قیمت هر (صرافی، Symbol) */
export function buildPriceCacheKey(exchangeSlug: string, symbol: string): string {
  return `price:${exchangeSlug}:${symbol}`;
}

/**
 * TTL کش قیمت. اگر قیمتی قدیمی‌تر از این مقدار باشه یعنی WebSocket
 * برای اون Symbol قطع شده یا دیگه Update نمی‌گیریم — نباید بهش اعتماد کرد.
 */
const PRICE_CACHE_TTL_SECONDS = 10;

/** Event که با هر آپدیت قیمت جدید Emit میشه؛ OpportunityDetectorService به این گوش می‌ده */
export const TICKER_UPDATED_EVENT = 'ticker.updated';

export interface TickerUpdatedPayload {
  exchangeSlug: string;
  symbol: string;
}

@Injectable()
export class SpreadCalculatorService {
  private readonly logger = new Logger(SpreadCalculatorService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** ذخیره آخرین قیمت دریافتی از WebSocket یک صرافی (توسط PriceAggregatorService صدا زده میشه) */
  async cacheTicker(exchangeSlug: string, ticker: TickerData): Promise<void> {
    const key = buildPriceCacheKey(exchangeSlug, ticker.symbol);
    await this.redisService.set(key, JSON.stringify(ticker), PRICE_CACHE_TTL_SECONDS);

    // به‌جای اینکه OpportunityDetector منتظر Interval بعدی (تا ۵ ثانیه) بمونه،
    // همین لحظه که قیمت جدید اومد، یک Event می‌فرستیم تا فوراً چک بشه.
    this.eventEmitter.emit(TICKER_UPDATED_EVENT, {
      exchangeSlug,
      symbol: ticker.symbol,
    } as TickerUpdatedPayload);
  }

  async getCachedTicker(exchangeSlug: string, symbol: string): Promise<TickerData | null> {
    const key = buildPriceCacheKey(exchangeSlug, symbol);
    const raw = await this.redisService.get(key);
    return raw ? (JSON.parse(raw) as TickerData) : null;
  }

  /**
   * محاسبه Spread زنده بین دو صرافی برای یک Symbol، با استفاده از
   * آخرین قیمت‌های Cache شده در Redis.
   *
   * اگر یکی از دو قیمت موجود نباشه (یا منقضی شده باشه)، به‌جای محاسبه
   * نادرست، خطای صریح می‌ده — چون Spread محاسبه‌شده با قیمت قدیمی
   * می‌تونه باعث تصمیم معاملاتی اشتباه بشه.
   */
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
        `قیمت زنده‌ای برای ${symbol} در صرافی ${exchangeASlug} موجود نیست (Cache خالی یا منقضی)`,
      );
    }
    if (!tickerB) {
      throw new NotFoundException(
        `قیمت زنده‌ای برای ${symbol} در صرافی ${exchangeBSlug} موجود نیست (Cache خالی یا منقضی)`,
      );
    }

    return calculateSpread(symbol, tickerA, tickerB, feeAPercent, feeBPercent);
  }
}
