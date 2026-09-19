import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';

/**
 * Client مخصوص Info Endpoint های Hyperliquid (https://api.hyperliquid.xyz/info).
 * این endpoint ها Public هستند و نیازی به امضای کیف‌پول ندارند —
 * برای قیمت لحظه‌ای، وضعیت پوزیشن، و موجودی کافیه.
 *
 * ⚠️ برای عملیات نوشتنی (باز/بستن پوزیشن) این کلاس استفاده نمی‌شه؛
 * آن بخش در hyperliquid.exchange-client.ts با SDK رسمی انجام می‌شه،
 * چون امضای EIP-712 دستی برای این سیستم بسیار مستعد خطاست و
 * خطا در امضا مستقیماً به از دست رفتن سرمایه منجر میشه.
 */
export class HyperliquidInfoClient {
  private readonly logger = new Logger(HyperliquidInfoClient.name);
  private readonly http: AxiosInstance;
  private readonly rateLimiter = new SlidingWindowRateLimiter(100, 60_000);

  constructor(baseUrl = 'https://api.hyperliquid.xyz') {
    this.http = axios.create({ baseURL: baseUrl, timeout: 10_000 });
  }

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    await this.rateLimiter.acquire();
    try {
      const response = await this.http.post<T>('/info', body);
      return response.data;
    } catch (err) {
      throw this.toExchangeError(err);
    }
  }

  private toExchangeError(err: unknown): ExchangeError {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new ExchangeError('hyperliquid', 'NETWORK_TIMEOUT', 'درخواست Timeout شد', err);
      }
      if (err.response?.status === 429) {
        return new ExchangeError('hyperliquid', 'RATE_LIMIT', 'محدودیت نرخ درخواست', err);
      }
      return new ExchangeError('hyperliquid', 'UNKNOWN', err.message, err);
    }
    return new ExchangeError('hyperliquid', 'UNKNOWN', 'خطای ناشناخته', err);
  }

  /** میانگین قیمت لحظه‌ای همه Asset ها (Mid Price) */
  async getAllMids(): Promise<Record<string, string>> {
    return this.post<Record<string, string>>({ type: 'allMids' });
  }

  /** بهترین Bid/Ask از L2 Order Book */
  async getL2Book(coin: string) {
    return this.post<{ levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>({
      type: 'l2Book',
      coin,
    });
  }

  /** وضعیت پوزیشن‌ها و موجودی کیف‌پول */
  async getClearinghouseState(walletAddress: string) {
    return this.post<{
      assetPositions: {
        position: { coin: string; szi: string; entryPx: string; unrealizedPnl: string };
      }[];
      marginSummary: { accountValue: string };
      withdrawable: string;
    }>({ type: 'clearinghouseState', user: walletAddress });
  }
}
