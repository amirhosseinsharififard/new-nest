
import { BinanceWsManager } from './binance.ws';
import { BinanceRestClient } from './binance.rest';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

jest.mock('../common/reconnecting-ws-client');

describe('BinanceWsManager', () => {
  let manager: BinanceWsManager;
  let restClient: jest.Mocked<BinanceRestClient>;

  let wsInstances: Array<{
    connect: jest.Mock;
    disconnect: jest.Mock;
    isHealthy: jest.Mock;
    options: any;
  }>;

  const createWsMock = () => {
    const instance = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
      options: undefined as any,
    };

    wsInstances.push(instance);
    return instance;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    wsInstances = [];

    (ReconnectingWsClient as unknown as jest.Mock).mockImplementation(
      (options) => {
        const instance = createWsMock();
        instance.options = options;
        return instance;
      },
    );

    restClient = {
      createListenKey: jest.fn().mockResolvedValue({
        listenKey: 'test-listen-key',
      }),
      keepAliveListenKey: jest.fn().mockResolvedValue({}),
    } as any;

    manager = new BinanceWsManager(restClient);
  });

  afterEach(() => {
    manager.disconnect();
  });

  describe('connectTickers', () => {
    it('should create a WebSocket connection for subscribed symbols', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      expect(ReconnectingWsClient).toHaveBeenCalledTimes(1);

      expect(wsInstances[0].options.url).toBe(
        'wss://fstream.binance.com/stream?streams=btcusdt@bookTicker',
      );

      expect(wsInstances[0].connect).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to multiple symbols using a combined stream', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      expect(wsInstances[0].options.url).toBe(
        'wss://fstream.binance.com/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker',
      );
    });

    it('should not reconnect when all symbols are already subscribed', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      expect(ReconnectingWsClient).toHaveBeenCalledTimes(1);
    });

    it('should reconnect when a new symbol is added', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());
      await manager.connectTickers(['ETH-USDT'], jest.fn());

      expect(ReconnectingWsClient).toHaveBeenCalledTimes(2);
      expect(wsInstances[0].disconnect).toHaveBeenCalledTimes(1);
      expect(wsInstances[1].options.url).toContain(
        'btcusdt@bookTicker/ethusdt@bookTicker',
      );
    });

    it('should use a custom WebSocket base URL', async () => {
      manager = new BinanceWsManager(restClient, 'wss://custom.example.com');

      await manager.connectTickers(['BTC-USDT'], jest.fn());

      expect(wsInstances[0].options.url).toContain(
        'wss://custom.example.com/stream?',
      );
    });
  });

  describe('disconnectTickers', () => {
    it('should remove selected symbols and reconnect', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      await manager.disconnectTickers(['BTC-USDT']);

      expect(wsInstances[0].disconnect).toHaveBeenCalledTimes(1);
      expect(wsInstances[1].options.url).toContain(
        'ethusdt@bookTicker',
      );
      expect(wsInstances[1].options.url).not.toContain(
        'btcusdt@bookTicker',
      );
    });

    it('should not reconnect when no subscribed symbol is removed', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      await manager.disconnectTickers(['ETH-USDT']);

      expect(ReconnectingWsClient).toHaveBeenCalledTimes(1);
    });

    it('should disconnect the stream when the last symbol is removed', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      await manager.disconnectTickers(['BTC-USDT']);

      expect(wsInstances[0].disconnect).toHaveBeenCalledTimes(1);
      expect(ReconnectingWsClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnectTicker', () => {
    it('should remove one symbol and reconnect', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      await manager.disconnectTicker('BTC-USDT');

      expect(wsInstances[0].disconnect).toHaveBeenCalledTimes(1);
      expect(wsInstances[1].options.url).toContain(
        'ethusdt@bookTicker',
      );
    });

    it('should do nothing for an unknown symbol', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      await manager.disconnectTicker('ETH-USDT');

      expect(ReconnectingWsClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('ticker messages', () => {
    it('should map a valid ticker message to TickerData', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            stream: 'btcusdt@bookTicker',
            data: {
              s: 'BTCUSDT',
              b: '60000.5',
              B: '1.25',
              a: '60001.5',
              A: '2.5',
              T: 1700000000000,
            },
          }),
        ),
      );

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'binance',
        symbol: 'BTCUSDT',
        bidPrice: 60000.5,
        bidSize: 1.25,
        askPrice: 60001.5,
        askSize: 2.5,
        timestamp: 1700000000000,
      });
    });

    it('should use event time when transaction time is missing', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            data: {
              s: 'BTCUSDT',
              b: '10',
              B: '1',
              a: '11',
              A: '2',
              E: 123456,
            },
          }),
        ),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: 123456,
        }),
      );
    });

    it('should ignore messages without ticker payload', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      wsInstances[0].options.onMessage(
        Buffer.from(JSON.stringify({ stream: 'btcusdt@bookTicker' })),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages for unsubscribed symbols', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            data: {
              s: 'ETHUSDT',
              b: '10',
              B: '1',
              a: '11',
              A: '2',
            },
          }),
        ),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore malformed JSON without throwing', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      expect(() => {
        wsInstances[0].options.onMessage(Buffer.from('invalid-json'));
      }).not.toThrow();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore ticker messages without a symbol', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            data: {
              b: '10',
              B: '1',
              a: '11',
              A: '2',
            },
          }),
        ),
      );

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('connectUserDataStream', () => {
    it('should create a listen key and connect to the user stream', async () => {
      await manager.connectUserDataStream(jest.fn());

      expect(restClient.createListenKey).toHaveBeenCalledTimes(1);

      expect(wsInstances[0].options.url).toBe(
        'wss://fstream.binance.com/ws/test-listen-key',
      );

      expect(wsInstances[0].connect).toHaveBeenCalledTimes(1);
    });

    it('should throw when REST client is unavailable', async () => {
      manager = new BinanceWsManager(null);

      await expect(
        manager.connectUserDataStream(jest.fn()),
      ).rejects.toThrow(
        'Binance User Data Stream requires authenticated REST client',
      );

      expect(ReconnectingWsClient).not.toHaveBeenCalled();
    });

    it('should propagate listen key creation errors', async () => {
      restClient.createListenKey.mockRejectedValue(
        new Error('Authentication failed'),
      );

      await expect(
        manager.connectUserDataStream(jest.fn()),
      ).rejects.toThrow('Authentication failed');

      expect(ReconnectingWsClient).not.toHaveBeenCalled();
    });
  });

  describe('user data messages', () => {
    it('should map LONG position updates', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            e: 'ACCOUNT_UPDATE',
            E: 1700000000000,
            a: {
              P: [
                {
                  s: 'BTCUSDT',
                  pa: '0.5',
                  ep: '60000',
                },
              ],
            },
          }),
        ),
      );

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'binance',
        accountId: '',
        symbol: 'BTCUSDT',
        side: PositionSide.LONG,
        status: OrderStatus.FILLED,
        quantity: 0.5,
        entryPrice: 60000,
        timestamp: 1700000000000,
      });
    });

    it('should map SHORT position updates', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            e: 'ACCOUNT_UPDATE',
            a: {
              P: [
                {
                  s: 'BTCUSDT',
                  pa: '-0.5',
                  ep: '60000',
                },
              ],
            },
          }),
        ),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          side: PositionSide.SHORT,
          quantity: 0.5,
          status: OrderStatus.FILLED,
        }),
      );
    });

    it('should map zero position amount to CANCELLED', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            e: 'ACCOUNT_UPDATE',
            a: {
              P: [
                {
                  s: 'BTCUSDT',
                  pa: '0',
                  ep: '0',
                },
              ],
            },
          }),
        ),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          side: PositionSide.LONG,
          status: OrderStatus.CANCELLED,
          quantity: 0,
          entryPrice: null,
        }),
      );
    });

    it('should process multiple position updates in one message', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            e: 'ACCOUNT_UPDATE',
            a: {
              P: [
                { s: 'BTCUSDT', pa: '0.5', ep: '60000' },
                { s: 'ETHUSDT', pa: '-2', ep: '3000' },
              ],
            },
          }),
        ),
      );

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should ignore non ACCOUNT_UPDATE events', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      wsInstances[0].options.onMessage(
        Buffer.from(
          JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            o: {},
          }),
        ),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore malformed user data messages without throwing', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      expect(() => {
        wsInstances[0].options.onMessage(Buffer.from('invalid-json'));
      }).not.toThrow();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore ACCOUNT_UPDATE events without positions', async () => {
      const callback = jest.fn();

      await manager.connectUserDataStream(callback);

      wsInstances[0].options.onMessage(
        Buffer.from(JSON.stringify({ e: 'ACCOUNT_UPDATE', a: {} })),
      );

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('health and disconnect', () => {
    it('should consider the manager healthy before connecting', () => {
      expect(manager.isHealthy()).toBe(true);
    });

    it('should return false when ticker connection is unhealthy', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      wsInstances[0].isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should return false when user data connection is unhealthy', async () => {
      await manager.connectUserDataStream(jest.fn());

      wsInstances[0].isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should disconnect active WebSocket connections', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());
      await manager.connectUserDataStream(jest.fn());

      manager.disconnect();

      expect(wsInstances[0].disconnect).toHaveBeenCalledTimes(1);
      expect(wsInstances[1].disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
