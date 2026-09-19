import { PriceAggregatorService } from './price-aggregator.service';
import { TickerData } from '../../core/exchange/exchange.types';

describe('PriceAggregatorService', () => {
  let service: PriceAggregatorService;
  let registry: any;
  let spreadCalculator: any;
  let fakeAdapter: any;
  let tickerCallback: ((data: TickerData) => void) | null;

  beforeEach(() => {
    tickerCallback = null;
    fakeAdapter = {
      exchangeId: 'binance',
      subscribeTicker: jest.fn((symbol: string, cb: (data: TickerData) => void) => {
        tickerCallback = cb;
      }),
    };
    registry = {
      getInstance: jest.fn().mockReturnValue(fakeAdapter),
    };
    spreadCalculator = {
      cacheTicker: jest.fn().mockResolvedValue(undefined),
    };

    service = new PriceAggregatorService(registry, spreadCalculator);
  });

  const baseConfig = {
    accountId: 'acc-1',
    exchangeId: 'binance',
    apiKey: 'key',
    apiSecret: 'secret',
    restBaseUrl: 'https://fapi.binance.com',
    wsBaseUrl: 'wss://fstream.binance.com',
  };

  it('باید از Registry نمونه Adapter مناسب را بگیرد و subscribeTicker را صدا بزند', () => {
    service.watchSymbol(baseConfig, 'BTC-USDT');

    expect(registry.getInstance).toHaveBeenCalledWith(baseConfig);
    expect(fakeAdapter.subscribeTicker).toHaveBeenCalledWith('BTC-USDT', expect.any(Function));
  });

  it('وقتی Adapter قیمت جدید بده، باید cacheTicker با exchangeId درست صدا زده شود', async () => {
    service.watchSymbol(baseConfig, 'BTC-USDT');

    const ticker: TickerData = {
      exchangeId: 'binance',
      symbol: 'BTC-USDT',
      bidPrice: 100,
      askPrice: 100.1,
      timestamp: Date.now(),
    };
    tickerCallback?.(ticker);

    // چون callback داخلی async هست (catch روی promise)، یک microtask صبر می‌کنیم
    await new Promise((resolve) => setImmediate(resolve));

    expect(spreadCalculator.cacheTicker).toHaveBeenCalledWith('binance', ticker);
  });

  it('نباید برای یک (exchangeId, symbol) تکراری دوباره subscribe کند', () => {
    service.watchSymbol(baseConfig, 'BTC-USDT');
    service.watchSymbol(baseConfig, 'BTC-USDT');

    expect(fakeAdapter.subscribeTicker).toHaveBeenCalledTimes(1);
  });

  it('باید برای Symbolهای متفاوت جدا subscribe کند', () => {
    service.watchSymbol(baseConfig, 'BTC-USDT');
    service.watchSymbol(baseConfig, 'ETH-USDT');

    expect(fakeAdapter.subscribeTicker).toHaveBeenCalledTimes(2);
  });

  it('isWatching باید وضعیت صحیح subscribe را برگرداند', () => {
    expect(service.isWatching('binance', 'BTC-USDT')).toBe(false);

    service.watchSymbol(baseConfig, 'BTC-USDT');

    expect(service.isWatching('binance', 'BTC-USDT')).toBe(true);
    expect(service.isWatching('binance', 'ETH-USDT')).toBe(false);
  });
});
