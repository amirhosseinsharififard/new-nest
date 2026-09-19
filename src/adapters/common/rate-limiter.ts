/**
 * Rate Limiter ساده به روش Sliding Window.
 * هر صرافی محدودیت تعداد Request در بازه زمانی مشخص داره (مثلا 1200 request/min در Binance).
 * این کلاس قبل از هر Request چک می‌کنه که از محدودیت رد نشده باشیم؛
 * اگر رد شده بود، منتظر می‌مونه (نه اینکه Request رو رد کنه و Exception بده)
 * چون در مسیر باز کردن پوزیشن، از دست دادن یک Request به‌خاطر Rate Limit خطرناک‌تره
 * از کمی تاخیر.
 */
export class SlidingWindowRateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldestInWindow) + 10;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.acquire(); // بعد از صبر، دوباره چک کن
    }

    this.timestamps.push(now);
  }
}
