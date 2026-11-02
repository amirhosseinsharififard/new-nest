
import * as crypto from 'crypto';

import { BybitWsManager, fromBybitSymbol } from './bybit.ws';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import {
  OrderStatus,
  PositionSide,
} from '../../core/exchange/exchange.types';

jest.mock('../common/reconnecting-ws-client', () => ({
  ReconnectingWsClient: jest.fn().mockImplementation((options) => ({
    options,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    send: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
  })),
}));

describe('BybitWsManager', () => {
  let manager: BybitWsManager;
  let clients: Array<{
    options: {
      url: string;
      exchangeId: string;
      pingIntervalMs: number;
      onOpen: () => void;
      onMessage: (raw: unknown) => void;
    };
    connect: jest.Mock;
    disconnect: jest.Mock;
    send: jest.Mock;
    isHealthy: jest.Mock;
  }>;

  const apiKey = 'test-api-key';
  const apiSecret = 'test-api-secret';
  const wsBaseUrl = 'wss://testnet.bybit.com';

  const createRawMessage = (data: unknown) => ({
    toString: () => JSON.stringify(data),
  });

  const createTickerMessage = (
    symbol: string,
    data: Record<string, unknown>,
    timestamp = 1700000000000,
  ) =>
    createRawMessage({
      topic: `tickers.${symbol}`,
      type: 'snapshot',
      ts: timestamp,
      data,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    clients = [];

    (ReconnectingWsClient as unknown as jest.Mock).mockImplementation(
      (options) => {
        const client = {
          options,
          connect: jest.fn().mockResolvedValue(undefined),
          disconnect: jest.fn(),
          send: jest.fn(),
          isHealthy: jest.fn().mockReturnValue(true),
        };

        clients.push(client);
        return client;
      },
    );

    manager = new BybitWsManager(apiKey, apiSecret, wsBaseUrl);
  });

  afterEach(() => {
    manager.disconnect();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('fromBybitSymbol', () => {
    it('should convert USDT symbols to internal format', () => {
      expect(fromBybitSymbol('BTCUSDT')).toBe('BTC-USDT');
      expect(fromBybitSymbol('ETHUSDT')).toBe('ETH-USDT');
    });

    it('should return symbols without USDT suffix unchanged', () => {
      expect(fromBybitSymbol('BTCUSD')).toBe('BTCUSD');
      expect(fromBybitSymbol('BTC')).toBe('BTC');
    });

   it('should replace the first USDT occurrence when it is at the end', () => {
  expect(fromBybitSymbol('USDTUSDT')).toBe('-USDTUSDT');
});

    it('should return an empty symbol unchanged', () => {
      expect(fromBybitSymbol('')).toBe('');
    });
  });

  describe('connectTicker', () => {
    it('should connect to the public linear WebSocket', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      expect(ReconnectingWsClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `${wsBaseUrl}/v5/public/linear`,
          exchangeId: 'bybit-public',
          pingIntervalMs: 20_000,
        }),
      );

      expect(clients[0].connect).toHaveBeenCalledTimes(1);
    });

    it('should normalize the symbol before subscribing', async () => {
      await manager.connectTicker('btc-usdt', jest.fn());

      clients[0].options.onOpen();

      expect(clients[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          op: 'subscribe',
          args: ['tickers.BTCUSDT'],
        }),
      );
    });

    it('should connect using the default WebSocket URL', async () => {
      const defaultManager = new BybitWsManager(apiKey, apiSecret);

      await defaultManager.connectTicker('BTC-USDT', jest.fn());

      const lastClient = clients[0];

      expect(lastClient.options.url).toBe(
        'wss://stream.bybit.com/v5/public/linear',
      );

      defaultManager.disconnect();
    });
  });

  describe('connectTickers', () => {
    it('should subscribe to multiple symbols when the connection opens', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      clients[0].options.onOpen();

      expect(clients[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          op: 'subscribe',
          args: ['tickers.BTCUSDT', 'tickers.ETHUSDT'],
        }),
      );
    });

    it('should send subscriptions in chunks of 10 symbols', async () => {
      const symbols = Array.from(
        { length: 21 },
        (_, index) => `COIN${index}-USDT`,
      );

      await manager.connectTickers(symbols, jest.fn());

      clients[0].options.onOpen();

      const messages = clients[0].send.mock.calls.map(([message]) =>
        JSON.parse(message),
      );

      expect(messages).toHaveLength(3);
      expect(messages[0].args).toHaveLength(10);
      expect(messages[1].args).toHaveLength(10);
      expect(messages[2].args).toHaveLength(1);
    });

    it('should subscribe new symbols without reconnecting', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);

      await manager.connectTickers(['ETH-USDT'], callback);

      expect(clients).toHaveLength(1);
      expect(clients[0].connect).toHaveBeenCalledTimes(1);

      expect(clients[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          op: 'subscribe',
          args: ['tickers.ETHUSDT'],
        }),
      );
    });

    it('should not subscribe duplicate symbols', async () => {
      const callback = jest.fn();

      await manager.connectTickers(['BTC-USDT'], callback);
      await manager.connectTickers(['BTCUSDT'], callback);

      expect(clients).toHaveLength(1);
      expect(clients[0].send).not.toHaveBeenCalled();
    });

    it('should split new subscriptions into chunks of 10', async () => {
      await manager.connectTickers(['BTC-USDT'], jest.fn());

      const symbols = Array.from(
        { length: 21 },
        (_, index) => `NEW${index}-USDT`,
      );

      await manager.connectTickers(symbols, jest.fn());

      const messages = clients[0].send.mock.calls.map(([message]) =>
        JSON.parse(message),
      );

      expect(messages).toHaveLength(3);
      expect(messages[0].args).toHaveLength(10);
      expect(messages[1].args).toHaveLength(10);
      expect(messages[2].args).toHaveLength(1);
    });
  });

  describe('disconnectTicker', () => {
    it('should unsubscribe a symbol when other subscriptions remain', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      manager.disconnectTicker('BTC-USDT');

      expect(clients[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          op: 'unsubscribe',
          args: ['tickers.BTCUSDT'],
        }),
      );

      expect(clients[0].disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect the public socket when the last symbol is removed', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      manager.disconnectTicker('BTC-USDT');

      expect(clients[0].disconnect).toHaveBeenCalledTimes(1);
    });

    it('should ignore symbols that are not subscribed', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      manager.disconnectTicker('ETH-USDT');

      expect(clients[0].send).not.toHaveBeenCalled();
      expect(clients[0].disconnect).not.toHaveBeenCalled();
    });

    it('should normalize symbols before unsubscribing', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      manager.disconnectTicker('btc/usdt');

      expect(clients[0].disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('ticker message handling', () => {
    it('should emit ticker data when valid prices are received', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '65000',
          bid1Size: '1.5',
          ask1Price: '65010',
          ask1Size: '2.5',
        }),
      );

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'bybit',
        symbol: 'BTCUSDT',
        bidPrice: 65000,
        bidSize: 1.5,
        askPrice: 65010,
        askSize: 2.5,
        timestamp: 1700000000000,
      });
    });

    it('should ignore messages when bid or ask price is missing', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '65000',
          bid1Size: '1',
        }),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages with an empty data object', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {}),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages for symbols without callbacks', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('ETHUSDT', {
          bid1Price: '2000',
          ask1Price: '2001',
        }),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages without a ticker topic', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'orderbook.50.BTCUSDT',
          data: {},
        }),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore pong messages', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage({
        toString: () => '{"op":"pong"}',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should log successful subscription acknowledgements', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      const loggerSpy = jest
        .spyOn((manager as any).logger, 'log')
        .mockImplementation();

      clients[0].options.onMessage(
        createRawMessage({
          op: 'subscribe',
          success: true,
          ret_msg: 'OK',
        }),
      );

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('should log failed subscription acknowledgements', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      const loggerSpy = jest
        .spyOn((manager as any).logger, 'error')
        .mockImplementation();

      clients[0].options.onMessage(
        createRawMessage({
          op: 'subscribe',
          success: false,
          ret_msg: 'Invalid topic',
        }),
      );

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('should log when no callback exists for a ticker', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      const loggerSpy = jest
        .spyOn((manager as any).logger, 'warn')
        .mockImplementation();

      clients[0].options.onMessage(
        createTickerMessage('ETHUSDT', {
          bid1Price: '2000',
          ask1Price: '2001',
        }),
      );

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('should log malformed ticker messages without throwing', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      const loggerSpy = jest
        .spyOn((manager as any).logger, 'error')
        .mockImplementation();

      clients[0].options.onMessage({
        toString: () => '{invalid-json',
      });

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('should use the current time when timestamp is missing', async () => {
      const callback = jest.fn();
      const now = 1700000000000;

      jest.spyOn(Date, 'now').mockReturnValue(now);

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'tickers.BTCUSDT',
          data: {
            bid1Price: '100',
            ask1Price: '101',
          },
        }),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: now,
        }),
      );
    });

    it('should preserve cached values when receiving delta updates', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '65000',
          bid1Size: '1.5',
          ask1Price: '65010',
          ask1Size: '2.5',
        }),
      );

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '65005',
          bid1Size: '2',
        }),
      );

      expect(callback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          bidPrice: 65005,
          bidSize: 2,
          askPrice: 65010,
          askSize: 2.5,
        }),
      );
    });

    it('should not emit when delta updates do not complete initial prices', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '65000',
        }),
      );

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          ask1Size: '2',
        }),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore zero price updates and preserve the previous price', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT', callback);

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '100',
          bid1Size: '1',
          ask1Price: '101',
          ask1Size: '1',
        }),
      );

      clients[0].options.onMessage(
        createTickerMessage('BTCUSDT', {
          bid1Price: '0',
        }),
      );

      expect(callback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          bidPrice: 100,
          askPrice: 101,
        }),
      );
    });
  });

  describe('connectPrivate', () => {
    it('should create and connect to the private WebSocket', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(ReconnectingWsClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `${wsBaseUrl}/v5/private`,
          exchangeId: 'bybit-private',
          pingIntervalMs: 20_000,
        }),
      );

      expect(clients[0].connect).toHaveBeenCalledTimes(1);
    });

    it('should authenticate when the private socket opens', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      const timestamp = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(timestamp);

      clients[0].options.onOpen();

      const expires = timestamp + 10_000;

      const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(`GET/realtime${expires}`)
        .digest('hex');

      expect(clients[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          op: 'auth',
          args: [apiKey, expires, signature],
        }),
      );
    });

    it('should subscribe to position after authentication delay', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      clients[0].options.onOpen();

      expect(clients[0].send).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(500);

      expect(clients[0].send).toHaveBeenLastCalledWith(
        JSON.stringify({
          op: 'subscribe',
          args: ['position'],
        }),
      );
    });
  });

  describe('private position message handling', () => {
    it('should emit a LONG position update for Buy side', async () => {
      const callback = jest.fn();

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          creationTime: 1700000000000,
          data: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '0.5',
              avgPrice: '65000',
            },
          ],
        }),
      );

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'bybit',
        accountId: 'account-1',
        symbol: 'BTCUSDT',
        side: PositionSide.LONG,
        status: OrderStatus.FILLED,
        quantity: 0.5,
        entryPrice: 65000,
        timestamp: 1700000000000,
      });
    });

    it('should emit a SHORT position update for Sell side', async () => {
      const callback = jest.fn();

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          data: [
            {
              symbol: 'ETHUSDT',
              side: 'Sell',
              size: '2',
              avgPrice: '3000',
            },
          ],
        }),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          side: PositionSide.SHORT,
          quantity: 2,
          entryPrice: 3000,
        }),
      );
    });

    it('should emit CANCELLED status when position size is zero', async () => {
      const callback = jest.fn();

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          data: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '0',
              avgPrice: '65000',
            },
          ],
        }),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.CANCELLED,
          quantity: 0,
        }),
      );
    });

    it('should emit one update for each position in the message', async () => {
      const callback = jest.fn();

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          data: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '1',
              avgPrice: '65000',
            },
            {
              symbol: 'ETHUSDT',
              side: 'Sell',
              size: '2',
              avgPrice: '3000',
            },
          ],
        }),
      );

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should ignore messages from topics other than position', async () => {
      const callback = jest.fn();

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'wallet',
          data: [],
        }),
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages when no position callback is registered', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      (manager as any).positionCallback = null;

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          data: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '1',
              avgPrice: '65000',
            },
          ],
        }),
      );

      expect((manager as any).positionCallback).toBeNull();
    });

    it('should use current time when creationTime is missing', async () => {
      const callback = jest.fn();
      const now = 1700000000000;

      jest.spyOn(Date, 'now').mockReturnValue(now);

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          data: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '1',
              avgPrice: '65000',
            },
          ],
        }),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: now,
        }),
      );
    });

    it('should return null entryPrice when avgPrice is zero', async () => {
      const callback = jest.fn();

      await manager.connectPrivate('account-1', callback);

      clients[0].options.onMessage(
        createRawMessage({
          topic: 'position',
          data: [
            {
              symbol: 'BTCUSDT',
              side: 'Buy',
              size: '1',
              avgPrice: '0',
            },
          ],
        }),
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          entryPrice: null,
        }),
      );
    });

    it('should log malformed private messages without throwing', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      const loggerSpy = jest
        .spyOn((manager as any).logger, 'error')
        .mockImplementation();

      clients[0].options.onMessage({
        toString: () => '{invalid-json',
      });

      expect(loggerSpy).toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('should return true when no sockets have been created', () => {
      expect(manager.isHealthy()).toBe(true);
    });

    it('should return true when all connected sockets are healthy', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      expect(manager.isHealthy()).toBe(true);
    });

    it('should return false when public socket is unhealthy', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());

      clients[0].isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should return false when private socket is unhealthy', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      clients[0].isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should return false when either socket is unhealthy', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      clients[0].isHealthy.mockReturnValue(true);
      clients[1].isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect both public and private sockets', async () => {
      await manager.connectTicker('BTC-USDT', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      manager.disconnect();

      expect(clients[0].disconnect).toHaveBeenCalledTimes(1);
      expect(clients[1].disconnect).toHaveBeenCalledTimes(1);
    });

    it('should safely disconnect when no sockets exist', () => {
      expect(() => manager.disconnect()).not.toThrow();
    });
  });
});
