
import * as crypto from 'crypto';
import axios from 'axios';
import { BinanceRestClient } from './binance.rest';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    isAxiosError: jest.fn(),
  },
}));

describe('BinanceRestClient', () => {
  let client: BinanceRestClient;
  let http: {
    request: jest.Mock;
    get: jest.Mock;
  };

  const credentials = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    http = {
      request: jest.fn(),
      get: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(http);

    client = new BinanceRestClient(credentials);
  });

  describe('constructor', () => {
    it('should create Axios instance with correct configuration', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://fapi.binance.com',
        timeout: 10_000,
        headers: {
          'X-MBX-APIKEY': credentials.apiKey,
        },
      });
    });

    it('should support a custom base URL', () => {
      new BinanceRestClient(credentials, 'https://testnet.binancefuture.com');

      expect(axios.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseURL: 'https://testnet.binancefuture.com',
        }),
      );
    });
  });

  describe('getBookTicker', () => {
    it('should request book ticker with the given symbol', async () => {
      const response = {
        symbol: 'BTCUSDT',
        bidPrice: '60000',
        bidQty: '1.5',
        askPrice: '60001',
        askQty: '2',
        time: 123456,
      };

      http.get.mockResolvedValue({ data: response });

      await expect(client.getBookTicker('BTCUSDT')).resolves.toEqual(response);

      expect(http.get).toHaveBeenCalledWith(
        '/fapi/v1/ticker/bookTicker',
        { params: { symbol: 'BTCUSDT' } },
      );
      expect(http.request).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('should make a signed GET request', async () => {
      const response = [
        {
          asset: 'USDT',
          balance: '100',
          availableBalance: '80',
        },
      ];

      http.request.mockResolvedValue({ data: response });

      await expect(client.getBalance()).resolves.toEqual(response);

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: expect.stringMatching(/^\/fapi\/v2\/balance\?/),
        }),
      );
    });
  });

  describe('getPositionRisk', () => {
    it('should request all positions when symbol is omitted', async () => {
      http.request.mockResolvedValue({ data: [] });

      await client.getPositionRisk();

      const request = http.request.mock.calls[0][0];

      expect(request.method).toBe('GET');
      expect(request.url).toMatch(/^\/fapi\/v2\/positionRisk\?/);
      expect(request.url).not.toContain('symbol=');
    });

    it('should include symbol when provided', async () => {
      http.request.mockResolvedValue({ data: [] });

      await client.getPositionRisk('BTCUSDT');

      const request = http.request.mock.calls[0][0];

      expect(request.url).toContain('symbol=BTCUSDT');
    });
  });

  describe('placeOrder', () => {
    const orderParams = {
      symbol: 'BTCUSDT',
      side: 'BUY' as const,
      type: 'MARKET' as const,
      quantity: 0.01,
    };

    it('should submit a market order', async () => {
      const response = {
        orderId: 123,
        status: 'FILLED',
        executedQty: '0.01',
        avgPrice: '60000',
      };

      http.request.mockResolvedValue({ data: response });

      await expect(client.placeOrder(orderParams)).resolves.toEqual(response);

      const request = http.request.mock.calls[0][0];
      const params = new URLSearchParams(request.url.split('?')[1]);

      expect(request.method).toBe('POST');
      expect(request.url).toContain('/fapi/v1/order?');
      expect(params.get('symbol')).toBe('BTCUSDT');
      expect(params.get('side')).toBe('BUY');
      expect(params.get('type')).toBe('MARKET');
      expect(params.get('quantity')).toBe('0.01');
    });

    it('should include reduceOnly when true', async () => {
      http.request.mockResolvedValue({ data: {} });

      await client.placeOrder({
        ...orderParams,
        reduceOnly: true,
      });

      const params = new URLSearchParams(
        http.request.mock.calls[0][0].url.split('?')[1],
      );

      expect(params.get('reduceOnly')).toBe('true');
    });

    it('should omit reduceOnly when false', async () => {
      http.request.mockResolvedValue({ data: {} });

      await client.placeOrder({
        ...orderParams,
        reduceOnly: false,
      });

      const params = new URLSearchParams(
        http.request.mock.calls[0][0].url.split('?')[1],
      );

      expect(params.has('reduceOnly')).toBe(false);
    });

    it('should include newClientOrderId when provided', async () => {
      http.request.mockResolvedValue({ data: {} });

      await client.placeOrder({
        ...orderParams,
        newClientOrderId: 'client-order-123',
      });

      const params = new URLSearchParams(
        http.request.mock.calls[0][0].url.split('?')[1],
      );

      expect(params.get('newClientOrderId')).toBe('client-order-123');
    });

    it('should omit newClientOrderId when not provided', async () => {
      http.request.mockResolvedValue({ data: {} });

      await client.placeOrder(orderParams);

      const params = new URLSearchParams(
        http.request.mock.calls[0][0].url.split('?')[1],
      );

      expect(params.has('newClientOrderId')).toBe(false);
    });
  });

  describe('listen key', () => {
    it('should create a listen key using signed POST', async () => {
      const response = { listenKey: 'test-listen-key' };
      http.request.mockResolvedValue({ data: response });

      await expect(client.createListenKey()).resolves.toEqual(response);

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: expect.stringMatching(/^\/fapi\/v1\/listenKey\?/),
        }),
      );
    });

    it('should keep the listen key alive using signed PUT', async () => {
      http.request.mockResolvedValue({ data: {} });

      await client.keepAliveListenKey();

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: expect.stringMatching(/^\/fapi\/v1\/listenKey\?/),
        }),
      );
    });
  });

  describe('getMarketSymbols', () => {
    it('should return only unique trading USDT perpetual symbols', async () => {
      http.get.mockResolvedValue({
        data: {
          symbols: [
            {
              symbol: 'BTCUSDT',
              baseAsset: 'BTC',
              quoteAsset: 'USDT',
              contractType: 'PERPETUAL',
              status: 'TRADING',
            },
            {
              symbol: 'ETHUSDT',
              baseAsset: 'ETH',
              quoteAsset: 'USDT',
              contractType: 'PERPETUAL',
              status: 'TRADING',
            },
            {
              symbol: 'BTCUSDT',
              baseAsset: 'BTC',
              quoteAsset: 'USDT',
              contractType: 'PERPETUAL',
              status: 'TRADING',
            },
            {
              symbol: 'BTCUSD',
              baseAsset: 'BTC',
              quoteAsset: 'USD',
              contractType: 'PERPETUAL',
              status: 'TRADING',
            },
            {
              symbol: 'BTCUSDT',
              baseAsset: 'BTC',
              quoteAsset: 'USDT',
              contractType: 'CURRENT_QUARTER',
              status: 'TRADING',
            },
            {
              symbol: 'XRPUSDT',
              baseAsset: 'XRP',
              quoteAsset: 'USDT',
              contractType: 'PERPETUAL',
              status: 'PENDING_TRADING',
            },
          ],
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      expect(http.get).toHaveBeenCalledWith(
        '/fapi/v1/exchangeInfo',
        { params: {} },
      );
    });

    it('should return an empty array when no symbols match', async () => {
      http.get.mockResolvedValue({
        data: { symbols: [] },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([]);
    });
  });

  describe('request signing', () => {
    it('should include timestamp, recvWindow and a valid HMAC signature', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      http.request.mockResolvedValue({ data: [] });

      await client.getBalance();

      const request = http.request.mock.calls[0][0];
      const params = new URLSearchParams(request.url.split('?')[1]);

      expect(params.get('timestamp')).toBe('1700000000000');
      expect(params.get('recvWindow')).toBe('5000');

      const signature = params.get('signature');
      expect(signature).not.toBeNull();

      params.delete('signature');

      const expectedSignature = crypto
        .createHmac('sha256', credentials.apiSecret)
        .update(params.toString())
        .digest('hex');

      expect(signature).toBe(expectedSignature);
    });

    it('should generate a different signature for different parameters', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      http.request.mockResolvedValue({ data: [] });

      await client.getPositionRisk('BTCUSDT');
      await client.getPositionRisk('ETHUSDT');

      const firstParams = new URLSearchParams(
        http.request.mock.calls[0][0].url.split('?')[1],
      );

      const secondParams = new URLSearchParams(
        http.request.mock.calls[1][0].url.split('?')[1],
      );

      expect(firstParams.get('signature')).not.toBe(
        secondParams.get('signature'),
      );
    });
  });

  describe('error handling', () => {
    const createAxiosError = (code?: string, status?: number, data?: any) => ({
      isAxiosError: true,
      code,
      message: 'Request failed',
      response: status
        ? {
            status,
            data,
          }
        : undefined,
    });

    beforeEach(() => {
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
    });

    it.each(['ECONNABORTED', 'ETIMEDOUT'])(
      'should map %s to NETWORK_TIMEOUT',
      async (code) => {
        http.request.mockRejectedValue(createAxiosError(code));

        await expect(client.getBalance()).rejects.toMatchObject({
          exchangeId: 'binance',
          code: 'NETWORK_TIMEOUT',
        });
      },
    );

    it.each([418, 429])(
      'should map HTTP %i to RATE_LIMIT',
      async (status) => {
        http.get.mockRejectedValue(createAxiosError(undefined, status));

        await expect(client.getBookTicker('BTCUSDT')).rejects.toMatchObject({
          exchangeId: 'binance',
          code: 'RATE_LIMIT',
        });
      },
    );

    it('should map Binance error code -2010 to INSUFFICIENT_BALANCE', async () => {
      http.request.mockRejectedValue(
        createAxiosError(undefined, 400, { code: -2010 }),
      );

      await expect(client.getBalance()).rejects.toMatchObject({
        exchangeId: 'binance',
        code: 'INSUFFICIENT_BALANCE',
      });
    });

    it.each([401, 403])(
      'should map HTTP %i to AUTH_ERROR',
      async (status) => {
        http.request.mockRejectedValue(createAxiosError(undefined, status));

        await expect(client.getBalance()).rejects.toMatchObject({
          exchangeId: 'binance',
          code: 'AUTH_ERROR',
        });
      },
    );

    it('should map other Axios errors to UNKNOWN', async () => {
      http.request.mockRejectedValue(
        createAxiosError(undefined, 500, { msg: 'Internal server error' }),
      );

      await expect(client.getBalance()).rejects.toMatchObject({
        exchangeId: 'binance',
        code: 'UNKNOWN',
        message: 'Internal server error',
      });
    });

    it('should map non-Axios errors to UNKNOWN', async () => {
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);

      http.request.mockRejectedValue(new Error('Unexpected error'));

      await expect(client.getBalance()).rejects.toMatchObject({
        exchangeId: 'binance',
        code: 'UNKNOWN',
        message: 'خطای ناشناخته',
      });
    });
  });
});
