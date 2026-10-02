import { MarketScannerService } from './market-scanner.service';
import { PublicTicker } from '../../core/market-data/public-market-data.interface';

const ticker = (exchangeId: PublicTicker['exchangeId'], bidPrice: number, askPrice: number, quote = 'USDT'): PublicTicker => ({ exchangeId, exchangeSymbol: `BTC${quote}`, normalizedSymbol: { baseAsset: 'BTC', quoteAsset: quote, settlementAsset: quote, marketType: 'perpetual', comparisonKey: `BTC-${quote}-PERP` }, bidPrice, askPrice, timestamp: Date.now(), receivedAt: Date.now() });
describe('MarketScannerService', () => {
  const redis = { set: jest.fn().mockResolvedValue(undefined) } as any;
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) } as any;
  it('calculates both executable directions, fees, sorting and limits', async () => {
    const service = new MarketScannerService(redis, config); (service as any).running = true;
    await service.ingest(ticker('binance', 100, 101)); await service.ingest(ticker('bybit', 103, 104));
    await Promise.resolve();
    const results = service.getOpportunities({ limit: 1 });
    expect(results).toHaveLength(1); expect(results[0]).toMatchObject({ buyExchange: 'binance', sellExchange: 'bybit' }); expect(results[0].netSpreadPercent).toBeCloseTo(((103 - 101) / 101) * 100 - 0.08);
  });
  it('rejects stale, invalid and non-comparable tickers', async () => {
    const service = new MarketScannerService(redis, config); (service as any).running = true;
    await service.ingest({ ...ticker('binance', 10, 9), receivedAt: Date.now() }); await service.ingest({ ...ticker('binance', 10, 11), receivedAt: Date.now() - 20_000 });
    await service.ingest(ticker('binance', 100, 101, 'USDT')); await service.ingest(ticker('hyperliquid', 103, 104, 'USDC'));
    await Promise.resolve(); expect(service.getOpportunities({})).toEqual([]);
  });
  it('starts and stops only public adapters', async () => {
    const service = new MarketScannerService(redis, config); const adapter = { exchangeId: 'binance', subscribeAllTickers: jest.fn().mockResolvedValue(undefined), unsubscribeAllTickers: jest.fn(), disconnect: jest.fn(), isHealthy: jest.fn().mockReturnValue(true) };
    (service as any).adapters = [adapter]; await service.start(); expect(service.status().running).toBe(true); expect(adapter.subscribeAllTickers).toHaveBeenCalled(); service.stop(); expect(service.status().running).toBe(false); expect(adapter.unsubscribeAllTickers).toHaveBeenCalled(); expect(adapter.disconnect).toHaveBeenCalled();
  });
  it('returns only fresh ticker rows for the requested exchange and limit', async () => {
    const service = new MarketScannerService(redis, config); (service as any).running = true;
    await service.ingest(ticker('binance', 100, 101)); await service.ingest(ticker('bybit', 102, 103));
    expect(service.getTickers({ exchange: 'binance', limit: 10 })).toEqual([expect.objectContaining({ exchangeId: 'binance', exchangeSymbol: 'BTCUSDT', bidPrice: 100, askPrice: 101 })]);
    expect(service.getTickers({ limit: 1 })).toHaveLength(1);
  });
});
