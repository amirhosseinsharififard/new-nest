import { SlidingWindowRateLimiter } from './rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('باید تا سقف مجاز بدون تاخیر عبور کند', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);
    const start = Date.now();

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(Date.now() - start).toBeLessThan(100);
  });

  it('باید بعد از رسیدن به سقف، تا آزاد شدن پنجره صبر کند', async () => {
    const limiter = new SlidingWindowRateLimiter(2, 300);

    await limiter.acquire();
    await limiter.acquire();

    const start = Date.now();
    await limiter.acquire(); // این یکی باید صبر کنه
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(250); // با کمی tolerance
  }, 2000);
});
