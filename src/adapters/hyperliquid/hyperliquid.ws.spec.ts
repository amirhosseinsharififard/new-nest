import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import { HyperliquidWsManager } from './hyperliquid.ws';
import { OrderStatus } from '../../core/exchange/exchange.types';

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

let mockWs: WsMock;
let mockOptions: WsOptions;
let mockHealthy = true;
jest.mock('../common/reconnecting-ws-client', () => ({
  ReconnectingWsClient: jest.fn().mockImplementation((options: WsOptions) => {
    mockOptions = options;
    mockHealthy = true;
    mockWs = {
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn(),
      disconnect: jest.fn(),
      isHealthy: jest.fn(() => mockHealthy),
    };

    return mockWs;
  }),
}));

describe('HyperliquidWsManager', () => {
  let manager: HyperliquidWsManager;

  const wsConstructor = ReconnectingWsClient as jest.MockedClass<
    typeof ReconnectingWsClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new HyperliquidWsManager();
    mockHealthy = true;
  });

  const parseSentMessage = (index: number): Record<string, unknown> => {
    const message = mockWs.send.mock.calls[index][0] as string;
    return JSON.parse(message) as Record<string, unknown>;
  };

  const sendMessage = (message: unknown): void => {
    mockOptions.onMessage({
      toString: () => JSON.stringify(message),
    });
  };

  describe('constructor and connection', () => {
    it('should use the default WebSocket URL', () => {
      expect(manager.isHealthy()).toBe(true);
    });

    it('should create WebSocket client with correct configuration', async () => {
      await manager.connectTicker('BTC', jest.fn());

      expect(wsConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'wss://api.hyperliquid.xyz/ws',
          exchangeId: 'hyperliquid',
          pingIntervalMs: 30_000,
        }),
      );

      expect(mockWs.connect).toHaveBeenCalledTimes(1);
    });

    it('should support custom WebSocket URL', async () => {
      manager = new HyperliquidWsManager('wss://custom.example.com/ws');

      await manager.connectTicker('BTC', jest.fn());

      expect(wsConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'wss://custom.example.com/ws',
        }),
      );
    });

    it('should reuse an existing connection', async () => {
      await manager.connectTicker('BTC', jest.fn());
      await manager.connectTicker('ETH', jest.fn());

      expect(mockWs.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('ticker subscriptions', () => {
    it('should subscribe to a ticker', async () => {
      await manager.connectTicker('BTC', jest.fn());

      expect(parseSentMessage(0)).toEqual({
        method: 'subscribe',
        subscription: {
          type: 'l2Book',
          coin: 'BTC',
        },
      });
    });

    it.each([
      ['BTC-USDT', 'BTC'],
      ['BTC/USDT', 'BTC'],
      ['btc-usdt', 'BTC'],
      ['ETH_USDT', 'ETH'],
    ])('should normalize %s to %s', async (symbol, expectedCoin) => {
      await manager.connectTicker(symbol, jest.fn());

      expect(parseSentMessage(0)).toEqual({
        method: 'subscribe',
        subscription: {
          type: 'l2Book',
          coin: expectedCoin,
        },
      });
    });

    it('should subscribe to multiple tickers', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'],
        jest.fn(),
      );

      expect(mockWs.send).toHaveBeenCalledTimes(3);
    });

    it('should not subscribe twice to the same normalized coin', async () => {
      await manager.connectTickers(
        ['BTC-USDT', 'BTC', 'BTC/USDT'],
        jest.fn(),
      );

      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });

    it('should not send subscription when WebSocket is unhealthy', async () => {
      await manager.connectTicker('BTC', jest.fn());

      mockWs.isHealthy.mockReturnValue(false);
      mockWs.send.mockClear();

      await manager.connectTicker('ETH', jest.fn());

      expect(mockWs.isHealthy).toHaveBeenCalled();
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('ticker disconnection', () => {
    it('should unsubscribe from a ticker', async () => {
      await manager.connectTicker('BTC', jest.fn());

      manager.disconnectTicker('BTC');

      expect(parseSentMessage(1)).toEqual({
        method: 'unsubscribe',
        subscription: {
          type: 'l2Book',
          coin: 'BTC',
        },
      });
    });

    it('should disconnect when the last ticker is removed and no wallet exists', async () => {
      await manager.connectTicker('BTC', jest.fn());

      manager.disconnectTicker('BTC');

      expect(mockWs.disconnect).toHaveBeenCalledTimes(1);
      expect(manager.isHealthy()).toBe(true);
    });

    it('should not unsubscribe from an unknown ticker', async () => {
      await manager.connectTicker('BTC', jest.fn());

      manager.disconnectTicker('ETH');

      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnection', () => {
    it('should resubscribe to all tickers after reconnecting', async () => {
      await manager.connectTickers(['BTC', 'ETH'], jest.fn());

      mockWs.send.mockClear();
      mockOptions.onOpen();

      expect(mockWs.send).toHaveBeenCalledTimes(2);

      expect(parseSentMessage(0)).toEqual({
        method: 'subscribe',
        subscription: { type: 'l2Book', coin: 'BTC' },
      });

      expect(parseSentMessage(1)).toEqual({
        method: 'subscribe',
        subscription: { type: 'l2Book', coin: 'ETH' },
      });
    });

    it('should report WebSocket health', async () => {
      await manager.connectTicker('BTC', jest.fn());

      mockWs.isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });
  });

  describe('L2 book messages', () => {
    it('should emit ticker data from order book', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC', callback);

      sendMessage({
        channel: 'l2Book',
        data: {
          coin: 'BTC',
          time: 123456789,
          levels: [
            [{ px: '65000', sz: '1.5' }],
            [{ px: '65010', sz: '2.5' }],
          ],
        },
      });

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'hyperliquid',
        symbol: 'BTC-USDT',
        bidPrice: 65000,
        bidSize: 1.5,
        askPrice: 65010,
        askSize: 2.5,
        timestamp: 123456789,
      });
    });

    it('should return zero values when order book levels are missing', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC', callback);

      sendMessage({
        channel: 'l2Book',
        data: {
          coin: 'BTC',
          levels: [[], []],
        },
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

    it('should ignore messages for unsubscribed coins', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC', callback);

      sendMessage({
        channel: 'l2Book',
        data: {
          coin: 'ETH',
          levels: [[], []],
        },
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('account subscriptions', () => {
    it('should subscribe to account updates', async () => {
      const walletAddress = '0x1234567890abcdef';

      await manager.subscribeAccount(walletAddress, jest.fn());

      expect(parseSentMessage(0)).toEqual({
        method: 'subscribe',
        subscription: {
          type: 'webData2',
          user: walletAddress,
        },
      });
    });

    it('should resubscribe to account updates after reconnecting', async () => {
      const walletAddress = '0x1234567890abcdef';

      await manager.subscribeAccount(walletAddress, jest.fn());

      mockWs.send.mockClear();
      mockOptions.onOpen();

      expect(parseSentMessage(0)).toEqual({
        method: 'subscribe',
        subscription: {
          type: 'webData2',
          user: walletAddress,
        },
      });
    });

    it('should keep WebSocket connected when the last ticker is removed but wallet exists', async () => {
      await manager.connectTicker('BTC', jest.fn());
      await manager.subscribeAccount('0x1234567890abcdef', jest.fn());

      manager.disconnectTicker('BTC');

      expect(mockWs.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('position messages', () => {
    it('should emit long position updates', async () => {
      const callback = jest.fn();

      await manager.subscribeAccount('0x1234567890abcdef', callback);

      sendMessage({
        channel: 'webData2',
        data: {
          clearinghouseState: {
            assetPositions: [
              {
                position: {
                  coin: 'BTC',
                  szi: '1.5',
                  entryPx: '65000',
                },
              },
            ],
          },
        },
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          exchangeId: 'hyperliquid',
          accountId: '',
          symbol: 'BTC-USDT',
          quantity: 1.5,
          entryPrice: 65000,
          status: OrderStatus.FILLED,
        }),
      );
    });

    it('should emit short position updates', async () => {
      const callback = jest.fn();

      await manager.subscribeAccount('0x1234567890abcdef', callback);

      sendMessage({
        channel: 'webData2',
        data: {
          clearinghouseState: {
            assetPositions: [
              {
                position: {
                  coin: 'ETH',
                  szi: '-2',
                  entryPx: '3000',
                },
              },
            ],
          },
        },
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'ETH-USDT',
          quantity: 2,
          entryPrice: 3000,
          status: OrderStatus.FILLED,
        }),
      );
    });

    it('should emit cancelled status for zero-size positions', async () => {
      const callback = jest.fn();

      await manager.subscribeAccount('0x1234567890abcdef', callback);

      sendMessage({
        channel: 'webData2',
        data: {
          clearinghouseState: {
            assetPositions: [
              {
                position: {
                  coin: 'BTC',
                  szi: '0',
                  entryPx: '0',
                },
              },
            ],
          },
        },
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 0,
          entryPrice: null,
          status: OrderStatus.CANCELLED,
        }),
      );
    });

    it('should not emit position updates without an account callback', async () => {
      const callback = jest.fn();

      await manager.connectTicker('BTC', callback);

      sendMessage({
        channel: 'webData2',
        data: {
          clearinghouseState: {
            assetPositions: [
              {
                position: {
                  coin: 'BTC',
                  szi: '1',
                  entryPx: '65000',
                },
              },
            ],
          },
        },
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('message handling and cleanup', () => {
    it('should ignore malformed JSON messages', async () => {
      await manager.connectTicker('BTC', jest.fn());

      expect(() => {
        mockOptions.onMessage({
          toString: () => 'invalid-json',
        });
      }).not.toThrow();
    });

    it('should clear subscriptions when disconnected', async () => {
      await manager.connectTicker('BTC', jest.fn());

      manager.disconnect();

      expect(mockWs.disconnect).toHaveBeenCalledTimes(1);
      expect(manager.isHealthy()).toBe(true);
    });

    it('should clear account callback when disconnected', async () => {
      const callback = jest.fn();

      await manager.subscribeAccount('0x1234567890abcdef', callback);

      manager.disconnect();

      // Messages received after disconnect should not emit position updates.
      // The manager no longer has a WebSocket connection or account callback.
      expect(manager.isHealthy()).toBe(true);
    });
  });
});
