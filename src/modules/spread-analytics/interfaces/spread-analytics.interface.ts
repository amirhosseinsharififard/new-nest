
export interface SpreadQuote {
  exchangeSlug: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  receivedAt: Date;
}

export interface SpreadSample {
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  availableBuySize: number;
  availableSellSize: number;
  availableSize: number;
  spreadPercent: number;
  timestamp: Date;
}

export interface SpreadTurningPoint {
  type: 'MIN' | 'MAX';
  spreadPercent: number;
  timestamp: Date;
}

export interface SpreadCycle {
  start: Date;
  peak: Date;
  end: Date;
  entrySpread: number;
  peakSpread: number;
  exitSpread: number;
  amplitude: number;
  durationMinutes: number;
}

export interface SpreadWindowAnalytics {
  window: string;
  sampleCount: number;
  minSpread: number | null;
  maxSpread: number | null;
  averageSpread: number | null;
  currentSpread: number | null;
  movement: number | null;
  turningPoints: SpreadTurningPoint[];
  cycles: SpreadCycle[];
  noiseThresholdPercent: number | null;
}

export interface SpreadPairAnalytics {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  windows: SpreadWindowAnalytics[];
}

export interface SpreadAnalyticsResponse {
  symbol: string;
  generatedAt: Date;
  maxQuoteAgeMs: number;
  pairs: SpreadPairAnalytics[];
}

