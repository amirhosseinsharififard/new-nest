import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * REST Client مخصوص Binance USDT-M Futures API (fapi.binance.com).
 *
 * ⚠️ نکته حیاتی: قبل از استفاده روی حساب واقعی، حتما مستندات رسمی رو
 * چک کنید (https://binance-docs.github.io/apidocs/futures/en/) چون
 * Endpoint ها و پارامترهای دقیق ممکنه از زمان نوشتن این کد تغییر کرده باشن.
 * پیشنهاد میشه ابتدا با Testnet (https://testnet.binancefuture.com) تست بشه.
 */
export class BinanceRestClient {
  private readonly logger = new Logger(BinanceRestClient.name);
  private readonly http: AxiosInstance;
  // محدودیت واقعی Binance حدود 2400 وزن در دقیقه است؛ این یک مقدار محافظه‌کارانه‌ست
  private readonly rateLimiter = new SlidingWindowRateLimiter(1000, 60_000);

  constructor(
    private readonly credentials: BinanceCredentials,
    baseUrl = 'https://fapi.binance.com',
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 10_000,
      headers: { 'X-MBX-APIKEY': this.credentials.apiKey },
    });
  }

  private sign(params: Record<string, string | number>): string {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();
    return crypto
      .createHmac('sha256', this.credentials.apiSecret)
      .update(query)
      .digest('hex');
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT',
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    await this.rateLimiter.acquire();

    const timestamp = Date.now();
    const fullParams = { ...params, timestamp, recvWindow: 5000 };
    const signature = this.sign(fullParams);
    const query = new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...fullParams, signature }).map(([k, v]) => [k, String(v)]),
      ),
    ).toString();

    try {
      const response = await this.http.request<T>({
        method,
        url: `${path}?${query}`,
      });
      return response.data;
    } catch (err) {
      throw this.toExchangeError(err);
    }
  }

  private async publicRequest<T>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    await this.rateLimiter.acquire();
    try {
      const response = await this.http.get<T>(path, { params });
      return response.data;
    } catch (err) {
      throw this.toExchangeError(err);
    }
  }

  private toExchangeError(err: unknown): ExchangeError {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        // Timeout یعنی وضعیت واقعی نامشخصه — این کد در PositionExecutor فاز ۶ حیاتیه
        return new ExchangeError('binance', 'NETWORK_TIMEOUT', 'درخواست Timeout شد', err);
      }
      if (err.response?.status === 429 || err.response?.status === 418) {
        return new ExchangeError('binance', 'RATE_LIMIT', 'محدودیت نرخ درخواست', err);
      }
      if (err.response?.data?.code === -2010) {
        return new ExchangeError(
          'binance',
          'INSUFFICIENT_BALANCE',
          'موجودی کافی نیست',
          err,
        );
      }
      if (err.response?.status === 401 || err.response?.status === 403) {
        return new ExchangeError('binance', 'AUTH_ERROR', 'خطای احراز هویت', err);
      }
      return new ExchangeError(
        'binance',
        'UNKNOWN',
        err.response?.data?.msg || err.message,
        err,
      );
    }
    return new ExchangeError('binance', 'UNKNOWN', 'خطای ناشناخته', err);
  }

  // --- Public endpoints ---

  async getBookTicker(symbol: string) {
    return this.publicRequest<{
      symbol: string;
      bidPrice: string;
      askPrice: string;
    }>('/fapi/v1/ticker/bookTicker', { symbol });
  }

  // --- Signed endpoints ---

  async getBalance() {
    return this.signedRequest<
      { asset: string; balance: string; availableBalance: string }[]
    >('GET', '/fapi/v2/balance');
  }

  async getPositionRisk(symbol?: string) {
    return this.signedRequest<
      { symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string }[]
    >('GET', '/fapi/v2/positionRisk', symbol ? { symbol } : {});
  }

  async placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET';
    quantity: number;
    reduceOnly?: boolean;
    newClientOrderId?: string; // برای idempotency
  }) {
    return this.signedRequest<{
      orderId: number;
      status: string;
      executedQty: string;
      avgPrice: string;
    }>('POST', '/fapi/v1/order', {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      ...(params.reduceOnly ? { reduceOnly: 'true' } : {}),
      ...(params.newClientOrderId ? { newClientOrderId: params.newClientOrderId } : {}),
    });
  }

  /** برای دریافت listenKey جهت اتصال به User Data Stream (پوزیشن/سفارش) */
  async createListenKey() {
    return this.signedRequest<{ listenKey: string }>('POST', '/fapi/v1/listenKey');
  }

  async keepAliveListenKey() {
    return this.signedRequest<Record<string, never>>('PUT', '/fapi/v1/listenKey');
  }
}
