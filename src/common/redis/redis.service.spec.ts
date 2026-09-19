// eslint-disable-next-line @typescript-eslint/no-var-requires
const RedisMock = require('ioredis-mock');
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let redisService: RedisService;
  let client: any;

  beforeEach(() => {
    client = new RedisMock();
    redisService = new RedisService(client);
  });

  afterEach(async () => {
    await client.flushall();
  });

  it('set/get باید مقدار ذخیره‌شده را برگرداند', async () => {
    await redisService.set('price:BTCUSDT', '65000.5');
    const value = await redisService.get('price:BTCUSDT');

    expect(value).toBe('65000.5');
  });

  it('get روی کلید ناموجود باید null برگرداند', async () => {
    const value = await redisService.get('non-existent-key');
    expect(value).toBeNull();
  });

  it('del باید کلید را حذف کند', async () => {
    await redisService.set('temp-key', 'value');
    await redisService.del('temp-key');

    const value = await redisService.get('temp-key');
    expect(value).toBeNull();
  });

  describe('Distributed Lock (برای جلوگیری از اجرای هم‌زمان در فاز ۶)', () => {
    it('اولین درخواست lock باید موفق باشد', async () => {
      const acquired = await redisService.acquireLock('lock:position-123', 10);
      expect(acquired).toBe(true);
    });

    it('درخواست دوم lock روی همان کلید قبل از انقضا باید شکست بخورد', async () => {
      await redisService.acquireLock('lock:position-123', 10);
      const secondAttempt = await redisService.acquireLock('lock:position-123', 10);

      expect(secondAttempt).toBe(false);
    });

    it('بعد از releaseLock باید بشود دوباره lock گرفت', async () => {
      await redisService.acquireLock('lock:position-123', 10);
      await redisService.releaseLock('lock:position-123');

      const reacquired = await redisService.acquireLock('lock:position-123', 10);
      expect(reacquired).toBe(true);
    });
  });

  it('ping باید true برگرداند وقتی Redis در دسترس است', async () => {
    const result = await redisService.ping();
    expect(result).toBe(true);
  });
});
