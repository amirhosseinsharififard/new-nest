



import { HyperliquidAdapter } from './hyperliquid.adapter';
import { HyperliquidInfoClient } from './hyperliquid.rest';
import { HyperliquidWsManager } from './hyperliquid.ws';
import { NktkasHyperliquidExchangeClient } from './hyperliquid.exchange-client';

import { ExchangeAccountConfig } from '../../core/exchange/exchange-registry';

jest.mock('./hyperliquid.rest');
jest.mock('./hyperliquid.ws');
jest.mock('./hyperliquid.exchange-client');

describe('HyperliquidAdapter', () => {
  let adapter: HyperliquidAdapter;

  let infoMock: jest.Mocked<HyperliquidInfoClient>;
  let wsMock: jest.Mocked<HyperliquidWsManager>;
  let exchangeClientMock: jest.Mocked<NktkasHyperliquidExchangeClient>;

  const config = {
    apiKey: '0xpublic-wallet',
    apiSecret: 'private-key',
    publicKey: '0xpublic-wallet',
    privateKey: 'private-key',
    restBaseUrl: 'https://api.hyperliquid.xyz',
    wsBaseUrl: 'wss://api.hyperliquid.xyz/ws',
    accountId: 'test-account',
  } as unknown as ExchangeAccountConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    infoMock = {
      getClearinghouseState: jest.fn(),
      getMarketSymbols: jest.fn(),
    } as unknown as jest.Mocked<HyperliquidInfoClient>;

    wsMock = {
      connectTicker: jest.fn().mockResolvedValue(undefined),
      connectTickers: jest.fn().mockResolvedValue(undefined),
      disconnectTicker: jest.fn(),
      subscribeAccount: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isHealthy: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<HyperliquidWsManager>;

    exchangeClientMock = {
      placeMarketOrder: jest.fn(),
    } as unknown as jest.Mocked<NktkasHyperliquidExchangeClient>;

    (HyperliquidInfoClient as jest.Mock).mockImplementation(() => infoMock);
    (HyperliquidWsManager as jest.Mock).mockImplementation(() => wsMock);
    (NktkasHyperliquidExchangeClient as jest.Mock).mockImplementation(
      () => exchangeClientMock,
    );

    adapter = new HyperliquidAdapter(config);
  });

  describe('constructor', () => {
    it('should initialize with the correct exchange ID', () => {
      expect(adapter.exchangeId).toBe('hyperliquid');
    });

    it('should initialize REST, WebSocket, and exchange clients', () => {
      expect(HyperliquidInfoClient).toHaveBeenCalledWith(config.restBaseUrl);
      expect(HyperliquidWsManager).toHaveBeenCalledWith(config.wsBaseUrl);
      expect(NktkasHyperliquidExchangeClient).toHaveBeenCalledWith(
        config.privateKey,
      );
    });

    it('should allow public-only configuration', () => {
      expect(
        () =>
          new HyperliquidAdapter({
            restBaseUrl: config.restBaseUrl,
            wsBaseUrl: config.wsBaseUrl,
            accountId: 'public-market-data',
          } as unknown as ExchangeAccountConfig),
      ).not.toThrow();
    });
  });

  describe('WebSocket lifecycle', () => {
    it('should log when connecting', async () => {
      await expect(adapter.connectWebSocket()).resolves.toBeUndefined();
    });

    it('should disconnect the WebSocket manager', async () => {
      await adapter.disconnectWebSocket();

      expect(wsMock.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should return WebSocket health status', () => {
      wsMock.isHealthy.mockReturnValue(false);

      expect(adapter.isWebSocketHealthy()).toBe(false);
    });
  });
});
