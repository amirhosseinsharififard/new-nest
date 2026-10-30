import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';


export interface RedisStreamEntry {
  id: string;
  fields: Record<string, string>;
}

/**
 * لایه انتزاعی روی ioredis. Serviceهای دیگه (مثل PriceAggregator در فاز ۴
 * یا Lock مکانیزم فاز ۶) مستقیم با Redis client کار نمی‌کنن، از این عبور می‌کنن
 * تا اگر بعدا خواستیم Redis رو عوض کنیم، فقط این فایل تغییر کنه.
 */
@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Distributed Lock ساده با NX (فقط اگر کلید وجود نداشت ست میشه).
   * در فاز ۶ برای جلوگیری از اجرای هم‌زمان دو درخواست باز کردن پوزیشن یکسان لازم میشه.
   * برمی‌گردونه true اگر لاک گرفته شد.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }


  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500,
      );

      keys.push(...batch);
      cursor = nextCursor;
    } while (cursor !== '0');

    return keys;
  }


async addToStream(
  stream: string,
  fields: Record<string, string>,
): Promise<string> {
  const args = Object.entries(fields).flatMap(([key, value]) => [
    key,
    value,
  ]);

 const id = await this.client.xadd(stream, '*', ...args);

  if (!id) {
    throw new Error(`Failed to add entry to Redis Stream: ${stream}`);
  }

  return id;
}

async createConsumerGroup(
  stream: string,
  group: string,
): Promise<void> {
  try {
    await this.client.xgroup(
      'CREATE',
      stream,
      group,
      '0',
      'MKSTREAM',
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('BUSYGROUP')
    ) {
      return;
    }

    throw error;
  }
}

async readStreamGroup(
  stream: string,
  group: string,
  consumer: string,
  count = 500,
  blockMs = 1000,
): Promise<RedisStreamEntry[]> {
  const response = (await this.client.xreadgroup(
    'GROUP',
    group,
    consumer,
    'COUNT',
    count,
    'BLOCK',
    blockMs,
    'STREAMS',
    stream,
    '>',
  )) as [string, [string, string[]][]][] | null;

  if (!response) return [];

  return response.flatMap(([, messages]) =>
    messages.map(([id, values]) => ({
      id,
      fields: Object.fromEntries(
        Array.from(
          { length: values.length / 2 },
          (_, i) => [values[i * 2], values[i * 2 + 1]],
        ),
      ),
    })),
  );
}

async claimPendingStreamEntries(
  stream: string,
  group: string,
  consumer: string,
  minIdleMs = 30_000,
  count = 500,
): Promise<RedisStreamEntry[]> {
  const response = (await this.client.call(
    'XAUTOCLAIM',
    stream,
    group,
    consumer,
    String(minIdleMs),
    '0-0',
    'COUNT',
    String(count),
  )) as [string, [string, string[]][], string[]?];

  return (response?.[1] ?? []).map(([id, values]) => ({
    id,
    fields: Object.fromEntries(
      Array.from(
        { length: values.length / 2 },
        (_, i) => [values[i * 2], values[i * 2 + 1]],
      ),
    ),
  }));
}

async acknowledgeStreamEntries(
  stream: string,
  group: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  await this.client.xack(stream, group, ...ids);
}




}
