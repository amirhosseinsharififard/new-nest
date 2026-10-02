import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

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

  /** Incremental iteration only; callers must never use Redis KEYS on market namespaces. */
  async scan(match: string, count = 100): Promise<string[]> {
    let cursor = '0';
    const keys: string[] = [];
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', count);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
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
}
