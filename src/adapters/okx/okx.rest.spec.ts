import * as crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { OkxRestClient, OkxCredentials } from './okx.rest';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    isAxiosError: jest.fn(),
  },
}));

describe('OkxRestClient', () => {
  let client: OkxRestClient;

  let httpMock: {
    request: jest.Mock;
    get: jest.Mock;
  };

  const credentials: OkxCredentials = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    passphrase: 'test-passphrase',
  };

  const axiosMock = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();

    httpMock = {
      request: jest.fn(),
      get: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(
      httpMock as unknown as AxiosInstance,
    );

    client = new OkxRestClient(credentials);
  });

  describe('constructor', () => {
    it('should create axios instance with default configuration', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://www.okx.com',
        timeout: 10_000,
      });
    });

    it('should support a custom base URL', () => {
      new OkxRestClient(
        credentials,
        'https://custom-okx.example.com',
      );

      expect(axios.create).toHaveBeenLastCalledWith({
        baseURL: 'https://custom-okx.example.com',
        timeout: 10_000,
      });
    });
  });

  describe('getTicker', () => {
    it('should request ticker data for an instrument', async () => {
      const ticker = {
        instId: 'BTC-USDT-SWAP',
        bidPx: '65000',
        askPx: '65010',
      };

      httpMock.get.mockResolvedValue({
        data: { data: [ticker] },
      });

      await expect(
        client.getTicker('BTC-USDT-SWAP'),
      ).resolves.toEqual(ticker);

      expect(httpMock.get).toHaveBeenCalledWith(
        '/api/v5/market/ticker',
        {
          params: { instId: 'BTC-USDT-SWAP' },
        },
      );
    });

    it('should return the first ticker when multiple records exist', async () => {
      const firstTicker = {
        instId: 'BTC-USDT-SWAP',
        bidPx: '65000',
        askPx: '65010',
      };

      httpMock.get.mockResolvedValue({
        data: {
          data: [
            firstTicker,
            {
              instId: 'ETH-USDT-SWAP',
              bidPx: '3000',
              askPx: '3010',
            },
          ],
        },
      });

      await expect(
        client.getTicker('BTC-USDT-SWAP'),
      ).resolves.toEqual(firstTicker);
    });

    it('should propagate public ticker request errors', async () => {
      const error = new Error('Ticker request failed');
      httpMock.get.mockRejectedValue(error);

      await expect(
        client.getTicker('BTC-USDT-SWAP'),
      ).rejects.toBe(error);
    });
  });

  describe('getBalance', () => {
    it('should send a signed GET balance request', async () => {
      const response = {
        data: [
          {
            details: [
              {
                ccy: 'USDT',
                availBal: '100',
                frozenBal: '20',
              },
            ],
          },
        ],
      };

      httpMock.request.mockResolvedValue({ data: response });

      await expect(client.getBalance()).resolves.toEqual(response);

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/v5/account/balance',
        }),
      );
    });
  });

  describe('getPositions', () => {
    it('should request all positions when instrument is omitted', async () => {
      const response = {
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            posSide: 'long',
            pos: '1',
            avgPx: '65000',
            upl: '100',
          },
        ],
      };

      httpMock.request.mockResolvedValue({ data: response });

      await expect(client.getPositions()).resolves.toEqual(response);

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/v5/account/positions',
        }),
      );
    });

    it('should include instrument ID when provided', async () => {
      httpMock.request.mockResolvedValue({
        data: { data: [] },
      });

      await client.getPositions('BTC-USDT-SWAP');

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/v5/account/positions?instId=BTC-USDT-SWAP',
        }),
      );
    });
  });

  describe('placeOrder', () => {
    it('should send a signed market order', async () => {
      const params = {
        instId: 'BTC-USDT-SWAP',
        side: 'buy' as const,
        ordType: 'market' as const,
        sz: '0.5',
        tdMode: 'cross' as const,
      };

      const response = {
        code: '0',
        msg: '',
        data: [{ ordId: 'order-123', sCode: '0', sMsg: '' }],
      };

      httpMock.request.mockResolvedValue({ data: response });

      await expect(client.placeOrder(params)).resolves.toEqual(response);

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/v5/trade/order',
          data: {
            instId: 'BTC-USDT-SWAP',
            tdMode: 'cross',
            side: 'buy',
            ordType: 'market',
            sz: '0.5',
          },
        }),
      );
    });

    it('should include reduceOnly when enabled', async () => {
      httpMock.request.mockResolvedValue({
        data: { code: '0', msg: '', data: [] },
      });

      await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        side: 'sell',
        ordType: 'market',
        sz: '0.5',
        tdMode: 'cross',
        reduceOnly: true,
      });

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reduceOnly: 'true',
          }),
        }),
      );
    });

    it('should omit reduceOnly when disabled', async () => {
      httpMock.request.mockResolvedValue({
        data: { code: '0', msg: '', data: [] },
      });

      await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        side: 'buy',
        ordType: 'market',
        sz: '0.5',
        tdMode: 'cross',
        reduceOnly: false,
      });

      const requestConfig = httpMock.request.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };

      expect(requestConfig.data).not.toHaveProperty('reduceOnly');
    });

    it('should include client order ID when provided', async () => {
      httpMock.request.mockResolvedValue({
        data: { code: '0', msg: '', data: [] },
      });

      await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        side: 'buy',
        ordType: 'market',
        sz: '1',
        tdMode: 'cross',
        clOrdId: 'client-order-123',
      });

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clOrdId: 'client-order-123',
          }),
        }),
      );
    });

    it('should omit client order ID when not provided', async () => {
      httpMock.request.mockResolvedValue({
        data: { code: '0', msg: '', data: [] },
      });

      await client.placeOrder({
        instId: 'BTC-USDT-SWAP',
        side: 'buy',
        ordType: 'market',
        sz: '1',
        tdMode: 'cross',
      });

      const requestConfig = httpMock.request.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };

      expect(requestConfig.data).not.toHaveProperty('clOrdId');
    });
  });

  describe('getOrderDetails', () => {
    it('should request order details with instrument and order IDs', async () => {
      const response = {
        data: [
          {
            state: 'filled',
            accFillSz: '0.5',
            avgPx: '65000',
          },
        ],
      };

      httpMock.request.mockResolvedValue({ data: response });

      await expect(
        client.getOrderDetails('BTC-USDT-SWAP', 'order-123'),
      ).resolves.toEqual(response);

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/v5/trade/order?instId=BTC-USDT-SWAP&ordId=order-123',
        }),
      );
    });
  });

  describe('getMarketSymbols', () => {
    it('should request public SWAP instruments', async () => {
      httpMock.get.mockResolvedValue({
        data: {
          code: '0',
          msg: '',
          data: [],
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([]);

      expect(httpMock.get).toHaveBeenCalledWith(
        '/api/v5/public/instruments',
        {
          params: { instType: 'SWAP' },
        },
      );
    });

    it('should return only live USDT settled SWAP instruments', async () => {
      httpMock.get.mockResolvedValue({
        data: {
          code: '0',
          msg: '',
          data: [
            {
              instId: 'BTC-USDT-SWAP',
              instType: 'SWAP',
              settleCcy: 'USDT',
              state: 'live',
            },
            {
              instId: 'ETH-USDT-SWAP',
              instType: 'SWAP',
              settleCcy: 'USDT',
              state: 'live',
            },
            {
              instId: 'BTC-USD-SWAP',
              instType: 'SWAP',
              settleCcy: 'USD',
              state: 'live',
            },
            {
              instId: 'SOL-USDT-SWAP',
              instType: 'SWAP',
              settleCcy: 'USDT',
              state: 'suspend',
            },
            {
              instId: 'BTC-USDT',
              instType: 'SPOT',
              settleCcy: 'USDT',
              state: 'live',
            },
          ],
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);
    });

    it('should remove duplicate symbols', async () => {
      httpMock.get.mockResolvedValue({
        data: {
          code: '0',
          msg: '',
          data: [
            {
              instId: 'BTC-USDT-SWAP',
              instType: 'SWAP',
              settleCcy: 'USDT',
              state: 'live',
            },
            {
              instId: 'BTC-USDT-SWAP',
              instType: 'SWAP',
              settleCcy: 'USDT',
              state: 'live',
            },
          ],
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
      ]);
    });

    it('should throw ExchangeError when OKX returns a non-zero response code', async () => {
      httpMock.get.mockResolvedValue({
        data: {
          code: '500',
          msg: 'Internal error',
          data: [],
        },
      });

      await expect(client.getMarketSymbols()).rejects.toBeInstanceOf(
        ExchangeError,
      );
    });
  });

  describe('request authentication', () => {
    it('should include all required OKX authentication headers', async () => {
      httpMock.request.mockResolvedValue({
        data: { data: [] },
      });

      await client.getBalance();

      const requestConfig = httpMock.request.mock.calls[0][0] as {
        headers: Record<string, string>;
      };

      expect(requestConfig.headers).toEqual(
        expect.objectContaining({
          'OK-ACCESS-KEY': credentials.apiKey,
          'OK-ACCESS-PASSPHRASE': credentials.passphrase,
          'OK-ACCESS-TIMESTAMP': expect.any(String),
          'OK-ACCESS-SIGN': expect.any(String),
          'Content-Type': 'application/json',
        }),
      );
    });

    it('should generate a valid HMAC SHA256 signature', async () => {
      httpMock.request.mockResolvedValue({
        data: { data: [] },
      });

      await client.getBalance();

      const requestConfig = httpMock.request.mock.calls[0][0] as {
        method: string;
        url: string;
        data?: unknown;
        headers: Record<string, string>;
      };

      const timestamp = requestConfig.headers['OK-ACCESS-TIMESTAMP'];
      const bodyString = requestConfig.data
        ? JSON.stringify(requestConfig.data)
        : '';

      const prehash = `${timestamp}${requestConfig.method}${requestConfig.url}${bodyString}`;

      const expectedSignature = crypto
        .createHmac('sha256', credentials.apiSecret)
        .update(prehash)
        .digest('base64');

      expect(requestConfig.headers['OK-ACCESS-SIGN']).toBe(
        expectedSignature,
      );
    });

    it('should use an ISO timestamp', async () => {
      httpMock.request.mockResolvedValue({
        data: { data: [] },
      });

      await client.getBalance();

      const requestConfig = httpMock.request.mock.calls[0][0] as {
        headers: Record<string, string>;
      };

      expect(
        Number.isNaN(
          Date.parse(requestConfig.headers['OK-ACCESS-TIMESTAMP']),
        ),
      ).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should convert timeout errors to NETWORK_TIMEOUT', async () => {
      const error = {
        code: 'ECONNABORTED',
        message: 'Request timeout',
      };

      axiosMock.isAxiosError.mockReturnValue(true);
      httpMock.request.mockRejectedValue(error);

      await expect(client.getBalance()).rejects.toMatchObject({
        code: 'NETWORK_TIMEOUT',
      });
    });

    it('should convert ETIMEDOUT errors to NETWORK_TIMEOUT', async () => {
      const error = {
        code: 'ETIMEDOUT',
        message: 'Connection timeout',
      };

      axiosMock.isAxiosError.mockReturnValue(true);
      httpMock.request.mockRejectedValue(error);

      await expect(client.getBalance()).rejects.toMatchObject({
        code: 'NETWORK_TIMEOUT',
      });
    });

    it('should convert HTTP 429 errors to RATE_LIMIT', async () => {
      const error = {
        code: 'ERR_BAD_REQUEST',
        message: 'Too many requests',
        response: { status: 429 },
      };

      axiosMock.isAxiosError.mockReturnValue(true);
      httpMock.request.mockRejectedValue(error);

      await expect(client.getBalance()).rejects.toMatchObject({
        code: 'RATE_LIMIT',
      });
    });

    it.each(['51008', '51004'])(
      'should convert OKX error code %s to INSUFFICIENT_BALANCE',
      async (code) => {
        const error = {
          message: 'Insufficient balance',
          response: {
            status: 400,
            data: {
              code,
              msg: 'Insufficient balance',
            },
          },
        };

        axiosMock.isAxiosError.mockReturnValue(true);
        httpMock.request.mockRejectedValue(error);

        await expect(client.getBalance()).rejects.toMatchObject({
          code: 'INSUFFICIENT_BALANCE',
        });
      },
    );

    it('should convert HTTP 401 errors to AUTH_ERROR', async () => {
      const error = {
        message: 'Unauthorized',
        response: {
          status: 401,
          data: {
            code: '50100',
            msg: 'Invalid API key',
          },
        },
      };

      axiosMock.isAxiosError.mockReturnValue(true);
      httpMock.request.mockRejectedValue(error);

      await expect(client.getBalance()).rejects.toMatchObject({
        code: 'AUTH_ERROR',
      });
    });

    it('should convert other axios errors to UNKNOWN', async () => {
      const error = {
        message: 'Bad request',
        response: {
          status: 400,
          data: {
            code: '50000',
            msg: 'Request failed',
          },
        },
      };

      axiosMock.isAxiosError.mockReturnValue(true);
      httpMock.request.mockRejectedValue(error);

      await expect(client.getBalance()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Request failed',
      });
    });

    it('should convert unknown errors to UNKNOWN', async () => {
      axiosMock.isAxiosError.mockReturnValue(false);
      httpMock.request.mockRejectedValue(new Error('Unexpected error'));

      await expect(client.getBalance()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'خطای ناشناخته',
      });
    });

    it('should throw ExchangeError instances for signed request failures', async () => {
      axiosMock.isAxiosError.mockReturnValue(false);
      httpMock.request.mockRejectedValue(new Error('Unexpected error'));

      await expect(client.getBalance()).rejects.toBeInstanceOf(
        ExchangeError,
      );
    });
  });
});
