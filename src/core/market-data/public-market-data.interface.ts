/** Public-only market-data contract. It deliberately has no account or credential fields. */
export type PublicExchangeId = 'binance' | 'bybit' | 'okx' | 'hyperliquid';

export interface NormalizedMarketSymbol {
  baseAsset: string;
  quoteAsset: string;
  settlementAsset: string;
  marketType: 'perpetual';
  /** USDT and USDC deliberately remain distinct comparison groups. */
  comparisonKey: string;
}

export interface PublicTicker {
  exchangeId: PublicExchangeId;
  normalizedSymbol: NormalizedMarketSymbol;
  exchangeSymbol: string;
  bidPrice: number;
  askPrice: number;
  timestamp: number;
  receivedAt: number;
}

export type PublicTickerCallback = (ticker: PublicTicker) => void;

export interface IPublicMarketDataAdapter {
  readonly exchangeId: PublicExchangeId;
  connect(): Promise<void>;
  disconnect(): void;
  isHealthy(): boolean;
  subscribeAllTickers(callback: PublicTickerCallback): Promise<void>;
  unsubscribeAllTickers(): void;
}
