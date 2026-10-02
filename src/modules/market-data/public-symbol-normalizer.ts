import { NormalizedMarketSymbol, PublicExchangeId } from '../../core/market-data/public-market-data.interface';

const stable = (baseAsset: string, quoteAsset: string): NormalizedMarketSymbol => ({
  baseAsset: baseAsset.toUpperCase(), quoteAsset: quoteAsset.toUpperCase(), settlementAsset: quoteAsset.toUpperCase(),
  marketType: 'perpetual', comparisonKey: `${baseAsset.toUpperCase()}-${quoteAsset.toUpperCase()}-PERP`,
});

export function normalizePublicSymbol(exchangeId: PublicExchangeId, symbol: string): NormalizedMarketSymbol | null {
  const value = symbol.trim().toUpperCase();
  if (!value) return null;
  if (exchangeId === 'okx') {
    const match = /^([A-Z0-9]+)-(USDT|USDC)-SWAP$/.exec(value);
    return match ? stable(match[1], match[2]) : null;
  }
  if (exchangeId === 'hyperliquid') return /^[A-Z0-9]+$/.test(value) ? stable(value, 'USDC') : null;
  const match = /^([A-Z0-9]+)(USDT|USDC)$/.exec(value);
  return match ? stable(match[1], match[2]) : null;
}

export function normalizedSymbolLabel(symbol: NormalizedMarketSymbol): string {
  return `${symbol.baseAsset}-${symbol.quoteAsset}-PERP`;
}
