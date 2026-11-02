
import * as crypto from 'crypto';
import axios from 'axios';

import { BybitRestClient } from './bybit.rest';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    isAxiosError: jest.fn((error) => error?.isAxiosError === true),
  },
}));

describe('BybitRestClient', () => {
  let client: BybitRestClient;
  let http: {
    get: jest.Mock;
    post: jest.Mock;
  };

  const credentials = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
  };

  const baseUrl = 'https://api-testnet.bybit.com';

  beforeEach(() => {
    jest.clearAllMocks();

    http = {
      get: jest.fn(),
      post: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(http);

    jest
      .spyOn(SlidingWindowRateLimiter.prototype, 'acquire')
      .mockResolvedValue(undefined);

    client = new BybitRestClient(credentials, baseUrl);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create axios instance with configured base URL and timeout', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: baseUrl,
        timeout: 10_000,
      });
    });

    it('should use the default base URL when none is provided', () => {
      new BybitRestClient(credentials);

      expect(axios.create).toHaveBeenLastCalledWith({
        baseURL: 'https://api.bybit.com',
        timeout: 10_000,
      });
    });
  });

  describe('getTicker', () => {
    it('should fetch ticker for a linear symbol', async () => {
      const ticker = {
        symbol: 'BTCUSDT',
        bid1Price: '65000',
        ask1Price: '65001',
      };

      http.get.mockResolvedValue({
        data: {
          result: {
            list: [ticker],
          },
        },
      });

      await expect(client.getTicker('BTCUSDT')).resolves.toEqual(ticker);

      expect(http.get).toHaveBeenCalledWith('/v5/market/tickers', {
        params: {
          category: 'linear',
          symbol: 'BTCUSDT',
        },
      });
    });

    it('should return the first ticker when multiple tickers are returned', async () => {
      const firstTicker = { symbol: 'BTCUSDT', bid1Price: '10', ask1Price: '11' };

      http.get.mockResolvedValue({
        data: {
          result: {
            list: [firstTicker, { symbol: 'ETHUSDT' }],
          },
        },
      });

      await expect(client.getTicker('BTCUSDT')).resolves.toEqual(firstTicker);
    });

    it('should return undefined when the ticker list is empty', async () => {
      http.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      await expect(client.getTicker('BTCUSDT')).resolves.toBeUndefined();
    });

    it('should acquire rate limiter before making the request', async () => {
      const acquireSpy = jest.spyOn(
        SlidingWindowRateLimiter.prototype,
        'acquire',
      );

      http.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      await client.getTicker('BTCUSDT');

      expect(acquireSpy).toHaveBeenCalled();
    });
  });

  describe('getWalletBalance', () => {
    it('should request wallet balance using UNIFIED account type by default', async () => {
      const response = {
        result: { list: [] },
      };

      http.get.mockResolvedValue({ data: response });

      await expect(client.getWalletBalance()).resolves.toEqual(response);

      expect(http.get).toHaveBeenCalledWith(
        '/v5/account/wallet-balance?accountType=UNIFIED',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-BAPI-API-KEY': credentials.apiKey,
            'X-BAPI-RECV-WINDOW': '5000',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should support a custom account type', async () => {
      http.get.mockResolvedValue({ data: { result: { list: [] } } });

      await client.getWalletBalance('CONTRACT');

      expect(http.get).toHaveBeenCalledWith(
        '/v5/account/wallet-balance?accountType=CONTRACT',
        expect.any(Object),
      );
    });
  });

  describe('getPositionInfo', () => {
    it('should request position information for a linear symbol', async () => {
      const response = {
        result: {
          list: [{ symbol: 'BTCUSDT', size: '1' }],
        },
      };

      http.get.mockResolvedValue({ data: response });

      await expect(client.getPositionInfo('BTCUSDT')).resolves.toEqual(response);

      expect(http.get).toHaveBeenCalledWith(
        '/v5/position/list?category=linear&symbol=BTCUSDT',
        expect.any(Object),
      );
    });
  });

  describe('placeOrder', () => {
    it('should place a market order with required parameters', async () => {
      const response = {
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'order-1',
          orderLinkId: '',
        },
      };

      http.post.mockResolvedValue({ data: response });

      const params = {
        symbol: 'BTCUSDT',
        side: 'Buy' as const,
        orderType: 'Market' as const,
        qty: '0.01',
      };

      await expect(client.placeOrder(params)).resolves.toEqual(response);

      expect(http.post).toHaveBeenCalledWith(
        '/v5/order/create',
        {
          category: 'linear',
          symbol: 'BTCUSDT',
          side: 'Buy',
          orderType: 'Market',
          qty: '0.01',
        },
        expect.any(Object),
      );
    });

    it('should include reduceOnly when it is true', async () => {
      http.post.mockResolvedValue({
        data: { retCode: 0, result: {} },
      });

      await client.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Sell',
        orderType: 'Market',
        qty: '0.01',
        reduceOnly: true,
      });

      expect(http.post.mock.calls[0][1]).toEqual(
        expect.objectContaining({ reduceOnly: true }),
      );
    });

    it('should not include reduceOnly when it is false', async () => {
      http.post.mockResolvedValue({
        data: { retCode: 0, result: {} },
      });

      await client.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Sell',
        orderType: 'Market',
        qty: '0.01',
        reduceOnly: false,
      });

      expect(http.post.mock.calls[0][1]).not.toHaveProperty('reduceOnly');
    });

    it('should include orderLinkId when provided', async () => {
      http.post.mockResolvedValue({
        data: { retCode: 0, result: {} },
      });

      await client.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '0.01',
        orderLinkId: 'client-order-123',
      });

      expect(http.post.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          orderLinkId: 'client-order-123',
        }),
      );
    });

    it('should omit orderLinkId when it is an empty string', async () => {
      http.post.mockResolvedValue({
        data: { retCode: 0, result: {} },
      });

      await client.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '0.01',
        orderLinkId: '',
      });

      expect(http.post.mock.calls[0][1]).not.toHaveProperty('orderLinkId');
    });
  });

  describe('getOrderStatus', () => {
    it('should request order status using order ID and symbol', async () => {
      const response = {
        result: {
          list: [
            {
              orderId: 'order-123',
              orderStatus: 'Filled',
              cumExecQty: '0.01',
              avgPrice: '65000',
            },
          ],
        },
      };

      http.get.mockResolvedValue({ data: response });

      await expect(
        client.getOrderStatus('order-123', 'BTCUSDT'),
      ).resolves.toEqual(response);

      expect(http.get).toHaveBeenCalledWith(
        '/v5/order/realtime?category=linear&symbol=BTCUSDT&orderId=order-123',
        expect.any(Object),
      );
    });
  });

  describe('request signing', () => {
    it('should generate the expected signature and authentication headers', async () => {
      const timestamp = '1700000000000';
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number(timestamp));

      http.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      await client.getWalletBalance();

      const raw = `${timestamp}${credentials.apiKey}5000accountType=UNIFIED`;
      const expectedSignature = crypto
        .createHmac('sha256', credentials.apiSecret)
        .update(raw)
        .digest('hex');

      expect(http.get).toHaveBeenCalledWith(
        '/v5/account/wallet-balance?accountType=UNIFIED',
        {
          headers: expect.objectContaining({
            'X-BAPI-API-KEY': credentials.apiKey,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-SIGN': expectedSignature,
            'X-BAPI-RECV-WINDOW': '5000',
            'Content-Type': 'application/json',
          }),
        },
      );

      dateNowSpy.mockRestore();
    });

    it('should sign POST requests using the serialized request body', async () => {
      const timestamp = '1700000000000';
      jest.spyOn(Date, 'now').mockReturnValue(Number(timestamp));

      http.post.mockResolvedValue({
        data: { retCode: 0, result: {} },
      });

      const body = {
        category: 'linear',
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '0.01',
      };

      await client.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '0.01',
      });

      const expectedSignature = crypto
        .createHmac('sha256', credentials.apiSecret)
        .update(`${timestamp}${credentials.apiKey}5000${JSON.stringify(body)}`)
        .digest('hex');

      expect(http.post.mock.calls[0][2].headers).toEqual(
        expect.objectContaining({
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-SIGN': expectedSignature,
        }),
      );
    });
  });

  describe('error handling', () => {
    const createAxiosError = (
      message: string,
      options: {
        code?: string;
        status?: number;
        retCode?: number;
        retMsg?: string;
      } = {},
    ) => ({
      isAxiosError: true,
      message,
      code: options.code,
      response: options.status
        ? {
            status: options.status,
            data: {
              retCode: options.retCode,
              retMsg: options.retMsg,
            },
          }
        : undefined,
    });

    it('should map ECONNABORTED to NETWORK_TIMEOUT', async () => {
      http.get.mockRejectedValue(
        createAxiosError('timeout', { code: 'ECONNABORTED' }),
      );

      await expect(client.getWalletBalance()).rejects.toMatchObject({
        exchangeId: 'bybit',
        code: 'NETWORK_TIMEOUT',
        message: 'درخواست Timeout شد',
      });
    });

    it('should map ETIMEDOUT to NETWORK_TIMEOUT', async () => {
      http.get.mockRejectedValue(
        createAxiosError('timeout', { code: 'ETIMEDOUT' }),
      );

      await expect(client.getPositionInfo('BTCUSDT')).rejects.toMatchObject({
        code: 'NETWORK_TIMEOUT',
      });
    });

    it('should map HTTP 429 to RATE_LIMIT', async () => {
      http.get.mockRejectedValue(
        createAxiosError('Too many requests', { status: 429 }),
      );

      await expect(client.getWalletBalance()).rejects.toMatchObject({
        code: 'RATE_LIMIT',
        message: 'محدودیت نرخ درخواست',
      });
    });

    it.each([110007, 110012])(
      'should map retCode %i to INSUFFICIENT_BALANCE',
      async (retCode) => {
        http.post.mockRejectedValue(
          createAxiosError('Insufficient balance', {
            status: 400,
            retCode,
          }),
        );

        await expect(
          client.placeOrder({
            symbol: 'BTCUSDT',
            side: 'Buy',
            orderType: 'Market',
            qty: '1',
          }),
        ).rejects.toMatchObject({
          code: 'INSUFFICIENT_BALANCE',
          message: 'موجودی کافی نیست',
        });
      },
    );

    it('should map HTTP 401 to AUTH_ERROR', async () => {
      http.get.mockRejectedValue(
        createAxiosError('Unauthorized', { status: 401 }),
      );

      await expect(client.getWalletBalance()).rejects.toMatchObject({
        code: 'AUTH_ERROR',
        message: 'خطای احراز هویت',
      });
    });

    it('should map unknown Axios errors using retMsg', async () => {
      http.get.mockRejectedValue(
        createAxiosError('Request failed', {
          status: 500,
          retMsg: 'Internal server error',
        }),
      );

      await expect(client.getWalletBalance()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Internal server error',
      });
    });

    it('should use the Axios message when retMsg is unavailable', async () => {
      http.get.mockRejectedValue(
        createAxiosError('Network failure', { status: 500 }),
      );

      await expect(client.getWalletBalance()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Network failure',
      });
    });

    it('should map non-Axios errors to UNKNOWN', async () => {
      http.get.mockRejectedValue(new Error('Unexpected failure'));

      await expect(client.getWalletBalance()).rejects.toMatchObject({
        exchangeId: 'bybit',
        code: 'UNKNOWN',
        message: 'خطای ناشناخته',
      });
    });
  });

  describe('getMarketSymbols', () => {
    it('should return only active USDT linear perpetual symbols', async () => {
      http.get.mockResolvedValue({
        data: {
          retCode: 0,
          result: {
            list: [
              {
                symbol: 'BTCUSDT',
                status: 'Trading',
                contractType: 'LinearPerpetual',
                baseCoin: 'BTC',
                quoteCoin: 'USDT',
              },
              {
                symbol: 'ETHUSDT',
                status: 'Trading',
                contractType: 'LinearPerpetual',
                baseCoin: 'ETH',
                quoteCoin: 'USDT',
              },
              {
                symbol: 'XRPUSDT',
                status: 'Settling',
                contractType: 'LinearPerpetual',
                baseCoin: 'XRP',
                quoteCoin: 'USDT',
              },
              {
                symbol: 'BTCUSDC',
                status: 'Trading',
                contractType: 'LinearPerpetual',
                baseCoin: 'BTC',
                quoteCoin: 'USDC',
              },
              {
                symbol: 'BTCUSD',
                status: 'Trading',
                contractType: 'InversePerpetual',
                baseCoin: 'BTC',
                quoteCoin: 'USD',
              },
            ],
            nextPageCursor: '',
          },
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      expect(http.get).toHaveBeenCalledWith(
        '/v5/market/instruments-info',
        {
          params: {
            category: 'linear',
            limit: 1000,
          },
        },
      );
    });

    it('should fetch all pages using nextPageCursor', async () => {
      http.get
        .mockResolvedValueOnce({
          data: {
            retCode: 0,
            result: {
              list: [
                {
                  symbol: 'BTCUSDT',
                  status: 'Trading',
                  contractType: 'LinearPerpetual',
                  baseCoin: 'BTC',
                  quoteCoin: 'USDT',
                },
              ],
              nextPageCursor: 'cursor-2',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            retCode: 0,
            result: {
              list: [
                {
                  symbol: 'ETHUSDT',
                  status: 'Trading',
                  contractType: 'LinearPerpetual',
                  baseCoin: 'ETH',
                  quoteCoin: 'USDT',
                },
              ],
              nextPageCursor: '',
            },
          },
        });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      expect(http.get).toHaveBeenCalledTimes(2);

      expect(http.get).toHaveBeenNthCalledWith(2,
        '/v5/market/instruments-info',
        {
          params: {
            category: 'linear',
            limit: 1000,
            cursor: 'cursor-2',
          },
        },
      );
    });

    it('should remove duplicate symbols across pages', async () => {
      const btc = {
        symbol: 'BTCUSDT',
        status: 'Trading',
        contractType: 'LinearPerpetual',
        baseCoin: 'BTC',
        quoteCoin: 'USDT',
      };

      http.get
        .mockResolvedValueOnce({
          data: {
            retCode: 0,
            result: {
              list: [btc],
              nextPageCursor: 'cursor-2',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            retCode: 0,
            result: {
              list: [btc],
              nextPageCursor: '',
            },
          },
        });

      await expect(client.getMarketSymbols()).resolves.toEqual(['BTC-USDT']);
    });

    it('should throw ExchangeError when Bybit returns a non-zero retCode', async () => {
      http.get.mockResolvedValue({
        data: {
          retCode: 10001,
          retMsg: 'Invalid request',
          result: {
            list: [],
            nextPageCursor: '',
          },
        },
      });

      await expect(client.getMarketSymbols()).rejects.toBeInstanceOf(
        ExchangeError,
      );

      await expect(client.getMarketSymbols()).rejects.toMatchObject({
        exchangeId: 'bybit',
        code: 'UNKNOWN',
        message: 'Bybit instruments error: Invalid request',
      });
    });

    it('should return an empty array when no instruments are available', async () => {
      http.get.mockResolvedValue({
        data: {
          retCode: 0,
          result: {
            list: [],
            nextPageCursor: '',
          },
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([]);
    });
  });
});
