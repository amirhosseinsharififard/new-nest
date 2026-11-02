
import { BinanceAdapter } from './binance.adapter';
import { BinanceRestClient } from './binance.rest';
import { BinanceWsManager } from './binance.ws';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import {
  OrderStatus,
  PositionSide,
} from '../../core/exchange/exchange.types';
import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';

jest.mock('./binance.rest');
jest.mock('./binance.ws');

describe('BinanceAdapter', () => {
  let adapter: BinanceAdapter;
  let restMock: jest.Mocked<BinanceRestClient>;
  let marketRestMock: jest.Mocked<BinanceRestClient>;
  let wsMock: jest.Mocked<BinanceWsManager>;

  const config: ExchangeAccountConfig = {
    accountId: 'account-1',
    exchangeId: 'binance',
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    restBaseUrl: 'https://testnet.binancefuture.com',
    wsBaseUrl: 'wss://testnet.binancefuture.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    adapter = new BinanceAdapter(config);

    const clients = (BinanceRestClient as jest.MockedClass<
      typeof BinanceRestClient
    >).mock.instances;

    restMock = clients[0] as jest.Mocked<BinanceRestClient>;
    marketRestMock = clients[1] as jest.Mocked<BinanceRestClient>;

    wsMock = (BinanceWsManager as jest.MockedClass<
      typeof BinanceWsManager
    >).mock.instances[0] as jest.Mocked<BinanceWsManager>;
  });

  describe('constructor', () => {
    it('should expose the correct exchange ID', () => {
      expect(adapter.exchangeId).toBe('binance');
    });

    it('should initialize authenticated and public REST clients', () => {
      expect(BinanceRestClient).toHaveBeenCalledTimes(2);
    });

    it('should initialize without credentials for market data access', () => {
      const noCredentialsAdapter = new BinanceAdapter({
        ...config,
        apiKey: undefined,
        apiSecret: undefined,
      });

      expect(noCredentialsAdapter.exchangeId).toBe('binance');
    });

    it('should not enable trading when credentials are incomplete', async () => {
      const noCredentialsAdapter = new BinanceAdapter({
        ...config,
        apiSecret: undefined,
      });

      await expect(
        noCredentialsAdapter.openPosition({
          accountId: 'account-1',
          symbol: 'BTC-USDT',
          side: PositionSide.LONG,
          quantity: 1,
          idempotencyKey: 'order-1',
        }),
      ).rejects.toThrow('Binance trading requires API credentials');
    });
  });

  describe('WebSocket lifecycle', () => {
    it('should connect without throwing', async () => {
      await expect(adapter.connectWebSocket()).resolves.toBeUndefined();
    });

    it('should disconnect the WebSocket manager', async () => {
      await adapter.disconnectWebSocket();

      expect(wsMock.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should return WebSocket health status', () => {
      wsMock.isHealthy.mockReturnValue(true);

      expect(adapter.isWebSocketHealthy()).toBe(true);

      wsMock.isHealthy.mockReturnValue(false);

      expect(adapter.isWebSocketHealthy()).toBe(false);
    });
  });

  describe('ticker subscriptions', () => {
    it('should subscribe to a single ticker', () => {
      wsMock.connectTickers.mockResolvedValue(undefined);

      adapter.subscribeTicker('BTC-USDT', jest.fn());

      expect(wsMock.connectTickers).toHaveBeenCalledWith(
        ['BTC-USDT'],
        expect.any(Function),
      );
    });

    it('should subscribe to multiple tickers', () => {
      wsMock.connectTickers.mockResolvedValue(undefined);

      const callback = jest.fn();

      adapter.subscribeTickers(['BTC-USDT', 'ETH-USDT'], callback);

      expect(wsMock.connectTickers).toHaveBeenCalledWith(
        ['BTC-USDT', 'ETH-USDT'],
        callback,
      );
    });

    it('should unsubscribe from a single ticker', () => {
      wsMock.disconnectTickers.mockResolvedValue(undefined);

      adapter.unsubscribeTicker('BTC-USDT');

      expect(wsMock.disconnectTickers).toHaveBeenCalledWith(['BTC-USDT']);
    });

    it('should unsubscribe from multiple tickers', () => {
      wsMock.disconnectTickers.mockResolvedValue(undefined);

      adapter.unsubscribeTickers(['BTC-USDT', 'ETH-USDT']);

      expect(wsMock.disconnectTickers).toHaveBeenCalledWith([
        'BTC-USDT',
        'ETH-USDT',
      ]);
    });
  });

  describe('position subscriptions', () => {
    it('should attach the account ID to position updates', async () => {
      wsMock.connectUserDataStream.mockImplementation(async (callback) => {
        callback({
          exchangeId: 'binance',
          accountId: '',
          symbol: 'BTCUSDT',
          side: PositionSide.LONG,
          status: OrderStatus.FILLED,
          quantity: 1,
          entryPrice: 50000,
          timestamp: 1000,
        });
      });

      const callback = jest.fn();

      adapter.subscribePositionUpdates('account-1', callback);

      await Promise.resolve();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'account-1',
          symbol: 'BTCUSDT',
        }),
      );
    });
  });

  describe('openPosition', () => {
    it('should open a LONG position using BUY', async () => {
      restMock.placeOrder.mockResolvedValue({
        orderId: 123,
        status: 'FILLED',
        executedQty: '0.5',
        avgPrice: '50000',
      });

      const result = await adapter.openPosition({
        accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 0.5,
        idempotencyKey: 'order-1',
      });

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.5,
          reduceOnly: false,
          newClientOrderId: 'order-1',
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          exchangeOrderId: '123',
          status: OrderStatus.FILLED,
          filledQuantity: 0.5,
          avgFillPrice: 50000,
        }),
      );
    });

    it('should open a SHORT position using SELL', async () => {
      restMock.placeOrder.mockResolvedValue({
        orderId: 124,
        status: 'NEW',
        executedQty: '0',
        avgPrice: '0',
      });

      await adapter.openPosition({
        accountId: 'account-1',
        symbol: 'ETH-USDT',
        side: PositionSide.SHORT,
        quantity: 2,
        idempotencyKey: 'order-2',
      });

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'SELL',
          reduceOnly: false,
        }),
      );
    });

    it('should return UNKNOWN when the request times out', async () => {
      restMock.placeOrder.mockRejectedValue(
        new ExchangeError(
          'binance',
          'NETWORK_TIMEOUT',
          'Request timed out',
        ),
      );

      const result = await adapter.openPosition({
        accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 1,
        idempotencyKey: 'order-timeout',
      });

      expect(result).toEqual(
        expect.objectContaining({
          exchangeOrderId: null,
          status: OrderStatus.UNKNOWN,
          filledQuantity: 0,
          avgFillPrice: null,
        }),
      );
    });

    it('should rethrow non-timeout exchange errors', async () => {
      const error = new ExchangeError(
        'binance',
        'INSUFFICIENT_BALANCE',
        'Insufficient balance',
      );

      restMock.placeOrder.mockRejectedValue(error);

      await expect(
        adapter.openPosition({
          accountId: 'account-1',
          symbol: 'BTC-USDT',
          side: PositionSide.LONG,
          quantity: 1,
          idempotencyKey: 'order-error',
        }),
      ).rejects.toBe(error);
    });
  });

  describe('closePosition', () => {
    it('should close a LONG position using SELL', async () => {
      restMock.placeOrder.mockResolvedValue({
        orderId: 200,
        status: 'FILLED',
        executedQty: '1',
        avgPrice: '51000',
      });

      await adapter.closePosition({
        accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        quantity: 1,
        idempotencyKey: 'close-1',
      });

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'SELL',
          reduceOnly: true,
        }),
      );
    });

    it('should close a SHORT position using BUY', async () => {
      restMock.placeOrder.mockResolvedValue({
        orderId: 201,
        status: 'FILLED',
        executedQty: '1',
        avgPrice: '49000',
      });

      await adapter.closePosition({
        accountId: 'account-1',
        symbol: 'BTC-USDT',
        side: PositionSide.SHORT,
        quantity: 1,
        idempotencyKey: 'close-2',
      });

      expect(restMock.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'BUY',
          reduceOnly: true,
        }),
      );
    });
  });

  describe('getPositionStatus', () => {
    it('should return a closed position when no matching position exists', async () => {
      restMock.getPositionRisk.mockResolvedValue([]);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result).toEqual({
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        isOpen: false,
        quantity: 0,
        entryPrice: null,
        unrealizedPnl: null,
      });
    });

    it('should return a LONG position', async () => {
      restMock.getPositionRisk.mockResolvedValue([
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.5',
          entryPrice: '50000',
          unRealizedProfit: '100',
        },
      ]);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result).toEqual({
        symbol: 'BTC-USDT',
        side: PositionSide.LONG,
        isOpen: true,
        quantity: 0.5,
        entryPrice: 50000,
        unrealizedPnl: 100,
      });
    });

    it('should return a SHORT position', async () => {
      restMock.getPositionRisk.mockResolvedValue([
        {
          symbol: 'BTCUSDT',
          positionAmt: '-0.25',
          entryPrice: '50000',
          unRealizedProfit: '-50',
        },
      ]);

      const result = await adapter.getPositionStatus(
        'account-1',
        'BTC-USDT',
      );

      expect(result.side).toBe(PositionSide.SHORT);
      expect(result.quantity).toBe(0.25);
    });
  });

  describe('getBalance', () => {
    it('should exclude assets with zero or negative balances', async () => {
      restMock.getBalance.mockResolvedValue([
        { asset: 'USDT', balance: '100', availableBalance: '80' },
        { asset: 'BTC', balance: '0', availableBalance: '0' },
        { asset: 'ETH', balance: '-1', availableBalance: '-1' },
      ]);

      expect(await adapter.getBalance('account-1')).toEqual([
        { asset: 'USDT', free: 80, locked: 20 },
      ]);
    });

    it('should return an empty array when no positive balances exist', async () => {
      restMock.getBalance.mockResolvedValue([]);

      expect(await adapter.getBalance('account-1')).toEqual([]);
    });
  });

  describe('getMarketSymbols', () => {
    it('should delegate to the public REST client', async () => {
      marketRestMock.getMarketSymbols.mockResolvedValue([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      await expect(adapter.getMarketSymbols()).resolves.toEqual([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      expect(marketRestMock.getMarketSymbols).toHaveBeenCalledTimes(1);
    });
  });
});
