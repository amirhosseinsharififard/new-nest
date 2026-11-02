
import WebSocket from 'ws';

import { GateIoWsManager } from './gateio.ws';
import { ReconnectingWsClient } from '../common/reconnecting-ws-client';


jest.mock('../common/reconnecting-ws-client');

describe('GateIoWsManager', () => {
  let manager: GateIoWsManager;
  let wsMock: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    isHealthy: jest.Mock;
    send: jest.Mock;
  };

  let onOpen: () => void;
  let onMessage: (raw: WebSocket.RawData) => void;

  let getContractMultiplier: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    wsMock = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
      send: jest.fn(),
    };

    (ReconnectingWsClient as jest.Mock).mockImplementation(
      (options) => {
        onOpen = options.onOpen;
        onMessage = options.onMessage;

        return wsMock;
      },
    );

    getContractMultiplier = jest.fn().mockReturnValue(0.01);

    manager = new GateIoWsManager(getContractMultiplier);
  });

  describe('constructor', () => {
    it('should initialize WebSocket client with Gate.io URL', () => {
      expect(ReconnectingWsClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'wss://fx-ws.gateio.ws/v4/ws/usdt',
          exchangeId: 'gateio-ticker',
          onOpen: expect.any(Function),
          onMessage: expect.any(Function),
        }),
      );
    });
  });

  describe('connect', () => {
    it('should connect WebSocket client', async () => {
      await manager.connect();

      expect(wsMock.connect).toHaveBeenCalledTimes(1);
    });

    it('should propagate connection errors', async () => {
      const error = new Error('Connection failed');

      wsMock.connect.mockRejectedValue(error);

      await expect(manager.connect()).rejects.toThrow(error);
    });
  });

  describe('disconnect', () => {
    it('should disconnect WebSocket client', () => {
      manager.disconnect();

      expect(wsMock.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should clear subscribed symbols', () => {
      manager.subscribeTickers(['BTC-USDT', 'ETH-USDT'], jest.fn());

      manager.disconnect();

      wsMock.send.mockClear();

      onOpen();

      expect(wsMock.send).not.toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('should return WebSocket health status', () => {
      expect(manager.isHealthy()).toBe(true);

      expect(wsMock.isHealthy).toHaveBeenCalledTimes(1);
    });

    it('should return false when WebSocket is unhealthy', () => {
      wsMock.isHealthy.mockReturnValue(false);

      expect(manager.isHealthy()).toBe(false);
    });
  });

  describe('subscribeTicker', () => {
    it('should subscribe to a single ticker', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      expect(wsMock.send).toHaveBeenCalledTimes(1);

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload).toEqual({
        time: expect.any(Number),
        channel: 'futures.book_ticker',
        event: 'subscribe',
        payload: ['BTC_USDT'],
      });
    });

    it('should normalize the symbol before subscribing', () => {
      manager.subscribeTicker('btc/usdt', jest.fn());

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload.payload).toEqual(['BTC_USDT']);
    });
  });

  describe('subscribeTickers', () => {
    it('should subscribe to multiple tickers in one request', () => {
      const callback = jest.fn();

      manager.subscribeTickers(
        ['BTC-USDT', 'ETH-USDT'],
        callback,
      );

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload).toMatchObject({
        channel: 'futures.book_ticker',
        event: 'subscribe',
        payload: ['BTC_USDT', 'ETH_USDT'],
      });
    });

    it('should not subscribe to duplicate symbols', () => {
      manager.subscribeTickers(
        ['BTC-USDT', 'BTC/USDT'],
        jest.fn(),
      );

      expect(wsMock.send).toHaveBeenCalledTimes(1);

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload.payload).toEqual(['BTC_USDT', 'BTC_USDT']);
    });

    it('should not send a subscription when there are no new symbols', () => {
      manager.subscribeTicker('BTC-USDT', jest.fn());

      wsMock.send.mockClear();

      manager.subscribeTicker('BTC-USDT', jest.fn());

      expect(wsMock.send).not.toHaveBeenCalled();
    });

    it('should store subscriptions when WebSocket is unhealthy', () => {
      wsMock.isHealthy.mockReturnValue(false);

      manager.subscribeTicker('BTC-USDT', jest.fn());

      expect(wsMock.send).not.toHaveBeenCalled();

      wsMock.isHealthy.mockReturnValue(true);

      onOpen();

      expect(wsMock.send).toHaveBeenCalledTimes(1);

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload.payload).toEqual(['BTC_USDT']);
    });

    it('should use the latest callback for ticker updates', () => {
      const firstCallback = jest.fn();
      const secondCallback = jest.fn();

      manager.subscribeTicker('BTC-USDT', firstCallback);
      manager.subscribeTicker('ETH-USDT', secondCallback);

      onMessage(
        JSON.stringify({
          channel: 'futures.book_ticker',
          event: 'update',
          result: {
            t: 1234567890,
            u: 1,
            s: 'BTC_USDT',
            b: '100',
            B: '10',
            a: '101',
            A: '20',
          },
        }) as unknown as WebSocket.RawData,
      );

      expect(firstCallback).not.toHaveBeenCalled();

      expect(secondCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          exchangeId: 'gateio',
          symbol: 'BTC-USDT',
        }),
      );
    });
  });

  describe('unsubscribeTicker', () => {
    it('should unsubscribe from a single ticker', () => {
      manager.subscribeTicker('BTC-USDT', jest.fn());

      wsMock.send.mockClear();

      manager.unsubscribeTicker('BTC-USDT');

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload).toMatchObject({
        channel: 'futures.book_ticker',
        event: 'unsubscribe',
        payload: ['BTC_USDT'],
      });
    });

    it('should not send unsubscribe for an unknown symbol', () => {
      manager.unsubscribeTicker('BTC-USDT');

      expect(wsMock.send).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribeTickers', () => {
    it('should unsubscribe from multiple tickers', () => {
      manager.subscribeTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      wsMock.send.mockClear();

      manager.unsubscribeTickers(['BTC-USDT', 'ETH-USDT']);

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload).toMatchObject({
        channel: 'futures.book_ticker',
        event: 'unsubscribe',
        payload: ['BTC_USDT', 'ETH_USDT'],
      });
    });

    it('should unsubscribe only existing symbols', () => {
      manager.subscribeTicker('BTC-USDT', jest.fn());

      wsMock.send.mockClear();

      manager.unsubscribeTickers([
        'BTC-USDT',
        'ETH-USDT',
      ]);

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload.payload).toEqual(['BTC_USDT']);
    });

    it('should not send unsubscribe when no symbols exist', () => {
      manager.unsubscribeTickers(['BTC-USDT', 'ETH-USDT']);

      expect(wsMock.send).not.toHaveBeenCalled();
    });

    it('should remove symbols even when WebSocket is unhealthy', () => {
      manager.subscribeTicker('BTC-USDT', jest.fn());

      wsMock.send.mockClear();
      wsMock.isHealthy.mockReturnValue(false);

      manager.unsubscribeTicker('BTC-USDT');

      wsMock.isHealthy.mockReturnValue(true);

      onOpen();

      expect(wsMock.send).not.toHaveBeenCalled();
    });
  });

  describe('WebSocket message handling', () => {
    const sendTickerMessage = (
      result: Record<string, unknown>,
    ) => {
      onMessage(
        JSON.stringify({
          channel: 'futures.book_ticker',
          event: 'update',
          result,
        }) as unknown as WebSocket.RawData,
      );
    };

    it('should parse and emit ticker updates', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 1234567890,
        u: 10,
        s: 'BTC_USDT',
        b: '100.5',
        B: '10',
        a: '101.5',
        A: '20',
      });

      expect(callback).toHaveBeenCalledWith({
        exchangeId: 'gateio',
        symbol: 'BTC-USDT',
        bidPrice: 100.5,
        bidSize: 0.1,
        askPrice: 101.5,
        askSize: 0.2,
        timestamp: 1234567890,
      });

      expect(getContractMultiplier).toHaveBeenCalledWith('BTC-USDT');
    });

    it('should parse numeric sizes', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: '100',
        B: 5,
        a: '101',
        A: 10,
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          bidSize: 0.05,
          askSize: 0.1,
        }),
      );
    });

    it('should ignore messages from other channels', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      onMessage(
        JSON.stringify({
          channel: 'futures.trades',
          event: 'update',
          result: {
            s: 'BTC_USDT',
            b: '100',
            a: '101',
          },
        }) as unknown as WebSocket.RawData,
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore events other than update', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      onMessage(
        JSON.stringify({
          channel: 'futures.book_ticker',
          event: 'subscribe',
          result: {
            s: 'BTC_USDT',
            b: '100',
            a: '101',
          },
        }) as unknown as WebSocket.RawData,
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages without result', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      onMessage(
        JSON.stringify({
          channel: 'futures.book_ticker',
          event: 'update',
        }) as unknown as WebSocket.RawData,
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages with zero bid price', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: '0',
        B: '10',
        a: '101',
        A: '20',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages with zero ask price', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: '100',
        B: '10',
        a: '0',
        A: '20',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages with invalid bid price', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: 'invalid',
        B: '10',
        a: '101',
        A: '20',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should ignore messages with invalid ask price', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: '100',
        B: '10',
        a: 'invalid',
        A: '20',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should emit zero sizes when size values are invalid', () => {
      const callback = jest.fn();

      manager.subscribeTicker('BTC-USDT', callback);

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: '100',
        B: 'invalid',
        a: '101',
        A: 'invalid',
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          bidSize: 0,
          askSize: 0,
        }),
      );
    });

    it('should log Gate.io errors', () => {
      const errorSpy = jest
        .spyOn(
          (manager as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
          'error',
        )
        .mockImplementation();

      onMessage(
        JSON.stringify({
          channel: 'futures.book_ticker',
          event: 'update',
          error: {
            code: 1,
            message: 'Subscription failed',
          },
        }) as unknown as WebSocket.RawData,
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Gate.io WS error: Subscription failed',
      );
    });

    it('should log malformed JSON messages', () => {
      const errorSpy = jest
        .spyOn(
          (manager as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
          'error',
        )
        .mockImplementation();

      onMessage('invalid-json' as unknown as WebSocket.RawData);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse Gate.io message:'),
      );
    });

    it('should log errors thrown while processing ticker messages', () => {
      const errorSpy = jest
        .spyOn(
          (manager as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
          'error',
        )
        .mockImplementation();

      getContractMultiplier.mockImplementation(() => {
        throw new Error('Multiplier unavailable');
      });

      manager.subscribeTicker('BTC-USDT', jest.fn());

      sendTickerMessage({
        t: 100,
        u: 1,
        s: 'BTC_USDT',
        b: '100',
        B: '10',
        a: '101',
        A: '20',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Multiplier unavailable'),
      );
    });

    it('should not emit ticker when callback is not registered', () => {
      manager.subscribeTicker('BTC-USDT', jest.fn());

      manager.unsubscribeTicker('BTC-USDT');

      expect(() => {
        sendTickerMessage({
          t: 100,
          u: 1,
          s: 'BTC_USDT',
          b: '100',
          B: '10',
          a: '101',
          A: '20',
        });
      }).not.toThrow();
    });
  });

  describe('handleOpen', () => {
    it('should resubscribe to all stored symbols after reconnecting', () => {
      manager.subscribeTickers(
        ['BTC-USDT', 'ETH-USDT'],
        jest.fn(),
      );

      wsMock.send.mockClear();

      onOpen();

      const payload = JSON.parse(wsMock.send.mock.calls[0][0]);

      expect(payload).toMatchObject({
        channel: 'futures.book_ticker',
        event: 'subscribe',
        payload: ['BTC_USDT', 'ETH_USDT'],
      });
    });

    it('should not send a subscription when no symbols are stored', () => {
      onOpen();

      expect(wsMock.send).not.toHaveBeenCalled();
    });
  });
});
