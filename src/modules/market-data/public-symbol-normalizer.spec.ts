import { normalizePublicSymbol } from './public-symbol-normalizer';

describe('normalizePublicSymbol', () => {
  it.each([['binance', 'BTCUSDT', 'BTC-USDT-PERP'], ['bybit', 'ETHUSDC', 'ETH-USDC-PERP'], ['okx', 'BTC-USDT-SWAP', 'BTC-USDT-PERP'], ['hyperliquid', 'BTC', 'BTC-USDC-PERP']] as const)('normalizes %s', (exchange, input, key) => {
    expect(normalizePublicSymbol(exchange, input)?.comparisonKey).toBe(key);
  });
  it('does not silently merge different settlement assets or invalid symbols', () => {
    expect(normalizePublicSymbol('binance', 'BTCUSDT')?.comparisonKey).not.toBe(normalizePublicSymbol('hyperliquid', 'BTC')?.comparisonKey);
    expect(normalizePublicSymbol('okx', 'BTC-USDT')).toBeNull();
  });
});
