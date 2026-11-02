import { OkxAdapter } from './okx.adapter';
import { OkxRestClient } from './okx.rest';
import { OkxWsManager } from './okx.ws';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import {
  OrderStatus,
  PositionSide,
} from '../../core/exchange/exchange.types';
import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';
import { OpenPositionParams, ClosePositionParams } from '../../core/exchange/exchange.types';

jest.mock('./okx.rest');
jest.mock('./okx.ws');

describe('OkxAdapter', () => {
  let adapter: OkxAdapter;

  let restMock: {
    placeOrder: jest.Mock;
    getOrderDetails: jest.Mock;
    getPositions: jest.Mock;
    getBalance: jest.Mock;
    getMarketSymbols: jest.Mock;
  };

  let wsMock: {
    connectTicker: jest.Mock;
    disconnectTicker: jest.Mock;
    connectTickers: jest.Mock;
    connectPrivate: jest.Mock;
    disconnect: jest.Mock;
    isHealthy: jest.Mock;
  };

  const config = {
    accountId: 'account-1',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    passphrase: 'passphrase',
    restBaseUrl: 'https://www.okx.com',
  } as ExchangeAccountConfig;

  const createAdapter = (
    customConfig: ExchangeAccountConfig = config,
  ): OkxAdapter => new OkxAdapter(customConfig);

  beforeEach(() => {
    jest.clearAllMocks();

    restMock = {
      placeOrder: jest.fn(),
      getOrderDetails: jest.fn(),
      getPositions: jest.fn(),
      getBalance: jest.fn(),
      getMarketSymbols: jest.fn(),
    };

    wsMock = {
      connectTicker: jest.fn().mockResolvedValue(undefined),
      disconnectTicker: jest.fn(),
      connectTickers: jest.fn().mockResolvedValue(undefined),
      connectPrivate: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    };

    (OkxRestClient as jest.MockedClass<typeof OkxRestClient>).mockImplementation(
      () => restMock as unknown as OkxRestClient,
    );

    (OkxWsManager as jest.MockedClass<typeof OkxWsManager>).mockImplementation(
      () => wsMock as unknown as OkxWsManager,
    );

    adapter = createAdapter();
  });

  describe('constructor', () => {
    it('should initialize REST and WebSocket clients', () => {
      expect(OkxRestClient).toHaveBeenCalledWith(
        {
          apiKey: 'api-key',
          apiSecret: 'api-secret',
          passphrase: 'passphrase',
        },
        'https://www.okx.com',
      );

      expect(OkxWsManager).toHaveBeenCalledWith(
        'api-key',
        'api-secret',
        'passphrase',
      );

      expect(adapter.exchangeId).toBe('okx');
    });

    it('should allow public market data configuration without credentials', () => {
      const publicConfig = {
        accountId: 'public-market-data-1',
      } as ExchangeAccountConfig;

      expect(() => createAdapter(publicConfig)).not.toThrow();
    });

    it('should allow configuration without API key for public access', () => {
      const publicConfig = {
        accountId: 'public-account',
      } as ExchangeAccountConfig;

      expect(() => createAdapter(publicConfig)).not.toThrow();
    });

    it('should throw when private credentials are incomplete', () => {
      const invalidConfig = {
        accountId: 'private-account',
        apiKey: 'api-key',
        apiSecret: '',
        passphrase: '',
      } as ExchangeAccountConfig;

      expect(() => createAdapter(invalidConfig)).toThrow(
        'OKX Adapter نیازمند apiKey، apiSecret و passphrase است',
      );
    });
  });

  describe('WebSocket lifecycle', () => {
    it('should connect WebSocket without throwing', async () => {
      await expect(adapter.connectWebSocket()).resolves.toBeUndefined();
    });

    it('should disconnect WebSocket manager', async () => {
      await adapter.disconnectWebSocket();

      expect(wsMock.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should return WebSocket health status', () => {
      wsMock.isHealthy.mockReturnValue(false);

      expect(adapter.isWebSocketHealthy()).toBe(false);
    });
  });

  describe('ticker subscriptions', () => {
    it('should subscribe to a single ticker using OKX symbol', () => {
      const callback = jest.fn();

      adapter.subscribeTicker('BTC-USDT', callback);

      expect(wsMock.connectTicker).toHaveBeenCalledWith(
        'BTC-USDT-SWAP',
        expect.any(Function),
      );
    });

    it('should preserve the original symbol in ticker callback', () => {
      const callback = jest.fn();
      const ticker = {
        exchangeId: 'okx',
        symbol: 'BTC-USDT-SWAP',
        bidPrice: 65000,
        bidSize: 1,
        askPrice: 65010,
        askSize: 2,
        timestamp: 123,
      };

      adapter.subscribeTicker('BTC-USDT', callback);

      const wsCallback = wsMock.connectTicker.mock.calls[0][1] as (
        data: typeof ticker,
      ) => void;

      wsCallback(ticker);

      expect(callback).toHaveBeenCalledWith({
        ...ticker,
        symbol: 'BTC-USDT',
      });
    });

    it('should log single ticker subscription errors', async () => {
      const error = new Error('Connection failed');
      wsMock.connectTicker.mockRejectedValue(error);

      const loggerSpy = jest
        .spyOn(adapter['logger'], 'error')
        .mockImplementation();

      adapter.subscribeTicker('BTC-USDT', jest.fn());

      await Promise.resolve();

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('should unsubscribe from a single ticker', () => {
      adapter.unsubscribeTicker('BTC-USDT');

      expect(wsMock.disconnectTicker).toHaveBeenCalledWith(
        'BTC-USDT-SWAP',
      );
    });

    it('should subscribe to multiple tickers', () => {
      const callback = jest.fn();

      adapter.subscribeTickers(
        ['BTC-USDT', 'ETH-USDT'],
        callback,
      );

      expect(wsMock.connectTickers).toHaveBeenCalledWith(
        ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
        expect.any(Function),
      );
    });

    it('should map batch ticker callbacks to original symbols', () => {
      const callback = jest.fn();

      adapter.subscribeTickers(['BTC-USDT'], callback);

      const wsCallback = wsMock.connectTickers.mock.calls[0][1] as (
        data: {
          exchangeId: string;
          symbol: string;
          bidPrice: number;
          bidSize: number;
          askPrice: number;
          askSize: number;
          timestamp: number;
        },
      ) => void;

      wsCallback({
        exchangeId: 'okx',
        symbol: 'BTC-USDT-SWAP',
        bidPrice: 65000,
        bidSize: 1,
        askPrice: 65010,
        askSize: 2,
        timestamp: 123,
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC-USDT',
        }),
      );
    });

    it('should unsubscribe from multiple tickers', () => {
      adapter.unsubscribeTickers(['BTC-USDT', 'ETH-USDT']);

      expect(wsMock.disconnectTicker).toHaveBeenNthCalledWith(
        1,
        'BTC-USDT-SWAP',
      );

      expect(wsMock.disconnectTicker).toHaveBeenNthCalledWith(
        2,
        'ETH-USDT-SWAP',
      );
    });

    it('should propagate batch subscription errors', () => {
  const error = new Error('Connection failed');

  wsMock.connectTickers.mockImplementation(() => {
    throw error;
  });

  expect(() => {
    adapter.subscribeTickers(['BTCUSDT'], jest.fn());
  }).toThrow(error);
});

  describe('position subscriptions', () => {
    it('should subscribe to private position updates', () => {
      const callback = jest.fn();

      adapter.subscribePositionUpdates('account-1', callback);

      expect(wsMock.connectPrivate).toHaveBeenCalledWith(
        'account-1',
        callback,
      );
    });

    it('should log private subscription errors', async () => {
      wsMock.connectPrivate.mockRejectedValue(
        new Error('Private connection failed'),
      );

      const loggerSpy = jest
        .spyOn(adapter['logger'], 'error')
        .mockImplementation();

      adapter.subscribePositionUpdates('account-1', jest.fn());

      await Promise.resolve();

      expect(loggerSpy).toHaveBeenCalled();
    });
  });

  describe('openPosition', () => {
    const params = {
      symbol: 'BTC-USDT',
      side: PositionSide.LONG,
      quantity: 0.5,
      idempotencyKey: 'order-123-456',
    } as OpenPositionParams;

    it('should place a market buy order for long position', async () => {
      restMock.placeOrder.mockResolvedValue({
        data: [{ ordId: 'order-1', sCode: '0', sMsg: '' }],
        code: '0',
        msg: '',
      });

      restMock.getOrderDetails.mockResolvedValue({
        data: [
          {
            state: 'filled',
            accFillSz: '0.5',
            avgPx: '65000',
          },
        ],
      });

      await adapter.openPosition(params);

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          instId: 'BTC-USDT-SWAP',
          side: 'buy',
          ordType: 'market',
          sz: '0.5',
          tdMode: 'cross',
          reduceOnly: false,
          clOrdId: 'order123456',
        }),
      );
    });

    it('should place a market sell order for short position', async () => {
      restMock.placeOrder.mockResolvedValue({
        data: [{ ordId: 'order-2', sCode: '0', sMsg: '' }],
        code: '0',
        msg: '',
      });

      restMock.getOrderDetails.mockResolvedValue({
        data: [],
      });

      await adapter.openPosition({
        ...params,
        side: PositionSide.SHORT,
      });

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'sell',
          reduceOnly: false,
        }),
      );
    });

    it('should return filled order details', async () => {
      restMock.placeOrder.mockResolvedValue({
        data: [{ ordId: 'order-1', sCode: '0', sMsg: '' }],
        code: '0',
        msg: '',
      });

      restMock.getOrderDetails.mockResolvedValue({
        data: [
          {
            state: 'filled',
            accFillSz: '0.5',
            avgPx: '65000',
          },
        ],
      });

      await expect(adapter.openPosition(params)).resolves.toMatchObject({
        exchangeOrderId: 'order-1',
        status: OrderStatus.FILLED,
        filledQuantity: 0.5,
        avgFillPrice: 65000,
      });
    });

    it('should return submitted status when order details are unavailable', async () => {
      restMock.placeOrder.mockResolvedValue({
        data: [{ ordId: 'order-1', sCode: '0', sMsg: '' }],
        code: '0',
        msg: '',
      });

      restMock.getOrderDetails.mockResolvedValue({ data: [] });

      await expect(adapter.openPosition(params)).resolves.toMatchObject({
        status: OrderStatus.SUBMITTED,
        filledQuantity: 0,
        avgFillPrice: null,
      });
    });

    it('should throw ExchangeError when OKX rejects the order', async () => {
      restMock.placeOrder.mockResolvedValue({
        data: [
          {
            ordId: '',
            sCode: '51008',
            sMsg: 'Insufficient balance',
          },
        ],
        code: '1',
        msg: 'Order rejected',
      });

      await expect(adapter.openPosition(params)).rejects.toBeInstanceOf(
        ExchangeError,
      );
    });

    it('should return UNKNOWN status for network timeout', async () => {
      const error = new ExchangeError(
        'okx',
        'NETWORK_TIMEOUT',
        'Timeout',
      );

      restMock.placeOrder.mockRejectedValue(error);

      await expect(adapter.openPosition(params)).resolves.toMatchObject({
        exchangeOrderId: null,
        status: OrderStatus.UNKNOWN,
        filledQuantity: 0,
        avgFillPrice: null,
      });
    });

    it('should rethrow non-timeout errors', async () => {
      const error = new Error('Unexpected error');
      restMock.placeOrder.mockRejectedValue(error);

      await expect(adapter.openPosition(params)).rejects.toBe(error);
    });
  });

  describe('closePosition', () => {
    const params = {
      symbol: 'BTC-USDT',
      side: PositionSide.LONG,
      quantity: 0.5,
      idempotencyKey: 'close-123',
    } as ClosePositionParams;

    beforeEach(() => {
      restMock.placeOrder.mockResolvedValue({
        data: [{ ordId: 'close-1', sCode: '0', sMsg: '' }],
        code: '0',
        msg: '',
      });

      restMock.getOrderDetails.mockResolvedValue({
        data: [
          {
            state: 'filled',
            accFillSz: '0.5',
            avgPx: '64000',
          },
        ],
      });
    });

    it('should place a sell reduce-only order to close long position', async () => {
      await adapter.closePosition(params);

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          instId: 'BTC-USDT-SWAP',
          side: 'sell',
          reduceOnly: true,
        }),
      );
    });

    it('should place a buy reduce-only order to close short position', async () => {
      await adapter.closePosition({
        ...params,
        side: PositionSide.SHORT,
      });

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'buy',
          reduceOnly: true,
        }),
      );
    });
  });

  describe('getPositionStatus', () => {
    it('should return closed position when no position exists', async () => {
      restMock.getPositions.mockResolvedValue({ data: [] });

      await expect(
        adapter.getPositionStatus('account-1', 'BTC-USDT'),
      ).resolves.toEqual({
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      });

      expect(restMock.getPositions).toHaveBeenCalledWith(
        'BTC-USDT-SWAP',
      );
    });

    it('should return closed position when position size is zero', async () => {
      restMock.getPositions.mockResolvedValue({
        data: [{ pos: '0' }],
      });

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result.isOpen).toBe(false);
      expect(result.quantity).toBe(0);
    });

    it('should return open long position', async () => {
      restMock.getPositions.mockResolvedValue({
        data: [
          {
            pos: '2',
            posSide: 'long',
            avgPx: '65000',
            upl: '100',
          },
        ],
      });

      await expect(
        adapter.getPositionStatus('account-1', 'BTC-USDT'),
      ).resolves.toEqual({
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        isOpen: true,
        quantity: 2,
        entryPrice: 65000,
        unrealizedPnl: 100,
      });
    });

    it('should return open short position', async () => {
      restMock.getPositions.mockResolvedValue({
        data: [
          {
            pos: '-1.5',
            posSide: 'short',
            avgPx: '3000',
            upl: '-25',
          },
        ],
      });

      const result = await adapter.getPositionStatus(
        'account-1',
        'ETH-USDT',
      );

      expect(result).toMatchObject({
        side: PositionSide.SHORT,
        isOpen: true,
        quantity: 1.5,
        entryPrice: 3000,
        unrealizedPnl: -25,
      });
    });

    it('should return null for zero entry price and PnL', async () => {
      restMock.getPositions.mockResolvedValue({
        data: [
          {
            pos: '1',
            posSide: 'long',
            avgPx: '0',
            upl: '0',
          },
        ],
      });

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result.entryPrice).toBeNull();
      expect(result.unrealizedPnl).toBeNull();
    });
  });

  describe('getBalance', () => {
    it('should return available and frozen balances', async () => {
      restMock.getBalance.mockResolvedValue({
        data: [
          {
            details: [
              { ccy: 'USDT', availBal: '100', frozenBal: '20' },
              { ccy: 'BTC', availBal: '0.5', frozenBal: '0' },
            ],
          },
        ],
      });

      await expect(adapter.getBalance('account-1')).resolves.toEqual([
        { asset: 'USDT', free: 100, locked: 20 },
        { asset: 'BTC', free: 0.5, locked: 0 },
      ]);
    });

    it('should exclude assets with zero available and frozen balances', async () => {
      restMock.getBalance.mockResolvedValue({
        data: [
          {
            details: [
              { ccy: 'USDT', availBal: '0', frozenBal: '0' },
              { ccy: 'BTC', availBal: '1', frozenBal: '0' },
            ],
          },
        ],
      });

      await expect(adapter.getBalance('account-1')).resolves.toEqual([
        { asset: 'BTC', free: 1, locked: 0 },
      ]);
    });

    it('should return an empty array when balance details are missing', async () => {
      restMock.getBalance.mockResolvedValue({ data: [] });

      await expect(adapter.getBalance('account-1')).resolves.toEqual([]);
    });
  });

  describe('getMarketSymbols', () => {
    it('should delegate market symbol retrieval to REST client', async () => {
      restMock.getMarketSymbols.mockResolvedValue([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      await expect(adapter.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      expect(restMock.getMarketSymbols).toHaveBeenCalledTimes(1);
    });

    it('should propagate REST errors', async () => {
      const error = new Error('Market symbols unavailable');
      restMock.getMarketSymbols.mockRejectedValue(error);

      await expect(adapter.getMarketSymbols()).rejects.toBe(error);
    });
  });
});
});
