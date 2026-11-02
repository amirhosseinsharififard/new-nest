import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { OkxWsManager } from './okx.ws';
import * as crypto from 'crypto';

type WsOptions = {
  url: string;
  exchangeId: string;
  pingIntervalMs: number;
  onOpen: () => void;
  onMessage: (raw: { toString(): string }) => void;
};

type WsMock = {
  connect: jest.Mock;
  send: jest.Mock;
  disconnect: jest.Mock;
  isHealthy: jest.Mock;
};

const mockClients: Array<{
  options: WsOptions;
  client: WsMock;
}> = [];

jest.mock('../common/reconnecting-ws-client', () => ({
  ReconnectingWsClient: jest.fn().mockImplementation((options: WsOptions) => {
    const client: WsMock = {
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn(),
      disconnect: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    };

    mockClients.push({ options, client });

    return client;
  }),
}));

describe('OkxWsManager', () => {
  let manager: OkxWsManager;

  const apiKey = 'test-api-key';
  const apiSecret = 'test-api-secret';
  const passphrase = 'test-passphrase';

  const publicUrl = 'wss://ws.okx.com:8443/ws/v5/public';
  const privateUrl = 'wss://ws.okx.com:8443/ws/v5/private';

  const getClient = (index = 0): WsMock => {
    const entry = mockClients[index];

    if (!entry) {
      throw new Error(`WebSocket client ${index} was not created`);
    }

    return entry.client;
  };

  const getOptions = (index = 0): WsOptions => {
    const entry = mockClients[index];

    if (!entry) {
      throw new Error(`WebSocket options ${index} were not found`);
    }

    return entry.options;
  };

  const parseSentMessage = (
    client: WsMock,
    index: number,
  ): Record<string, unknown> => {
    const message = client.send.mock.calls[index][0] as string;

    return JSON.parse(message) as Record<string, unknown>;
  };

  const sendMessage = (
    options: WsOptions,
    message: unknown,
  ): void => {
    options.onMessage({
      toString: () => JSON.stringify(message),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClients.length = 0;

    manager = new OkxWsManager(
      apiKey,
      apiSecret,
      passphrase,
    );
  });

  describe('constructor', () => {
    it('should use default public and private WebSocket URLs', () => {
      expect(manager.isHealthy()).toBe(true);
      expect(mockClients).toHaveLength(0);
    });

    it('should support custom WebSocket URLs', async () => {
      manager = new OkxWsManager(
        apiKey,
        apiSecret,
        passphrase,
        'wss://custom.example.com/public',
        'wss://custom.example.com/private',
      );

      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      expect(getOptions(0).url).toBe(
        'wss://custom.example.com/public',
      );

      expect(getOptions(1).url).toBe(
        'wss://custom.example.com/private',
      );
    });
  });

  describe('public ticker connection', () => {
    it('should create public WebSocket client', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      expect(ReconnectingWsClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: publicUrl,
          exchangeId: 'okx-public',
          pingIntervalMs: 20_000,
        }),
      );

      expect(getClient(0).connect).toHaveBeenCalledTimes(1);
    });

    it('should use the correct public connection callbacks', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      expect(getOptions(0).onOpen).toEqual(expect.any(Function));
      expect(getOptions(0).onMessage).toEqual(expect.any(Function));
    });

    it('should subscribe to ticker after the public connection is opened', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      getOptions(0).onOpen();

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'subscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'BTC-USDT-SWAP',
          },
        ],
      });
    });

    it('should subscribe directly when public connection already exists', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());
      await manager.connectTicker('ETH-USDT-SWAP', jest.fn());

      expect(getClient(0).send).toHaveBeenCalledWith(
        JSON.stringify({
          op: 'subscribe',
          args: [
            {
              channel: 'tickers',
              instId: 'ETH-USDT-SWAP',
            },
          ],
        }),
      );
    });

    it('should replace callback when subscribing to an existing ticker', async () => {
      const firstCallback = jest.fn();
      const secondCallback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', firstCallback);
      await manager.connectTicker('BTC-USDT-SWAP', secondCallback);

      sendMessage(getOptions(0), {
        arg: { channel: 'tickers' },
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            bidPx: '65000',
            bidSz: '1',
            askPx: '65010',
            askSz: '2',
            ts: '123',
          },
        ],
      });

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('public batch subscriptions', () => {
    it('should create a public connection for multiple instruments', async () => {
      await manager.connectTickers(
        ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
        jest.fn(),
      );

      expect(mockClients).toHaveLength(1);
      expect(getClient(0).connect).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to all instruments when connection opens', async () => {
      await manager.connectTickers(
        ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
        jest.fn(),
      );

      getOptions(0).onOpen();

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'subscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'BTC-USDT-SWAP',
          },
          {
            channel: 'tickers',
            instId: 'ETH-USDT-SWAP',
          },
        ],
      });
    });

    it('should normalize instrument IDs before subscribing', async () => {
      await manager.connectTickers(
        [' btc-usdt-swap ', 'eth-usdt-swap'],
        jest.fn(),
      );

      getOptions(0).onOpen();

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'subscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'BTC-USDT-SWAP',
          },
          {
            channel: 'tickers',
            instId: 'ETH-USDT-SWAP',
          },
        ],
      });
    });

    it('should ignore empty instrument IDs', async () => {
      await manager.connectTickers(
        ['', '   ', 'BTC-USDT-SWAP'],
        jest.fn(),
      );

      getOptions(0).onOpen();

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'subscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'BTC-USDT-SWAP',
          },
        ],
      });
    });

    it('should ignore duplicate instruments', async () => {
      await manager.connectTickers(
        [
          'BTC-USDT-SWAP',
          ' btc-usdt-swap ',
          'BTC-USDT-SWAP',
        ],
        jest.fn(),
      );

      getOptions(0).onOpen();

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'subscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'BTC-USDT-SWAP',
          },
        ],
      });
    });

    it('should not create a connection when all instrument IDs are empty', async () => {
      await manager.connectTickers(
        ['', '   '],
        jest.fn(),
      );

      expect(ReconnectingWsClient).not.toHaveBeenCalled();
    });

    it('should split subscriptions into chunks of ten', async () => {
      const symbols = Array.from(
        { length: 21 },
        (_, index) => `COIN${index}-USDT-SWAP`,
      );

      await manager.connectTickers(symbols, jest.fn());

      getOptions(0).onOpen();

      expect(getClient(0).send).toHaveBeenCalledTimes(3);

      const first = parseSentMessage(getClient(0), 0);
      const second = parseSentMessage(getClient(0), 1);
      const third = parseSentMessage(getClient(0), 2);

      expect(first['args']).toHaveLength(10);
      expect(second['args']).toHaveLength(10);
      expect(third['args']).toHaveLength(1);
    });

    it('should subscribe only new instruments on an existing connection', async () => {
      await manager.connectTickers(
        ['BTC-USDT-SWAP'],
        jest.fn(),
      );

      await manager.connectTickers(
        ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
        jest.fn(),
      );

      expect(getClient(0).send).toHaveBeenCalledTimes(1);

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'subscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'ETH-USDT-SWAP',
          },
        ],
      });
    });

    it('should not send new subscriptions when public connection is unhealthy', async () => {
      await manager.connectTickers(
        ['BTC-USDT-SWAP'],
        jest.fn(),
      );

      getClient(0).isHealthy.mockReturnValue(false);

      await manager.connectTickers(
        ['ETH-USDT-SWAP'],
        jest.fn(),
      );

      expect(getClient(0).send).not.toHaveBeenCalled();
    });

    it('should not send a message when all instruments are already subscribed', async () => {
      await manager.connectTickers(
        ['BTC-USDT-SWAP'],
        jest.fn(),
      );

      await manager.connectTickers(
        ['BTC-USDT-SWAP'],
        jest.fn(),
      );

      expect(getClient(0).send).not.toHaveBeenCalled();
    });
  });

  describe('ticker disconnection', () => {
    it('should disconnect public connection when last ticker is removed', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      manager.disconnectTicker('BTC-USDT-SWAP');

      expect(getClient(0).disconnect).toHaveBeenCalledTimes(1);
    });

    it('should send unsubscribe when other tickers remain', async () => {
      await manager.connectTickers(
        ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
        jest.fn(),
      );

      manager.disconnectTicker('BTC-USDT-SWAP');

      expect(parseSentMessage(getClient(0), 0)).toEqual({
        op: 'unsubscribe',
        args: [
          {
            channel: 'tickers',
            instId: 'BTC-USDT-SWAP',
          },
        ],
      });

      expect(getClient(0).disconnect).not.toHaveBeenCalled();
    });

    it('should ignore unknown ticker disconnection', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      manager.disconnectTicker('ETH-USDT-SWAP');

      expect(getClient(0).send).not.toHaveBeenCalled();
      expect(getClient(0).disconnect).not.toHaveBeenCalled();
    });
  });

  describe('ticker message handling', () => {
    it('should emit ticker data from a valid ticker message', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      sendMessage(getOptions(0), {
        arg: { channel: 'tickers' },
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            bidPx: '65000',
            bidSz: '1.5',
            askPx: '65010',
            askSz: '2.5',
            ts: '123456789',
          },
        ],
      });

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'okx',
        symbol: 'BTC-USDT-SWAP',
        bidPrice: 65000,
        bidSize: 1.5,
        askPrice: 65010,
        askSize: 2.5,
        timestamp: 123456789,
      });
    });

    it('should return zero prices and sizes when values are missing', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      sendMessage(getOptions(0), {
        arg: { channel: 'tickers' },
        data: [
          {
            instId: 'BTC-USDT-SWAP',
          },
        ],
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          bidPrice: 0,
          bidSize: 0,
          askPrice: 0,
          askSize: 0,
        }),
      );
    });

    it('should use current time when ticker timestamp is missing', async () => {
      const callback = jest.fn();
      const now = Date.now();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      sendMessage(getOptions(0), {
        arg: { channel: 'tickers' },
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            bidPx: '100',
            askPx: '101',
          },
        ],
      });

      const received = callback.mock.calls[0][0] as {
        timestamp: number;
      };

      expect(received.timestamp).toBeGreaterThanOrEqual(now);
    });

    it('should ignore pong messages', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      getOptions(0).onMessage({
        toString: () => 'pong',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it.each(['subscribe', 'unsubscribe', 'error'])(
      'should ignore %s event messages',
      async (event) => {
        const callback = jest.fn();

        await manager.connectTicker('BTC-USDT-SWAP', callback);

        sendMessage(getOptions(0), { event });

        expect(callback).not.toHaveBeenCalled();
      },
    );

    it('should ignore messages from unsupported channels', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      sendMessage(getOptions(0), {
        arg: { channel: 'books' },
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            bidPx: '100',
            askPx: '101',
          },
        ],
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages with empty data', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      sendMessage(getOptions(0), {
        arg: { channel: 'tickers' },
        data: [],
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages for unknown instruments', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);

      sendMessage(getOptions(0), {
        arg: { channel: 'tickers' },
        data: [
          {
            instId: 'ETH-USDT-SWAP',
            bidPx: '100',
            askPx: '101',
          },
        ],
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON without throwing', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      expect(() => {
        getOptions(0).onMessage({
          toString: () => 'invalid-json',
        });
      }).not.toThrow();
    });
  });

  describe('private WebSocket connection', () => {
    it('should create a private WebSocket client', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(ReconnectingWsClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: privateUrl,
          exchangeId: 'okx-private',
          pingIntervalMs: 20_000,
        }),
      );

      expect(getClient(0).connect).toHaveBeenCalledTimes(1);
    });

    it('should use private connection callbacks', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(getOptions(0).onOpen).toEqual(expect.any(Function));
      expect(getOptions(0).onMessage).toEqual(expect.any(Function));
    });

    it('should send login request when private connection opens', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      getOptions(0).onOpen();

      expect(parseSentMessage(getClient(0), 0)).toMatchObject({
        op: 'login',
        args: [
          {
            apiKey,
            passphrase,
            timestamp: expect.any(String),
            sign: expect.any(String),
          },
        ],
      });
    });

    it('should generate a valid private authentication signature', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      getOptions(0).onOpen();

      const loginMessage = parseSentMessage(getClient(0), 0);
      const args = loginMessage['args'] as Array<
        Record<string, string>
      >;

      const timestamp = args[0]['timestamp'];

     const expectedSign = crypto
      .createHmac('sha256', apiSecret)
      .update(`${timestamp}GET/users/self/verify`)
      .digest('base64');

      expect(args[0].sign).toBe(expectedSign);
    });

    it('should subscribe to positions after authentication delay', async () => {
      jest.useFakeTimers();

      try {
        await manager.connectPrivate('account-1', jest.fn());

        getOptions(0).onOpen();

        expect(getClient(0).send).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(500);

        expect(getClient(0).send).toHaveBeenCalledTimes(2);

        expect(parseSentMessage(getClient(0), 1)).toEqual({
          op: 'subscribe',
          args: [
            {
              channel: 'positions',
              instType: 'SWAP',
            },
          ],
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('private message handling', () => {
    it('should ignore pong messages', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(() => {
        getOptions(0).onMessage({
          toString: () => 'pong',
        });
      }).not.toThrow();
    });

    it.each(['subscribe', 'unsubscribe', 'error'])(
      'should ignore private %s event messages',
      async (event) => {
        await manager.connectPrivate('account-1', jest.fn());

        expect(() => {
          sendMessage(getOptions(0), { event });
        }).not.toThrow();
      },
    );

    it('should ignore messages without instrument ID', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(() => {
        sendMessage(getOptions(0), {
          arg: {},
          data: [{ bids: [], asks: [] }],
        });
      }).not.toThrow();
    });

    it('should ignore private messages with empty data', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(() => {
        sendMessage(getOptions(0), {
          arg: { instId: 'BTC-USDT-SWAP' },
          data: [],
        });
      }).not.toThrow();
    });

    it('should handle malformed private JSON without throwing', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      expect(() => {
        getOptions(0).onMessage({
          toString: () => 'invalid-json',
        });
      }).not.toThrow();
    });

    it('should not emit ticker data when no matching ticker callback exists', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      sendMessage(getOptions(1), {
        arg: { instId: 'ETH-USDT-SWAP' },
        data: [
          {
            bids: [['3000', '1']],
            asks: [['3010', '2']],
            ts: '123',
          },
        ],
      });

      expect(getClient(0).send).not.toHaveBeenCalled();
    });

    it('should emit ticker data from a matching private message', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC-USDT-SWAP', callback);
      await manager.connectPrivate('account-1', jest.fn());

      sendMessage(getOptions(1), {
        arg: { instId: 'BTC-USDT-SWAP' },
        data: [
          {
            bids: [['65000', '1.5']],
            asks: [['65010', '2.5']],
            ts: '123456789',
          },
        ],
      });

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'okx',
        symbol: 'BTC-USDT-SWAP',
        bidPrice: 65000,
        bidSize: 1.5,
        askPrice: 65010,
        askSize: 2.5,
        timestamp: 123456789,
      });
    });
  });

  describe('health status', () => {
    it('should return healthy when no WebSocket connections exist', () => {
      expect(manager.isHealthy()).toBe(true);
    });

    it('should return public connection health', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      getClient(0).isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should return private connection health', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      getClient(0).isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should return false when either connection is unhealthy', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      getClient(0).isHealthy.mockReturnValue(true);
      getClient(1).isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });

    it('should return true when both connections are healthy', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      getClient(0).isHealthy.mockReturnValue(true);
      getClient(1).isHealthy.mockReturnValue(true);

      expect(manager.isHealthy()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect public connection', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());

      manager.disconnect();

      expect(getClient(0).disconnect).toHaveBeenCalledTimes(1);
    });

    it('should disconnect private connection', async () => {
      await manager.connectPrivate('account-1', jest.fn());

      manager.disconnect();

      expect(getClient(0).disconnect).toHaveBeenCalledTimes(1);
    });

    it('should disconnect both public and private connections', async () => {
      await manager.connectTicker('BTC-USDT-SWAP', jest.fn());
      await manager.connectPrivate('account-1', jest.fn());

      manager.disconnect();

      expect(getClient(0).disconnect).toHaveBeenCalledTimes(1);
      expect(getClient(1).disconnect).toHaveBeenCalledTimes(1);
    });

    it('should safely disconnect when no connections exist', () => {
      expect(() => manager.disconnect()).not.toThrow();
    });
  });
});
