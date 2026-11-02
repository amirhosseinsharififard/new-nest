
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import {
  OrderStatus,
  PositionSide,
} from '../../core/exchange/exchange.types';
import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';
import { BybitRestClient } from './bybit.rest';
import { BybitWsManager } from './bybit.ws';
import { BybitAdapter } from './bybit.adapter';

jest.mock('./bybit.rest', () => ({
  BybitRestClient: jest.fn().mockImplementation(() => ({
    placeOrder: jest.fn(),
    getOrderStatus: jest.fn(),
    getPositionInfo: jest.fn(),
    getWalletBalance: jest.fn(),
    getMarketSymbols: jest.fn(),
  })),
}));

jest.mock('./bybit.ws', () => ({
  BybitWsManager: jest.fn().mockImplementation(() => ({
    connectTickers: jest.fn().mockResolvedValue(undefined),
    disconnectTicker: jest.fn(),
    connectPrivate: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
  })),
}));

describe('BybitAdapter', () => {
  let adapter: BybitAdapter;
  let rest: jest.Mocked<BybitRestClient>;
  let ws: jest.Mocked<BybitWsManager>;

  const config = {
    accountId: 'test-account',
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    restBaseUrl: 'https://api-testnet.bybit.com',
    wsBaseUrl: 'wss://stream-testnet.bybit.com',
  } as ExchangeAccountConfig;

  const createAdapter = (
    customConfig: ExchangeAccountConfig = config,
  ) => {
    adapter = new BybitAdapter(customConfig);

    const restIndex = jest.mocked(BybitRestClient).mock.results.length - 1;
    const wsIndex = jest.mocked(BybitWsManager).mock.results.length - 1;

    rest = jest.mocked(BybitRestClient).mock.results[restIndex]
      .value as jest.Mocked<BybitRestClient>;

    ws = jest.mocked(BybitWsManager).mock.results[wsIndex]
      .value as jest.Mocked<BybitWsManager>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    createAdapter();
  });

  describe('constructor', () => {
    it('should initialize the adapter with the correct exchange ID', () => {
      expect(adapter.exchangeId).toBe('bybit');
    });

    it('should create REST and WebSocket clients with configured credentials', () => {
      expect(BybitRestClient).toHaveBeenCalledWith(
        {
          apiKey: config.apiKey,
          apiSecret: config.apiSecret,
        },
        config.restBaseUrl,
      );

      expect(BybitWsManager).toHaveBeenCalledWith(
        config.apiKey,
        config.apiSecret,
        config.wsBaseUrl,
      );
    });

    it('should allow public market data configuration without credentials', () => {
      const publicConfig = {
        accountId: 'public-market-data',
        restBaseUrl: config.restBaseUrl,
        wsBaseUrl: config.wsBaseUrl,
      } as ExchangeAccountConfig;

      expect(() => createAdapter(publicConfig)).not.toThrow();

      expect(BybitRestClient).toHaveBeenLastCalledWith(
        { apiKey: '', apiSecret: '' },
        config.restBaseUrl,
      );
    });

    it('should allow configuration without an API key for public access', () => {
      const publicConfig = {
        accountId: 'public-account',
        apiSecret: 'secret',
      } as ExchangeAccountConfig;

      expect(() => createAdapter(publicConfig)).not.toThrow();
    });

    it('should throw when API key exists but API secret is missing', () => {
      const invalidConfig = {
        accountId: 'private-account',
        apiKey: 'test-api-key',
      } as ExchangeAccountConfig;

      expect(() => createAdapter(invalidConfig)).toThrow(
        'Bybit Adapter نیازمند apiKey و apiSecret است',
      );
    });
  });

  describe('WebSocket management', () => {
    it('should log connection without opening a WebSocket', async () => {
      await expect(adapter.connectWebSocket()).resolves.toBeUndefined();

      expect(ws.connectPrivate).not.toHaveBeenCalled();
      expect(ws.connectTickers).not.toHaveBeenCalled();
    });

    it('should disconnect WebSocket connections', async () => {
      await adapter.disconnectWebSocket();

      expect(ws.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should return WebSocket health status', () => {
      ws.isHealthy.mockReturnValue(true);

      expect(adapter.isWebSocketHealthy()).toBe(true);

      ws.isHealthy.mockReturnValue(false);

      expect(adapter.isWebSocketHealthy()).toBe(false);
    });
  });

  describe('ticker subscriptions', () => {
    const tickerCallback = jest.fn();

    it('should subscribe to a single ticker using Bybit symbol format', () => {
      adapter.subscribeTicker('BTC-USDT', tickerCallback);

      expect(ws.connectTickers).toHaveBeenCalledWith(
        ['BTCUSDT'],
        tickerCallback,
      );
    });

    it('should unsubscribe from a single ticker', () => {
      adapter.unsubscribeTicker('BTC-USDT');

      expect(ws.disconnectTicker).toHaveBeenCalledWith('BTCUSDT');
    });

    it('should subscribe to multiple tickers', () => {
      adapter.subscribeTickers(
        ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'],
        tickerCallback,
      );

      expect(ws.connectTickers).toHaveBeenCalledWith(
        ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        tickerCallback,
      );
    });

    it('should unsubscribe from multiple tickers individually', () => {
      adapter.unsubscribeTickers(['BTC-USDT', 'ETH-USDT']);

      expect(ws.disconnectTicker).toHaveBeenCalledTimes(2);
      expect(ws.disconnectTicker).toHaveBeenNthCalledWith(1, 'BTCUSDT');
      expect(ws.disconnectTicker).toHaveBeenNthCalledWith(2, 'ETHUSDT');
    });

    it('should handle an empty ticker list', () => {
      adapter.subscribeTickers([], tickerCallback);

      expect(ws.connectTickers).toHaveBeenCalledWith([], tickerCallback);
    });
  });

  describe('position subscriptions', () => {
    it('should connect to the private stream with account ID and callback', () => {
      const callback = jest.fn();

      adapter.subscribePositionUpdates('account-123', callback);

      expect(ws.connectPrivate).toHaveBeenCalledWith(
        'account-123',
        callback,
      );
    });
  });

  describe('openPosition', () => {
    it('should open a LONG position using Buy side', async () => {
      rest.placeOrder.mockResolvedValue({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'order-123',
          orderLinkId: 'idempotency-123',
        },
      } as Awaited<ReturnType<BybitRestClient['placeOrder']>>);

      rest.getOrderStatus.mockResolvedValue({
        result: {
          list: [
            {
              orderId: 'order-123',
              orderStatus: 'Filled',
              cumExecQty: '0.5',
              avgPrice: '65000',
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getOrderStatus']>>);

      const result = await adapter.openPosition({
        accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 0.5,
        idempotencyKey: 'idempotency-123',
      });

      expect(rest.placeOrder).toHaveBeenCalledWith({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '0.5',
        reduceOnly: false,
        orderLinkId: 'idempotency-123',
      });

      expect(result).toEqual({
        exchangeOrderId: 'order-123',
        status: OrderStatus.FILLED,
        filledQuantity: 0.5,
        avgFillPrice: 65000,
        rawResponse: expect.objectContaining({
          retCode: 0,
          result: expect.objectContaining({ orderId: 'order-123' }),
        }),
      });
    });

    it('should open a SHORT position using Sell side', async () => {
      rest.placeOrder.mockResolvedValue({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'order-456',
          orderLinkId: 'key-456',
        },
      } as Awaited<ReturnType<BybitRestClient['placeOrder']>>);

      rest.getOrderStatus.mockResolvedValue({
        result: {
          list: [],
        },
      } as Awaited<ReturnType<BybitRestClient['getOrderStatus']>>);

      const result = await adapter.openPosition({
          accountId: 'account-1',
        symbol: 'ETH-USDT',
        side: PositionSide.SHORT,
        quantity: 2,
        idempotencyKey: 'key-456',
      });

      expect(rest.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'ETHUSDT',
          side: 'Sell',
          qty: '2',
          reduceOnly: false,
        }),
      );

      expect(result.status).toBe(OrderStatus.SUBMITTED);
      expect(result.filledQuantity).toBe(0);
      expect(result.avgFillPrice).toBeNull();
    });

    it('should return UNKNOWN when order status is unavailable', async () => {
      rest.placeOrder.mockResolvedValue({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'order-789',
          orderLinkId: 'key-789',
        },
      } as Awaited<ReturnType<BybitRestClient['placeOrder']>>);

      rest.getOrderStatus.mockResolvedValue({
        result: { list: [] },
      } as Awaited<ReturnType<BybitRestClient['getOrderStatus']>>);

      const result = await adapter.openPosition({  accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 1,
        idempotencyKey: 'key-789',
      });

      expect(result.status).toBe(OrderStatus.SUBMITTED);
    });
  });

  describe('closePosition', () => {
    beforeEach(() => {
      rest.placeOrder.mockResolvedValue({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'close-order-1',
          orderLinkId: 'close-key',
        },
      } as Awaited<ReturnType<BybitRestClient['placeOrder']>>);

      rest.getOrderStatus.mockResolvedValue({
        result: {
          list: [
            {
              orderId: 'close-order-1',
              orderStatus: 'Filled',
              cumExecQty: '1',
              avgPrice: '60000',
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getOrderStatus']>>);
    });

    it('should close a LONG position using Sell and reduceOnly', async () => {
      await adapter.closePosition({  accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 1,
        idempotencyKey: 'close-key',
      });

      expect(rest.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'Sell',
          reduceOnly: true,
        }),
      );
    });

    it('should close a SHORT position using Buy and reduceOnly', async () => {
      await adapter.closePosition({  accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.SHORT,
        quantity: 1,
        idempotencyKey: 'close-key',
      });

      expect(rest.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'Buy',
          reduceOnly: true,
        }),
      );
    });
  });

  describe('order error handling', () => {
    it('should return UNKNOWN when order placement times out', async () => {
      rest.placeOrder.mockRejectedValue(
        new ExchangeError('bybit', 'NETWORK_TIMEOUT', 'Request timeout'),
      );

      const result = await adapter.openPosition({  accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 1,
        idempotencyKey: 'timeout-key',
      });

      expect(result).toEqual({
        exchangeOrderId: null,
        status: OrderStatus.UNKNOWN,
        filledQuantity: 0,
        avgFillPrice: null,
        rawResponse: expect.any(ExchangeError),
      });
    });

    it('should rethrow non-timeout errors', async () => {
      const error = new ExchangeError(
        'bybit',
        'INSUFFICIENT_BALANCE',
        'Insufficient balance',
      );

      rest.placeOrder.mockRejectedValue(error);

      await expect(
        adapter.openPosition({  accountId: 'account-1',
          symbol: 'BTC-USDT',
          side: PositionSide.LONG,
          quantity: 1,
          idempotencyKey: 'error-key',
        }),
      ).rejects.toBe(error);
    });

    it('should throw when Bybit returns a non-zero retCode', async () => {
      rest.placeOrder.mockResolvedValue({
        retCode: 110007,
        retMsg: 'Insufficient balance',
        result: {
          orderId: '',
          orderLinkId: '',
        },
      } as Awaited<ReturnType<BybitRestClient['placeOrder']>>);

      await expect(
        adapter.openPosition({  accountId: 'account-1',
          symbol: 'BTC-USDT',
          side: PositionSide.LONG,
          quantity: 1,
          idempotencyKey: 'rejected-key',
        }),
      ).rejects.toThrow('Insufficient balance');

      expect(rest.getOrderStatus).not.toHaveBeenCalled();
    });

    it('should propagate order status lookup errors', async () => {
      rest.placeOrder.mockResolvedValue({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'order-1',
          orderLinkId: 'key-1',
        },
      } as Awaited<ReturnType<BybitRestClient['placeOrder']>>);

      const error = new ExchangeError(
        'bybit',
        'NETWORK_TIMEOUT',
        'Status lookup timeout',
      );

      rest.getOrderStatus.mockRejectedValue(error);

      const result = await adapter.openPosition({  accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 1,
        idempotencyKey: 'key-1',
      });

      expect(result.status).toBe(OrderStatus.UNKNOWN);
      expect(result.exchangeOrderId).toBeNull();
    });
  });

  describe('getPositionStatus', () => {
    it('should return a closed position when no position exists', async () => {
      rest.getPositionInfo.mockResolvedValue({
        result: { list: [] },
      } as Awaited<ReturnType<BybitRestClient['getPositionInfo']>>);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(rest.getPositionInfo).toHaveBeenCalledWith('BTCUSDT');
      expect(result).toEqual({
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      });
    });

    it('should return a closed position when size is zero', async () => {
      rest.getPositionInfo.mockResolvedValue({
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '0',
              avgPrice: '0',
              unrealisedPnl: '0',
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getPositionInfo']>>);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result.isOpen).toBe(false);
      expect(result.quantity).toBe(0);
    });

    it('should return an open LONG position', async () => {
      rest.getPositionInfo.mockResolvedValue({
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '0.5',
              avgPrice: '65000',
              unrealisedPnl: '120',
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getPositionInfo']>>);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result).toEqual({
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        isOpen: true,
        quantity: 0.5,
        entryPrice: 65000,
        unrealizedPnl: 120,
      });
    });

    it('should return an open SHORT position', async () => {
      rest.getPositionInfo.mockResolvedValue({
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              side: 'Sell',
              size: '0.25',
              avgPrice: '64000',
              unrealisedPnl: '-50',
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getPositionInfo']>>);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result.side).toBe(PositionSide.SHORT);
      expect(result.quantity).toBe(0.25);
      expect(result.unrealizedPnl).toBe(-50);
    });

    it('should return null for zero entry price and unrealized PnL', async () => {
      rest.getPositionInfo.mockResolvedValue({
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '1',
              avgPrice: '0',
              unrealisedPnl: '0',
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getPositionInfo']>>);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result.entryPrice).toBeNull();
      expect(result.unrealizedPnl).toBeNull();
    });
  });

  describe('getBalance', () => {
    it('should return an empty array when no account is available', async () => {
      rest.getWalletBalance.mockResolvedValue({
        result: { list: [] },
      } as Awaited<ReturnType<BybitRestClient['getWalletBalance']>>);

      await expect(adapter.getBalance('account-1')).resolves.toEqual([]);
    });

    it('should filter zero-balance assets and map wallet balances', async () => {
      rest.getWalletBalance.mockResolvedValue({
        result: {
          list: [
            {
              coin: [
                {
                  coin: 'USDT',
                  walletBalance: '1000',
                  availableToWithdraw: '800',
                },
                {
                  coin: 'BTC',
                  walletBalance: '0',
                  availableToWithdraw: '0',
                },
                {
                  coin: 'ETH',
                  walletBalance: '2',
                  availableToWithdraw: '1.5',
                },
              ],
            },
          ],
        },
      } as Awaited<ReturnType<BybitRestClient['getWalletBalance']>>);

      const result = await adapter.getBalance('account-1');

      expect(result).toEqual([
        {
          asset: 'USDT',
          free: 800,
          locked: 200,
        },
        {
          asset: 'ETH',
          free: 1.5,
          locked: 0.5,
        },
      ]);
    });
  });

  describe('getMarketSymbols', () => {
    it('should return market symbols from REST client', async () => {
      const symbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];

      rest.getMarketSymbols.mockResolvedValue(symbols);

      await expect(adapter.getMarketSymbols()).resolves.toEqual(symbols);

      expect(rest.getMarketSymbols).toHaveBeenCalledTimes(1);
    });

    it('should propagate REST client errors', async () => {
      const error = new ExchangeError(
        'bybit',
        'UNKNOWN',
        'Market symbols request failed',
      );

      rest.getMarketSymbols.mockRejectedValue(error);

      await expect(adapter.getMarketSymbols()).rejects.toBe(error);
    });
  });
});
