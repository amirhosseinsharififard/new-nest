
import axios from 'axios';

import { GateIoRestClient } from './gateio.rest';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    isAxiosError: jest.fn(
      (error) => error?.isAxiosError === true,
    ),
  },
}));

describe('GateIoRestClient', () => {
  let client: GateIoRestClient;
  let httpMock: {
    get: jest.Mock;
  };

  let acquireSpy: jest.SpyInstance;

  const mockContracts = [
    {
      name: 'BTC_USDT',
      type: 'direct',
      quanto_multiplier: '0.0001',
      order_size_min: 1,
      order_size_max: 1000000,
      status: 'trading',
      in_delisting: false,
    },
    {
      name: 'ETH_USDT',
      type: 'direct',
      quanto_multiplier: '0.01',
      order_size_min: 1,
      order_size_max: 1000000,
      status: 'trading',
      in_delisting: false,
    },
    {
      name: 'OLD_USDT',
      type: 'direct',
      quanto_multiplier: '0.01',
      order_size_min: 1,
      order_size_max: 1000000,
      status: 'delisting',
      in_delisting: false,
    },
    {
      name: 'DELISTED_USDT',
      type: 'direct',
      quanto_multiplier: '0.01',
      order_size_min: 1,
      order_size_max: 1000000,
      status: 'trading',
      in_delisting: true,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    httpMock = {
      get: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(httpMock);

    acquireSpy = jest
      .spyOn(SlidingWindowRateLimiter.prototype, 'acquire')
      .mockResolvedValue(undefined);

    client = new GateIoRestClient('https://test.gateio.com/api/v4');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create Axios instance with the provided base URL', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://test.gateio.com/api/v4',
        timeout: 10000,
      });
    });

    it('should use the default base URL when none is provided', () => {
      new GateIoRestClient();

      expect(axios.create).toHaveBeenLastCalledWith({
        baseURL: 'https://api.gateio.ws/api/v4',
        timeout: 10000,
      });
    });
  });

  describe('publicRequest', () => {
    it('should acquire rate limiter before making a request', async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      await client.getContracts();

      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(httpMock.get).toHaveBeenCalledWith(
        '/futures/usdt/contracts',
      );
    });

    it('should return response data', async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      const result = await client.getContracts();

      expect(result).toEqual(mockContracts.slice(0, 2));
    });

    it('should map request timeout to NETWORK_TIMEOUT', async () => {
      const error = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout',
      };

      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      httpMock.get.mockRejectedValue(error);

      await expect(client.getContracts()).rejects.toMatchObject({
        exchangeId: 'gateio',
        code: 'NETWORK_TIMEOUT',
        message: 'Gate.io request timed out',
      });
    });

    it('should map ETIMEDOUT to NETWORK_TIMEOUT', async () => {
      const error = {
        isAxiosError: true,
        code: 'ETIMEDOUT',
        message: 'timeout',
      };

      httpMock.get.mockRejectedValue(error);

      await expect(client.getContracts()).rejects.toMatchObject({
        exchangeId: 'gateio',
        code: 'NETWORK_TIMEOUT',
      });
    });

    it('should map HTTP 429 to RATE_LIMIT', async () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          data: {},
        },
        message: 'Too many requests',
      };

      httpMock.get.mockRejectedValue(error);

      await expect(client.getContracts()).rejects.toMatchObject({
        exchangeId: 'gateio',
        code: 'RATE_LIMIT',
        message: 'Gate.io rate limit exceeded',
      });
    });

    it('should map other Axios errors to UNKNOWN', async () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          data: {
            message: 'Internal server error',
          },
        },
        message: 'Request failed',
      };

      httpMock.get.mockRejectedValue(error);

      await expect(client.getContracts()).rejects.toMatchObject({
        exchangeId: 'gateio',
        code: 'UNKNOWN',
        message: 'Internal server error',
      });
    });

    it('should use Axios error message when response message is unavailable', async () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          data: {},
        },
        message: 'Request failed',
      };

      httpMock.get.mockRejectedValue(error);

      await expect(client.getContracts()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Request failed',
      });
    });

    it('should map non-Axios errors to UNKNOWN', async () => {
      httpMock.get.mockRejectedValue(new Error('Unexpected failure'));

      await expect(client.getContracts()).rejects.toMatchObject({
        exchangeId: 'gateio',
        code: 'UNKNOWN',
      });
    });

    it('should preserve the original error as cause', async () => {
      const error = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout',
      };

      httpMock.get.mockRejectedValue(error);

      try {
        await client.getContracts();
        fail('Expected request to throw');
      } catch (caught) {
        expect(caught).toBeInstanceOf(ExchangeError);
        expect(caught).toBeInstanceOf(ExchangeError);
        expect(caught).toMatchObject({
          exchangeId: 'gateio',
          code: 'NETWORK_TIMEOUT',
        });
      }
    });
  });

  describe('getContracts', () => {
    it('should request USDT futures contracts', async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      await client.getContracts();

      expect(httpMock.get).toHaveBeenCalledWith(
        '/futures/usdt/contracts',
      );
    });

    it('should return only active trading contracts', async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      const result = await client.getContracts();

      expect(result).toHaveLength(2);
      expect(result.map((contract) => contract.name)).toEqual([
        'BTC_USDT',
        'ETH_USDT',
      ]);
    });

    it('should return an empty array when no active contracts exist', async () => {
      httpMock.get.mockResolvedValue({
        data: [
          {
            ...mockContracts[0],
            status: 'delisting',
          },
        ],
      });

      await expect(client.getContracts()).resolves.toEqual([]);
    });

    it('should clear previously cached contracts before storing new ones', async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      await client.getContracts();

      httpMock.get.mockResolvedValue({
        data: [mockContracts[1]],
      });

      await client.getContracts();

      expect(() => client.getContractMultiplier('BTC-USDT')).toThrow(
        'Gate.io contract not found: BTC_USDT',
      );

      expect(client.getContractMultiplier('ETH-USDT')).toBe(0.01);
    });
  });

  describe('getMarketSymbols', () => {
    it('should return normalized market symbols', async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      const result = await client.getMarketSymbols();

      expect(result).toEqual(['BTC-USDT', 'ETH-USDT']);
    });

    it('should return unique symbols', async () => {
      httpMock.get.mockResolvedValue({
        data: [
          mockContracts[0],
          {
            ...mockContracts[0],
          },
        ],
      });

      const result = await client.getMarketSymbols();

      expect(result).toEqual(['BTC-USDT']);
    });

    it('should return an empty array when no active contracts exist', async () => {
      httpMock.get.mockResolvedValue({
        data: [],
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([]);
    });

    it('should propagate contract request errors', async () => {
      httpMock.get.mockRejectedValue(new Error('Network failure'));

      await expect(client.getMarketSymbols()).rejects.toThrow(
        ExchangeError,
      );
    });
  });

  describe('getContractMultiplier', () => {
    beforeEach(async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      await client.getContracts();
    });

    it('should return the multiplier for a known contract', () => {
      expect(client.getContractMultiplier('BTC-USDT')).toBe(0.0001);
    });

    it('should normalize lowercase symbols', () => {
      expect(client.getContractMultiplier('btc-usdt')).toBe(0.0001);
    });

    it('should throw when contract does not exist', () => {
      expect(() => client.getContractMultiplier('SOL-USDT')).toThrow(
        'Gate.io contract not found: SOL_USDT',
      );
    });

    it('should throw when multiplier is zero', async () => {
      httpMock.get.mockResolvedValue({
        data: [
          {
            ...mockContracts[0],
            quanto_multiplier: '0',
          },
        ],
      });

      await client.getContracts();

      expect(() => client.getContractMultiplier('BTC-USDT')).toThrow(
        'Invalid Gate.io contract multiplier: BTC_USDT',
      );
    });

    it('should throw when multiplier is negative', async () => {
      httpMock.get.mockResolvedValue({
        data: [
          {
            ...mockContracts[0],
            quanto_multiplier: '-0.01',
          },
        ],
      });

      await client.getContracts();

      expect(() => client.getContractMultiplier('BTC-USDT')).toThrow(
        'Invalid Gate.io contract multiplier: BTC_USDT',
      );
    });

    it('should throw when multiplier is not numeric', async () => {
      httpMock.get.mockResolvedValue({
        data: [
          {
            ...mockContracts[0],
            quanto_multiplier: 'invalid',
          },
        ],
      });

      await client.getContracts();

      expect(() => client.getContractMultiplier('BTC-USDT')).toThrow(
        'Invalid Gate.io contract multiplier: BTC_USDT',
      );
    });
  });

  describe('getTokenSize', () => {
    beforeEach(async () => {
      httpMock.get.mockResolvedValue({
        data: mockContracts,
      });

      await client.getContracts();
    });

    it('should convert contract size to token size', () => {
      expect(client.getTokenSize('BTC-USDT', 100)).toBe(0.01);
    });

    it('should handle fractional contract sizes', () => {
      expect(client.getTokenSize('ETH-USDT', 1.5)).toBe(0.015);
    });

    it('should return zero for zero contract size', () => {
      expect(client.getTokenSize('BTC-USDT', 0)).toBe(0);
    });

    it('should propagate errors for unknown contracts', () => {
      expect(() => client.getTokenSize('SOL-USDT', 100)).toThrow(
        'Gate.io contract not found: SOL_USDT',
      );
    });
  });
});
