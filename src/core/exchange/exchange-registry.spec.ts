import { ExchangeRegistry } from './exchange-registry';
import { IExchangeAdapter } from './exchange-adapter.interface';
import {
  Balance,
  ClosePositionParams,
  OpenPositionParams,
  OrderResult,
  PositionStatus,
  PositionUpdate,
  TickerData,
} from './exchange.types';

// یک Adapter جعلی برای تست، بدون نیاز به اتصال واقعی به هیچ صرافی
class FakeAdapter implements IExchangeAdapter {
  readonly exchangeId = 'fake-exchange';
  connectWebSocket = jest.fn().mockResolvedValue(undefined);
  disconnectWebSocket = jest.fn().mockResolvedValue(undefined);
  isWebSocketHealthy = jest.fn().mockReturnValue(true);
  subscribeTicker = jest.fn();
  unsubscribeTicker = jest.fn();
  subscribePositionUpdates = jest.fn();
  openPosition = jest.fn() as unknown as (p: OpenPositionParams) => Promise<OrderResult>;
  closePosition = jest.fn() as unknown as (p: ClosePositionParams) => Promise<OrderResult>;
  getPositionStatus = jest.fn() as unknown as (a: string, s: string) => Promise<PositionStatus>;
  getBalance = jest.fn() as unknown as (a: string) => Promise<Balance[]>;
}

describe('ExchangeRegistry', () => {
  let registry: ExchangeRegistry;
  const baseConfig = {
    accountId: 'acc-1',
    exchangeId: 'fake-exchange',
    apiKey: 'key',
    apiSecret: 'secret',
    restBaseUrl: 'https://example.com',
    wsBaseUrl: 'wss://example.com',
  };

  beforeEach(() => {
    registry = new ExchangeRegistry();
  });

  it('باید یک صرافی جدید را بدون نیاز به تغییر کد Core ثبت کند', () => {
    registry.register('fake-exchange', () => new FakeAdapter());

    expect(registry.getRegisteredExchanges()).toContain('fake-exchange');
  });

  it('اگر صرافی ثبت نشده باشد، درخواست نمونه باید خطا بدهد', () => {
    expect(() => registry.getInstance(baseConfig)).toThrow(
      /ثبت نشده/,
    );
  });

  it('باید برای یک اکانت مشخص، همیشه همان نمونه Adapter را برگرداند (Singleton per account)', () => {
    registry.register('fake-exchange', () => new FakeAdapter());

    const instance1 = registry.getInstance(baseConfig);
    const instance2 = registry.getInstance(baseConfig);

    expect(instance1).toBe(instance2);
  });

  it('باید برای دو اکانت متفاوت روی همان صرافی، دو نمونه جدا بسازد', () => {
    registry.register('fake-exchange', () => new FakeAdapter());

    const instanceA = registry.getInstance({ ...baseConfig, accountId: 'acc-1' });
    const instanceB = registry.getInstance({ ...baseConfig, accountId: 'acc-2' });

    expect(instanceA).not.toBe(instanceB);
  });

  it('باید بتواند چند صرافی مختلف را هم‌زمان ثبت و بازیابی کند (تست ماژولار بودن)', () => {
    registry.register('fake-exchange', () => new FakeAdapter());
    registry.register('second-fake-exchange', () => new FakeAdapter());

    expect(registry.getRegisteredExchanges()).toEqual(
      expect.arrayContaining(['fake-exchange', 'second-fake-exchange']),
    );
  });

  it('disconnectAll باید disconnectWebSocket تمام نمونه‌های فعال را صدا بزند', async () => {
    registry.register('fake-exchange', () => new FakeAdapter());
    const instance = registry.getInstance(baseConfig) as FakeAdapter;

    await registry.disconnectAll();

    expect(instance.disconnectWebSocket).toHaveBeenCalledTimes(1);
    expect(registry.getRegisteredExchanges()).toContain('fake-exchange'); // ثبت باقی می‌ماند، فقط instance پاک میشه
  });
});
