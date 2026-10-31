
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketPriceHistory } from
  '../../market-data/entities/market-price-history.entity';

import {
  SpreadAnalyticsResponse,
  SpreadCycle,
  SpreadPairAnalytics,
  SpreadSample,
  SpreadTurningPoint,
  SpreadWindowAnalytics,
} from '../interfaces/spread-analytics.interface';

const WINDOWS = [
  { label: '5m', milliseconds: 5 * 60 * 1000 },
  { label: '10m', milliseconds: 10 * 60 * 1000 },
  { label: '30m', milliseconds: 30 * 60 * 1000 },
  { label: '60m', milliseconds: 60 * 60 * 1000 },
  { label: '24h', milliseconds: 24 * 60 * 60 * 1000 },
];

interface Quote {
  exchangeSlug: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  receivedAt: Date;
}

@Injectable()
export class SpreadAnalyticsService {
  private readonly FILTER_CONFIG = {
    maxQuoteAgeMs: 10_000,
    minPivotDurationMs: 2_000,
    volatilityMultiplier: 2,
    minimumNoiseFloorPercent: 0.001,
  };
  constructor(
    @InjectRepository(MarketPriceHistory)
    private readonly historyRepository: Repository<MarketPriceHistory>,
    ) {}

  async analyze(
    symbol: string,
    maxQuoteAgeMs = 10_000,
  ): Promise<SpreadAnalyticsResponse> {
    if (!symbol?.trim()) {
      throw new BadRequestException('Symbol is required');
    }

    if (
      !Number.isInteger(maxQuoteAgeMs) ||
      maxQuoteAgeMs < 100 ||
      maxQuoteAgeMs > 60_000
    ) {
      throw new BadRequestException(
        'maxQuoteAgeMs must be between 100 and 60000',
      );
    }

    const generatedAt = new Date();
    const from = new Date(
      generatedAt.getTime() - 24 * 60 * 60 * 1000,
    );

    const records = await this.historyRepository
      .createQueryBuilder('history')
      .where('history.symbol = :symbol', {
        symbol: symbol.trim().toUpperCase(),
      })
      .andWhere('history.receivedAt >= :from', { from })
      .orderBy('history.receivedAt', 'ASC')
      .addOrderBy('history.id', 'ASC')
      .getMany();

    if (!records.length) {
      return {
        symbol: symbol.trim().toUpperCase(),
        generatedAt,
        maxQuoteAgeMs,
        pairs: [],
      };
    }

    const samples = this.buildSpreadSamples(
      records,
      maxQuoteAgeMs,
    );

    const pairs: SpreadPairAnalytics[] = [];

    for (const [key, pairSamples] of samples.entries()) {
      const [buyExchange, sellExchange] = key.split('->');

      pairs.push({
        symbol: symbol.trim().toUpperCase(),
        buyExchange,
        sellExchange,
        windows: WINDOWS.map((window) =>
          this.analyzeWindow(
            pairSamples,
            window.label,
            window.milliseconds,
            generatedAt,
          ),
        ),
      });
    }

    return {
      symbol: symbol.trim().toUpperCase(),
      generatedAt,
      maxQuoteAgeMs,
      pairs,
    };
  }

  private buildSpreadSamples(
    records: MarketPriceHistory[],
    maxQuoteAgeMs: number,
  ): Map<string, SpreadSample[]> {
    const latestQuotes = new Map<string, Quote>();
    const samples = new Map<string, SpreadSample[]>();
    const lastPairStates = new Map<string, string>();
    for (const record of records) {
      const currentTime = new Date(record.receivedAt);

      const quote: Quote = {
        exchangeSlug: record.exchangeSlug,
        bidPrice: Number(record.bidPrice),
        bidSize: Number(record.bidSize),
        askPrice: Number(record.askPrice),
        askSize: Number(record.askSize),
        receivedAt: currentTime,
      };

      if (
        !Number.isFinite(quote.bidPrice) ||
        !Number.isFinite(quote.askPrice) ||
        quote.bidPrice <= 0 ||
        quote.askPrice <= 0 ||
        !Number.isFinite(quote.bidSize) ||
        !Number.isFinite(quote.askSize) ||
        quote.bidSize < 0 ||
        quote.askSize < 0
      ) {
        continue;
      }

      const previous = latestQuotes.get(quote.exchangeSlug);

      if (
        previous &&
        previous.receivedAt.getTime() > currentTime.getTime()
      ) {
        continue;
      }

      latestQuotes.set(quote.exchangeSlug, quote);

      for (const other of latestQuotes.values()) {
        if (other.exchangeSlug === quote.exchangeSlug) {
          continue;
        }

        const quoteAge =
          currentTime.getTime() -
          other.receivedAt.getTime();

        if (
          quoteAge < 0 ||
          quoteAge > maxQuoteAgeMs
        ) {
          continue;
        }

        // Buy on current exchange, sell on other exchange.
    this.addSample(
        samples,
        lastPairStates,
        quote,
        other,
      );

      this.addSample(
        samples,
        lastPairStates,
        other,
        quote,
      );
      }
    }

    return samples;
  }

  private addSample(
  samples: Map<string, SpreadSample[]>,
  lastPairStates: Map<string, string>,
  buy: Quote,
  sell: Quote,
): void {
    const buyPrice = buy.askPrice;
    const sellPrice = sell.bidPrice;

    const spreadPercent =
      ((sellPrice - buyPrice) / buyPrice) * 100;

    const key = `${buy.exchangeSlug}->${sell.exchangeSlug}`;

    const fingerprint = JSON.stringify([
      buy.askPrice,
      buy.askSize,
      sell.bidPrice,
      sell.bidSize,
    ]);

    if (lastPairStates.get(key) === fingerprint) {
      return;
    }

    lastPairStates.set(key, fingerprint);
    const sample: SpreadSample = {
      buyExchange: buy.exchangeSlug,
      sellExchange: sell.exchangeSlug,
      buyPrice,
      sellPrice,
      availableBuySize: buy.askSize,
      availableSellSize: sell.bidSize,
      availableSize: Math.min(
        buy.askSize,
        sell.bidSize,
      ),
      spreadPercent,
      timestamp:
        buy.receivedAt.getTime() >= sell.receivedAt.getTime()
          ? buy.receivedAt
          : sell.receivedAt,
    };

    const existing = samples.get(key) ?? [];
    existing.push(sample);
    samples.set(key, existing);
  }

  private analyzeWindow(
  allSamples: SpreadSample[],
  label: string,
  durationMs: number,
  now: Date,
): SpreadWindowAnalytics {
  const startTime = now.getTime() - durationMs;

  const samples = allSamples.filter(
    (sample) =>
      sample.timestamp.getTime() >= startTime &&
      sample.timestamp.getTime() <= now.getTime(),
  );

  if (!samples.length) {
    return {
      window: label,
      sampleCount: 0,
      minSpread: null,
      maxSpread: null,
      averageSpread: null,
      currentSpread: null,
      movement: null,
      noiseThresholdPercent: null,
      turningPoints: [],
      cycles: [],
    };
  }

  const values = samples.map(
    (sample) => sample.spreadPercent,
  );

  const minSpread = Math.min(...values);
  const maxSpread = Math.max(...values);

  const averageSpread =
    values.reduce((sum, value) => sum + value, 0) /
    values.length;

  const noiseThresholdPercent =
    this.calculateAdaptiveNoiseThreshold(samples);

  const turningPoints = this.findTurningPoints(
    samples,
    noiseThresholdPercent,
  );

  const cycles = this.findCycles(turningPoints);

  return {
    window: label,
    sampleCount: samples.length,
    minSpread,
    maxSpread,
    averageSpread,
    currentSpread: values[values.length - 1],
    movement: maxSpread - minSpread,
    noiseThresholdPercent,
    turningPoints,
    cycles,
  };
}


private findTurningPoints(
  samples: SpreadSample[],
  threshold: number,
): SpreadTurningPoint[] {
  const points: SpreadTurningPoint[] = [];

  if (samples.length < 3) {
    return points;
  }

  let trend: -1 | 0 | 1 = 0;

  let extreme = samples[0];

  for (let i = 1; i < samples.length; i++) {
    const current = samples[i];

    const difference =
      current.spreadPercent - extreme.spreadPercent;

    // هنوز جهت حرکت مشخص نشده است
    if (trend === 0) {
      if (difference >= threshold) {
        points.push({
          type: 'MIN',
          spreadPercent: extreme.spreadPercent,
          timestamp: extreme.timestamp,
        });

        trend = 1;
        extreme = current;
      } else if (difference <= -threshold) {
        points.push({
          type: 'MAX',
          spreadPercent: extreme.spreadPercent,
          timestamp: extreme.timestamp,
        });

        trend = -1;
        extreme = current;
      } else if (
        (difference > 0 && trend === 0) ||
        (difference < 0 && trend === 0)
      ) {
        // فقط در صورت تشکیل حرکت معنادار جهت تعیین می‌شود
      }

      continue;
    }

    // روند صعودی: دنبال کردن سقف
    if (trend === 1) {
      if (
        current.spreadPercent > extreme.spreadPercent
      ) {
        extreme = current;
        continue;
      }

      const reversal =
        extreme.spreadPercent - current.spreadPercent;

      const duration =
        current.timestamp.getTime() -
        extreme.timestamp.getTime();

      if (
        reversal >= threshold &&
        duration >= this.FILTER_CONFIG.minPivotDurationMs
      ) {
        points.push({
          type: 'MAX',
          spreadPercent: extreme.spreadPercent,
          timestamp: extreme.timestamp,
        });

        trend = -1;
        extreme = current;
      }

      continue;
    }

    // روند نزولی: دنبال کردن کف
    if (trend === -1) {
      if (
        current.spreadPercent < extreme.spreadPercent
      ) {
        extreme = current;
        continue;
      }

      const reversal =
        current.spreadPercent - extreme.spreadPercent;

      const duration =
        current.timestamp.getTime() -
        extreme.timestamp.getTime();

      if (
        reversal >= threshold &&
        duration >= this.FILTER_CONFIG.minPivotDurationMs
      ) {
        points.push({
          type: 'MIN',
          spreadPercent: extreme.spreadPercent,
          timestamp: extreme.timestamp,
        });

        trend = 1;
        extreme = current;
      }
    }
  }

  return points;
}


  private findCycles(
    points: SpreadTurningPoint[],
  ): SpreadCycle[] {
    const cycles: SpreadCycle[] = [];

    const minima = points
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => point.type === 'MIN');

    for (let i = 0; i < minima.length - 1; i++) {
      const start = minima[i].point;
      const end = minima[i + 1].point;

      const peak = points
        .slice(minima[i].index + 1, minima[i + 1].index)
        .filter((point) => point.type === 'MAX')
        .reduce<SpreadTurningPoint | null>(
          (highest, point) =>
            !highest ||
            point.spreadPercent > highest.spreadPercent
              ? point
              : highest,
          null,
        );

      if (!peak) {
        continue;
      }

      const durationMinutes =
        (end.timestamp.getTime() -
          start.timestamp.getTime()) /
        60_000;

      cycles.push({
        start: start.timestamp,
        peak: peak.timestamp,
        end: end.timestamp,
        entrySpread: start.spreadPercent,
        peakSpread: peak.spreadPercent,
        exitSpread: end.spreadPercent,
        amplitude:
          peak.spreadPercent - start.spreadPercent,
        durationMinutes,
      });
    }

    return cycles;
  }

private calculateAdaptiveNoiseThreshold(
  samples: SpreadSample[],
): number {
  if (samples.length < 3) {
    return this.FILTER_CONFIG.minimumNoiseFloorPercent;
  }

  const deltas: number[] = [];

  for (let i = 1; i < samples.length; i++) {
    deltas.push(
      Math.abs(
        samples[i].spreadPercent -
        samples[i - 1].spreadPercent,
      ),
    );
  }

  const median = this.getMedian(deltas);

  const deviations = deltas.map(
    (value) => Math.abs(value - median),
  );

  const mad = this.getMedian(deviations);

  const adaptiveThreshold =
    median +
    this.FILTER_CONFIG.volatilityMultiplier *
      1.4826 *
      mad;

  return Math.max(
    adaptiveThreshold,
    this.FILTER_CONFIG.minimumNoiseFloorPercent,
  );
}

private getMedian(values: number[]): number {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

}
