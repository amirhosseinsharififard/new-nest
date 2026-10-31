import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService, RedisStreamEntry } from 'src/common/redis/redis.service';
import { MarketPriceHistory } from '../entities/market-price-history.entity';
import { MARKET_HISTORY_STREAM } from './market-history.service';

const CONSUMER_GROUP = 'market-history-workers';
const BATCH_SIZE = 500;
const BLOCK_MS = 1000;
const CLAIM_IDLE_MS = 30_000;
const CLAIM_INTERVAL_MS = 15_000;


@Injectable()
export class MarketHistoryConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MarketHistoryConsumerService.name);

  private running = false;
  private consumerName = `consumer-${process.pid}`;
  private lastClaimAt = 0;
  private readonly INSERT_BATCH_SIZE = 100;
  constructor(
    private readonly redisService: RedisService,
    @InjectRepository(MarketPriceHistory)
    private readonly historyRepository: Repository<MarketPriceHistory>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redisService.createConsumerGroup(
      MARKET_HISTORY_STREAM,
      CONSUMER_GROUP,
    );

    this.running = true;
    void this.consumeLoop();

    this.logger.log('Market history consumer started');
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        // بازیابی پیام‌هایی که Consumer قبلی پردازش نکرده است
        if (Date.now() - this.lastClaimAt >= CLAIM_INTERVAL_MS) {
          this.lastClaimAt = Date.now();

          const pending =
            await this.redisService.claimPendingStreamEntries(
              MARKET_HISTORY_STREAM,
              CONSUMER_GROUP,
              this.consumerName,
              CLAIM_IDLE_MS,
              BATCH_SIZE,
            );

          if (pending.length > 0) {
            await this.processEntries(pending);
            continue;
          }
        }

        const entries = await this.redisService.readStreamGroup(
          MARKET_HISTORY_STREAM,
          CONSUMER_GROUP,
          this.consumerName,
          BATCH_SIZE,
          BLOCK_MS,
        );

        if (entries.length > 0) {
          await this.processEntries(entries);
        }
      } catch (error) {
        this.logger.error(
          'Market history consumer error',
          error instanceof Error ? error.stack : String(error),
        );

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private async processEntries(
    entries: RedisStreamEntry[],
  ): Promise<void> {
    const validEntries: {
      streamId: string;
      record: Partial<MarketPriceHistory>;
    }[] = [];

    const invalidIds: string[] = [];

   for (
      let i = 0;
      i < validEntries.length;
      i += this.INSERT_BATCH_SIZE
    ) {
      const batch = validEntries.slice(
        i,
        i + this.INSERT_BATCH_SIZE,
      );

      await this.historyRepository
        .createQueryBuilder()
        .insert()
        .into(MarketPriceHistory)
        .values(
          batch.map(({ streamId, record }) => ({
            ...record,
            streamId,
          })),
        )
        .orIgnore()
        .execute();
    }

    await this.redisService.acknowledgeStreamEntries(
      MARKET_HISTORY_STREAM,
      CONSUMER_GROUP,
      validEntries.map((entry) => entry.streamId),
    );

    // پیام نامعتبر را نگه نمی‌داریم تا دائماً باعث تکرار خطا نشود.
    if (invalidIds.length > 0) {
      await this.redisService.acknowledgeStreamEntries(
        MARKET_HISTORY_STREAM,
        CONSUMER_GROUP,
        invalidIds,
      );
    }

    if (validEntries.length === 0) return;

   const INSERT_BATCH_SIZE = 100;

for (
  let i = 0;
  i < validEntries.length;
  i += INSERT_BATCH_SIZE
) {
  const batch = validEntries.slice(
    i,
    i + INSERT_BATCH_SIZE,
  );

  await this.historyRepository
    .createQueryBuilder()
    .insert()
    .into(MarketPriceHistory)
    .values(
      batch.map(({ streamId, record }) => ({
        ...record,
        streamId,
      })),
    )
    .orIgnore()
    .execute();
}

    // فقط بعد از موفقیت Insert پیام‌ها تأیید می‌شوند.
    await this.redisService.acknowledgeStreamEntries(
      MARKET_HISTORY_STREAM,
      CONSUMER_GROUP,
      validEntries.map((entry) => entry.streamId),
    );

    this.logger.debug(
      `Persisted ${validEntries.length} market history entries`,
    );
  }

  private parseEntry(
    entry: RedisStreamEntry,
  ): Partial<MarketPriceHistory> {
    this.logger.warn(
      `Invalid entry ${entry.id}: ${JSON.stringify(entry.fields)}`,
    );
    const fields = entry.fields;

    const bidPrice = Number(fields.bidPrice);
    const bidSize = Number(fields.bidSize);
    const askPrice = Number(fields.askPrice);
    const askSize = Number(fields.askSize);

    if (
      !fields.exchangeSlug ||
      !fields.symbol ||
      !Number.isFinite(bidPrice) ||
      !Number.isFinite(bidSize) ||
      !Number.isFinite(askPrice) ||
      !Number.isFinite(askSize) ||
      bidPrice <= 0 ||
      askPrice <= 0 ||
      bidSize < 0 ||
      askSize < 0
    ) {
      throw new Error('Missing or invalid ticker fields');
    }

    const receivedAt = new Date(fields.receivedAt);

    if (!fields.receivedAt || Number.isNaN(receivedAt.getTime())) {
      throw new Error('Invalid receivedAt timestamp');
    }

    const exchangeTimestamp =
      fields.exchangeTimestamp &&
      /^\d+$/.test(fields.exchangeTimestamp)
        ? fields.exchangeTimestamp
        : null;

    return {
      exchangeSlug: fields.exchangeSlug,
      symbol: fields.symbol,
      bidPrice: fields.bidPrice,
      bidSize: fields.bidSize,
      askPrice: fields.askPrice,
      askSize: fields.askSize,
      exchangeTimestamp,
      receivedAt,
    };
  }
}
