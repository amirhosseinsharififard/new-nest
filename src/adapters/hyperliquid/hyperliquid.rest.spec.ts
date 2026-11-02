import axios, { AxiosInstance } from 'axios';
import { HyperliquidInfoClient } from './hyperliquid.rest';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    isAxiosError: jest.fn(),
  },
}));

describe('HyperliquidInfoClient', () => {
  let client: HyperliquidInfoClient;
  let httpMock: {
    post: jest.Mock;
  };

  const axiosMock = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();

    httpMock = {
      post: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(
      httpMock as unknown as AxiosInstance,
    );

    client = new HyperliquidInfoClient();
  });

  describe('constructor', () => {
    it('should create axios instance with default configuration', () => {
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://api.hyperliquid.xyz',
        timeout: 10_000,
      });
    });

    it('should support custom base URL', () => {
      new HyperliquidInfoClient('https://custom-api.example.com');

      expect(axios.create).toHaveBeenLastCalledWith({
        baseURL: 'https://custom-api.example.com',
        timeout: 10_000,
      });
    });
  });

  describe('getAllMids', () => {
    it('should request all mid prices', async () => {
      const response = {
        BTC: '65000',
        ETH: '3000',
      };

      httpMock.post.mockResolvedValue({ data: response });

      await expect(client.getAllMids()).resolves.toEqual(response);

      expect(httpMock.post).toHaveBeenCalledWith('/info', {
        type: 'allMids',
      });
    });
  });

  describe('getMarketSymbols', () => {
    it('should return normalized market symbols', async () => {
      httpMock.post.mockResolvedValue({
        data: {
          universe: [
            { name: 'BTC', szDecimals: 5, maxLeverage: 50 },
            { name: 'ETH', szDecimals: 4, maxLeverage: 50 },
          ],
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      expect(httpMock.post).toHaveBeenCalledWith('/info', {
        type: 'meta',
      });
    });

    it('should remove empty names and duplicate symbols', async () => {
      httpMock.post.mockResolvedValue({
        data: {
          universe: [
            { name: 'btc', szDecimals: 5, maxLeverage: 50 },
            { name: ' BTC ', szDecimals: 5, maxLeverage: 50 },
            { name: '   ', szDecimals: 5, maxLeverage: 50 },
            { name: 'eth', szDecimals: 4, maxLeverage: 50 },
          ],
        },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);
    });

    it('should return an empty array when universe is empty', async () => {
      httpMock.post.mockResolvedValue({
        data: { universe: [] },
      });

      await expect(client.getMarketSymbols()).resolves.toEqual([]);
    });
  });

  describe('getL2Book', () => {
    it('should request L2 order book for a coin', async () => {
      const response = {
        levels: [
          [{ px: '65000', sz: '1.5' }],
          [{ px: '65010', sz: '2.5' }],
        ],
      };

      httpMock.post.mockResolvedValue({ data: response });

      await expect(client.getL2Book('BTC')).resolves.toEqual(response);

      expect(httpMock.post).toHaveBeenCalledWith('/info', {
        type: 'l2Book',
        coin: 'BTC',
      });
    });
  });

  describe('getClearinghouseState', () => {
    it('should request account state for wallet address', async () => {
      const walletAddress = '0x1234567890abcdef';

      const response = {
        assetPositions: [],
        marginSummary: { accountValue: '1000' },
        withdrawable: '500',
      };

      httpMock.post.mockResolvedValue({ data: response });

      await expect(
        client.getClearinghouseState(walletAddress),
      ).resolves.toEqual(response);

      expect(httpMock.post).toHaveBeenCalledWith('/info', {
        type: 'clearinghouseState',
        user: walletAddress,
      });
    });
  });

  describe('error handling', () => {
    it('should convert timeout errors to ExchangeError', async () => {
  const error = {
    code: 'ECONNABORTED',
    message: 'timeout',
  };

  axiosMock.isAxiosError.mockReturnValue(true);
  httpMock.post.mockRejectedValue(error);

  await expect(client.getAllMids()).rejects.toMatchObject({
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
      httpMock.post.mockRejectedValue(error);

      await expect(client.getAllMids()).rejects.toMatchObject({
        code: 'RATE_LIMIT',
      });
    });

    it('should convert other axios errors to UNKNOWN', async () => {
      const error = {
        code: 'ERR_BAD_REQUEST',
        message: 'Bad request',
        response: { status: 400 },
      };

      axiosMock.isAxiosError.mockReturnValue(true);
      httpMock.post.mockRejectedValue(error);

      await expect(client.getAllMids()).rejects.toMatchObject({
        code: 'UNKNOWN',
      });
    });

    it('should convert unknown errors to UNKNOWN', async () => {
      axiosMock.isAxiosError.mockReturnValue(false);
      httpMock.post.mockRejectedValue(new Error('Unexpected error'));

      await expect(client.getAllMids()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'خطای ناشناخته',
      });
    });
  });
});
