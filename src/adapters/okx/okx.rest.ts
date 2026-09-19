import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';

export interface OkxCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

/**
 * REST Client مخصوص OKX V5 API (Perpetual Swap).
 *
 * ⚠️ قبل از استفاده روی حساب واقعی، مستندات رسمی رو چک کنید
 * (https://www.okx.com/docs-v5/en/) و با Demo Trading (هدر
 * x-simulated-trading: 1) تست کنید.
 */
export class OkxRestClient {
  private readonly logger = new Logger(OkxRestClient.name);
  private readonly http: AxiosInstance;
  private readonly rateLimiter = new SlidingWindowRateLimiter(500, 60_000);

  constructor(
    private readonly credentials: OkxCredentials,
    baseUrl = 'https://www.okx.com',
  ) {
    this.http = axios.create({ baseURL: baseUrl, timeout: 10_000 });
  }

  private sign(timestamp: string, method: string, path: string, body: string): string {
    const prehash = `${timestamp}${method}${path}${body}`;
    return crypto
      .createHmac('sha256', this.credentials.apiSecret)
      .update(prehash)
      .digest('base64');
  }

  private buildHeaders(timestamp: string, method: string, path: string, body: string) {
    return {
      'OK-ACCESS-KEY': this.credentials.apiKey,
      'OK-ACCESS-SIGN': this.sign(timestamp, method, path, body),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.credentials.passphrase,
      'Content-Type': 'application/json',
    };
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string> = {},
    body: Record<string, unknown> | null = null,
  ): Promise<T> {
    await this.rateLimiter.acquire();

    const query = Object.keys(params).length
      ? `?${new URLSearchParams(params).toString()}`
      : '';
    const fullPath = `${path}${query}`;
    // OKX از فرمت ISO 8601 با میلی‌ثانیه برای timestamp استفاده می‌کند
    const timestamp = new Date().toISOString();
    const bodyString = body ? JSON.stringify(body) : '';

    try {
      const response = await this.http.request<T>({
        method,
        url: fullPath,
        data: body ?? undefined,
        headers: this.buildHeaders(timestamp, method, fullPath, bodyString),
      });
      return response.data;
    } catch (err) {
      throw this.toExchangeError(err);
    }
  }

  private toExchangeError(err: unknown): ExchangeError {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new ExchangeError('okx', 'NETWORK_TIMEOUT', 'درخواست Timeout شد', err);
      }
      if (err.response?.status === 429) {
        return new ExchangeError('okx', 'RATE_LIMIT', 'محدودیت نرخ درخواست', err);
      }
      const code = err.response?.data?.code;
      if (code === '51008' || code === '51004') {
        return new ExchangeError('okx', 'INSUFFICIENT_BALANCE', 'موجودی کافی نیست', err);
      }
      if (err.response?.status === 401) {
        return new ExchangeError('okx', 'AUTH_ERROR', 'خطای احراز هویت', err);
      }
      return new ExchangeError(
        'okx',
        'UNKNOWN',
        err.response?.data?.msg || err.message,
        err,
      );
    }
    return new ExchangeError('okx', 'UNKNOWN', 'خطای ناشناخته', err);
  }

  // --- Public ---
  async getTicker(instId: string) {
    await this.rateLimiter.acquire();
    const response = await this.http.get('/api/v5/market/ticker', { params: { instId } });
    return response.data.data[0] as { instId: string; bidPx: string; askPx: string };
  }

  // --- Signed ---
  async getBalance() {
    return this.signedRequest<{
      data: { details: { ccy: string; availBal: string; frozenBal: string }[] }[];
    }>('GET', '/api/v5/account/balance');
  }

  async getPositions(instId?: string) {
    return this.signedRequest<{
      data: { instId: string; posSide: string; pos: string; avgPx: string; upl: string }[];
    }>('GET', '/api/v5/account/positions', instId ? { instId } : {});
  }

  async placeOrder(params: {
    instId: string;
    side: 'buy' | 'sell';
    ordType: 'market';
    sz: string;
    tdMode: 'cross' | 'isolated';
    reduceOnly?: boolean;
    clOrdId?: string; // idempotency key اوکی‌اکس
  }) {
    return this.signedRequest<{
      data: { ordId: string; sCode: string; sMsg: string }[];
      code: string;
      msg: string;
    }>('POST', '/api/v5/trade/order', {}, {
      instId: params.instId,
      tdMode: params.tdMode,
      side: params.side,
      ordType: params.ordType,
      sz: params.sz,
      ...(params.reduceOnly ? { reduceOnly: 'true' } : {}),
      ...(params.clOrdId ? { clOrdId: params.clOrdId } : {}),
    });
  }

  async getOrderDetails(instId: string, ordId: string) {
    return this.signedRequest<{
      data: { state: string; accFillSz: string; avgPx: string }[];
    }>('GET', '/api/v5/trade/order', { instId, ordId });
  }
}
