import { ExchangeRegistry } from '../core/exchange/exchange-registry';
import { registerAllAdapters } from './index';

describe('registerAllAdapters (تست یکپارچگی ماژولار بودن)', () => {
  it('باید هر ۴ صرافی (۳ CEX + ۱ DEX) را بدون خطا ثبت کند', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    expect(registry.getRegisteredExchanges()).toEqual(
      expect.arrayContaining(['binance', 'bybit', 'okx', 'hyperliquid']),
    );
  });

  it('باید بتواند نمونه Binance Adapter را با apiKey/apiSecret بسازد', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    const instance = registry.getInstance({
      accountId: 'acc-1',
      exchangeId: 'binance',
      apiKey: 'key',
      apiSecret: 'secret',
      restBaseUrl: 'https://fapi.binance.com',
      wsBaseUrl: 'wss://fstream.binance.com',
    });

    expect(instance.exchangeId).toBe('binance');
  });

  it('باید بدون apiKey/apiSecret برای Binance خطای واضح بدهد', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    expect(() =>
      registry.getInstance({
        accountId: 'acc-2',
        exchangeId: 'binance',
        restBaseUrl: 'https://fapi.binance.com',
        wsBaseUrl: 'wss://fstream.binance.com',
      }),
    ).toThrow(/apiKey/);
  });

  it('باید بتواند نمونه OKX Adapter را با apiKey/apiSecret/passphrase بسازد', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    const instance = registry.getInstance({
      accountId: 'acc-3',
      exchangeId: 'okx',
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: 'my-pass',
      restBaseUrl: 'https://www.okx.com',
      wsBaseUrl: 'wss://ws.okx.com:8443/ws/v5/public',
    });

    expect(instance.exchangeId).toBe('okx');
  });

  it('باید بدون passphrase برای OKX خطای واضح بدهد', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    expect(() =>
      registry.getInstance({
        accountId: 'acc-4',
        exchangeId: 'okx',
        apiKey: 'key',
        apiSecret: 'secret',
        restBaseUrl: 'https://www.okx.com',
        wsBaseUrl: 'wss://ws.okx.com:8443/ws/v5/public',
      }),
    ).toThrow(/passphrase/);
  });

  it('باید بتواند نمونه Hyperliquid Adapter را با publicKey/privateKey بسازد (نه apiKey)', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    const instance = registry.getInstance({
      accountId: 'acc-5',
      exchangeId: 'hyperliquid',
      publicKey: '0xWalletAddress',
      privateKey: '0xPrivateKey',
      restBaseUrl: 'https://api.hyperliquid.xyz',
      wsBaseUrl: 'wss://api.hyperliquid.xyz/ws',
    });

    expect(instance.exchangeId).toBe('hyperliquid');
  });

  it('باید بدون publicKey/privateKey برای Hyperliquid خطای واضح بدهد', () => {
    const registry = new ExchangeRegistry();
    registerAllAdapters(registry);

    expect(() =>
      registry.getInstance({
        accountId: 'acc-6',
        exchangeId: 'hyperliquid',
        restBaseUrl: 'https://api.hyperliquid.xyz',
        wsBaseUrl: 'wss://api.hyperliquid.xyz/ws',
      }),
    ).toThrow(/publicKey/);
  });
});
