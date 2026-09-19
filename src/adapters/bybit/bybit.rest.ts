import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';

export interface BybitCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * REST Client مخصوص Bybit V5 Unified Trading API (category=linear برای Futures).
 *
 * ⚠️ قبل از استفاده روی حساب واقعی، مستندات رسمی رو چک کنید
 * (https://bybit-exchange.github.io/docs/v5/intro) و حتما با Testnet
 * (https://api-testnet.bybit.com) تست کنید.
 */
export class BybitRestClient {
  private readonly logger = new Logger(BybitRestClient.name);
  private readonly http: AxiosInstance;
  private readonly rateLimiter = new SlidingWindowRateLimiter(500, 60_000);
  private readonly recvWindow = '5000';

  constructor(
    private readonly credentials: BybitCredentials,
    baseUrl = 'https://api.bybit.com',
  ) {
    this.http = axios.create({ baseURL: baseUrl, timeout: 10_000 });
  }

  private sign(timestamp: string, payload: string): string {
    const raw = `${timestamp}${this.credentials.apiKey}${this.recvWindow}${payload}`;
    return crypto.createHmac('sha256', this.credentials.apiSecret).update(raw).digest('hex');
  }

  private buildHeaders(timestamp: string, signature: string) {
    return {
      'X-BAPI-API-KEY': this.credentials.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': this.recvWindow,
      'Content-Type': 'application/json',
    };
  }

  private async signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    await this.rateLimiter.acquire();
    const timestamp = Date.now().toString();
    const queryString = new URLSearchParams(params as Record<string, string>).toString();
    const signature = this.sign(timestamp, queryString);

    try {
      const response = await this.http.get<T>(`${path}?${queryString}`, {
        headers: this.buildHeaders(timestamp, signature),
      });
      return response.data;
    } catch (err) {
      throw this.toExchangeError(err);
    }
  }

  private async signedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    await this.rateLimiter.acquire();
    const timestamp = Date.now().toString();
    const bodyString = JSON.stringify(body);
    const signature = this.sign(timestamp, bodyString);

    try {
      const response = await this.http.post<T>(path, body, {
        headers: this.buildHeaders(timestamp, signature),
      });
      return response.data;
    } catch (err) {
      throw this.toExchangeError(err);
    }
  }

  private toExchangeError(err: unknown): ExchangeError {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new ExchangeError('bybit', 'NETWORK_TIMEOUT', 'درخواست Timeout شد', err);
      }
      if (err.response?.status === 429) {
        return new ExchangeError('bybit', 'RATE_LIMIT', 'محدودیت نرخ درخواست', err);
      }
      const retCode = err.response?.data?.retCode;
      if (retCode === 110007 || retCode === 110012) {
        return new ExchangeError('bybit', 'INSUFFICIENT_BALANCE', 'موجودی کافی نیست', err);
      }
      if (err.response?.status === 401) {
        return new ExchangeError('bybit', 'AUTH_ERROR', 'خطای احراز هویت', err);
      }
      return new ExchangeError(
        'bybit',
        'UNKNOWN',
        err.response?.data?.retMsg || err.message,
        err,
      );
    }
    return new ExchangeError('bybit', 'UNKNOWN', 'خطای ناشناخته', err);
  }

  // --- Public ---
  async getTicker(symbol: string) {
    await this.rateLimiter.acquire();
    const response = await this.http.get('/v5/market/tickers', {
      params: { category: 'linear', symbol },
    });
    return response.data.result.list[0] as { symbol: string; bid1Price: string; ask1Price: string };
  }

  // --- Signed ---
  async getWalletBalance(accountType = 'UNIFIED') {
    return this.signedGet<{
      result: { list: { coin: { coin: string; walletBalance: string; availableToWithdraw: string }[] }[] };
    }>('/v5/account/wallet-balance', { accountType });
  }

  async getPositionInfo(symbol: string) {
    return this.signedGet<{
      result: {
        list: { symbol: string; side: string; size: string; avgPrice: string; unrealisedPnl: string }[];
      };
    }>('/v5/position/list', { category: 'linear', symbol });
  }

  async placeOrder(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    orderType: 'Market';
    qty: string;
    reduceOnly?: boolean;
    orderLinkId?: string; // idempotency key بایبیت
  }) {
    return this.signedPost<{
      result: { orderId: string; orderLinkId: string };
      retCode: number;
      retMsg: string;
    }>('/v5/order/create', {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      qty: params.qty,
      ...(params.reduceOnly ? { reduceOnly: true } : {}),
      ...(params.orderLinkId ? { orderLinkId: params.orderLinkId } : {}),
    });
  }

  async getOrderStatus(orderId: string, symbol: string) {
    return this.signedGet<{
      result: { list: { orderId: string; orderStatus: string; cumExecQty: string; avgPrice: string }[] };
    }>('/v5/order/realtime', { category: 'linear', symbol, orderId });
  }
}
