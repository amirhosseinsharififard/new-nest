
import { Logger } from '@nestjs/common';

import { GateIoAdapter } from './gateio.adapter';
import { GateIoRestClient } from './gateio.rest';
import { GateIoWsManager } from './gateio.ws';


import { ExchangeAccountConfig } from 'src/core/exchange/exchange-registry';

jest.mock('./gateio.rest');
jest.mock('./gateio.ws');

describe('GateIoAdapter', () => {
  let adapter: GateIoAdapter;
  let restMock: jest.Mocked<GateIoRestClient>;
  let wsMock: jest.Mocked<GateIoWsManager>;

  const config = {
    accountId: 'account-1',
    restBaseUrl: 'https://test.gateio.com/api/v4',
  } as ExchangeAccountConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    restMock = {
      getMarketSymbols: jest.fn(),
      getContractMultiplier: jest.fn(),
    } as unknown as jest.Mocked<GateIoRestClient>;

    wsMock = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
      subscribeTicker: jest.fn(),
      unsubscribeTicker: jest.fn(),
      subscribeTickers: jest.fn(),
      unsubscribeTickers: jest.fn(),
    } as unknown as jest.Mocked<GateIoWsManager>;

    (GateIoRestClient as jest.Mock).mockImplementation(() => restMock);
    (GateIoWsManager as jest.Mock).mockImplementation(() => wsMock);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize REST and WebSocket clients', () => {
      adapter = new GateIoAdapter(config);

      expect(GateIoRestClient).toHaveBeenCalledWith(config.restBaseUrl);

      expect(GateIoWsManager).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it('should initialize with the correct exchange ID', () => {
      adapter = new GateIoAdapter(config);

      expect(adapter.exchangeId).toBe('gateio');
    });

    it('should log account initialization', () => {
      adapter = new GateIoAdapter(config);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Gate.io adapter initialized for account account-1',
      );
    });

    it('should pass the REST contract multiplier callback to WebSocket manager', () => {
      adapter = new GateIoAdapter(config);

      const multiplierCallback = (
        GateIoWsManager as jest.Mock
      ).mock.calls[0][0] as (symbol: string) => number;

      restMock.getContractMultiplier.mockReturnValue(0.01);

      expect(multiplierCallback('BTC-USDT')).toBe(0.01);

      expect(restMock.getContractMultiplier).toHaveBeenCalledWith(
        'BTC-USDT',
      );
    });
  });

  describe('WebSocket lifecycle', () => {
    beforeEach(() => {
      adapter = new GateIoAdapter(config);
    });

    it('should connect WebSocket', async () => {
      await adapter.connectWebSocket();

      expect(wsMock.connect).toHaveBeenCalledTimes(1);
    });

    it('should propagate connection errors', async () => {
      const error = new Error('Connection failed');

      wsMock.connect.mockRejectedValue(error);

      await expect(adapter.connectWebSocket()).rejects.toThrow(error);
    });

    it('should disconnect WebSocket', async () => {
      await adapter.disconnectWebSocket();

      expect(wsMock.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should return WebSocket health status', () => {
      expect(adapter.isWebSocketHealthy()).toBe(true);

      expect(wsMock.isHealthy).toHaveBeenCalledTimes(1);
    });

    it('should return unhealthy status when WebSocket is disconnected', () => {
      wsMock.isHealthy.mockReturnValue(false);

      expect(adapter.isWebSocketHealthy()).toBe(false);
    });
  });

  describe('ticker subscriptions', () => {
    beforeEach(() => {
      adapter = new GateIoAdapter(config);
    });

    it('should subscribe to a single ticker', () => {
      const callback = jest.fn();

      adapter.subscribeTicker('BTC-USDT', callback);

      expect(wsMock.subscribeTicker).toHaveBeenCalledWith(
        'BTC-USDT',
        callback,
      );
    });

    it('should unsubscribe from a single ticker', () => {
      adapter.unsubscribeTicker('BTC-USDT');

      expect(wsMock.unsubscribeTicker).toHaveBeenCalledWith('BTC-USDT');
    });

    it('should subscribe to multiple tickers', () => {
      const callback = jest.fn();
      const symbols = ['BTC-USDT', 'ETH-USDT'];

      adapter.subscribeTickers(symbols, callback);

      expect(wsMock.subscribeTickers).toHaveBeenCalledWith(
        symbols,
        callback,
      );
    });

    it('should unsubscribe from multiple tickers', () => {
      const symbols = ['BTC-USDT', 'ETH-USDT'];

      adapter.unsubscribeTickers(symbols);

      expect(wsMock.unsubscribeTickers).toHaveBeenCalledWith(symbols);
    });
  });

  describe('market symbols', () => {
    beforeEach(() => {
      adapter = new GateIoAdapter(config);
    });

    it('should return market symbols from REST client', async () => {
      const symbols = ['BTC-USDT', 'ETH-USDT'];

      restMock.getMarketSymbols.mockResolvedValue(symbols);

      await expect(adapter.getMarketSymbols()).resolves.toEqual(symbols);

      expect(restMock.getMarketSymbols).toHaveBeenCalledTimes(1);
    });

    it('should propagate REST errors', async () => {
      const error = new Error('Failed to fetch symbols');

      restMock.getMarketSymbols.mockRejectedValue(error);

      await expect(adapter.getMarketSymbols()).rejects.toThrow(error);
    });
  });

  describe('position updates', () => {
    beforeEach(() => {
      adapter = new GateIoAdapter(config);
    });

    it('should log a warning because private position updates are not implemented', () => {
      const callback = jest.fn()

      adapter.subscribePositionUpdates('account-1', callback);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'Gate.io private position updates are not implemented yet',
      );

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('trading operations', () => {
    beforeEach(() => {
      adapter = new GateIoAdapter(config);
    });

    it('should reject opening a position', async () => {
      await expect(
        adapter.openPosition({} as never),
      ).rejects.toThrow('Gate.io trading is not implemented yet');
    });

    it('should reject closing a position', async () => {
      await expect(
        adapter.closePosition({} as never),
      ).rejects.toThrow('Gate.io trading is not implemented yet');
    });

    it('should reject retrieving position status', async () => {
      await expect(
        adapter.getPositionStatus('account-1', 'BTC-USDT'),
      ).rejects.toThrow(
        'Gate.io position status is not implemented yet',
      );
    });

    it('should reject retrieving account balance', async () => {
      await expect(
        adapter.getBalance('account-1'),
      ).rejects.toThrow(
        'Gate.io balance retrieval is not implemented yet',
      );
    });
  });
});
