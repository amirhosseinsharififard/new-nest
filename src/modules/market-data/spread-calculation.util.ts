export interface SimpleTicker {
  bidPrice: number;
  askPrice: number;
}

export interface SpreadDirection {
  /** جهت: کدوم صرافی Buy میشه و کدوم Sell */
  buyOn: 'A' | 'B';
  sellOn: 'A' | 'B';
  buyPrice: number;
  sellPrice: number;
  /** Spread خام قبل از کسر کارمزد (درصد) */
  grossSpreadPercent: number;
  /** Spread خالص بعد از کسر کارمزد هر دو طرف (درصد) — این عدد باید با Threshold مقایسه بشه */
  netSpreadPercent: number;
}

export interface SpreadResult {
  symbol: string;
  bestDirection: SpreadDirection;
  bothDirections: [SpreadDirection, SpreadDirection];
  timestamp: number;
}

/**
 * محاسبه خالص Spread آربیتراژ بین دو صرافی، با احتساب کارمزد هر دو طرف.
 *
 * منطق: برای خرید در صرافی A و فروش در صرافی B، باید:
 * - در A با قیمت Ask بخریم (چون Buy همیشه با Ask انجام میشه)
 * - در B با قیمت Bid بفروشیم (چون Sell همیشه با Bid انجام میشه)
 * این تابع هر دو جهت ممکن رو محاسبه می‌کنه و بهترین رو برمی‌گردونه.
 *
 * این یک تابع خالص است (Pure Function) — هیچ وابستگی به Redis/DB/Network نداره،
 * که باعث میشه تست‌نویسی روش بسیار ساده و قطعی باشه.
 */
export function calculateSpread(
  symbol: string,
  tickerA: SimpleTicker,
  tickerB: SimpleTicker,
  feeAPercent: number,
  feeBPercent: number,
): SpreadResult {
  // جهت ۱: خرید در A (با Ask A)، فروش در B (با Bid B)
  const directionAtoB = buildDirection(
    'A',
    'B',
    tickerA.askPrice,
    tickerB.bidPrice,
    feeAPercent,
    feeBPercent,
  );

  // جهت ۲: خرید در B (با Ask B)، فروش در A (با Bid A)
  const directionBtoA = buildDirection(
    'B',
    'A',
    tickerB.askPrice,
    tickerA.bidPrice,
    feeBPercent,
    feeAPercent,
  );

  const bestDirection =
    directionAtoB.netSpreadPercent >= directionBtoA.netSpreadPercent
      ? directionAtoB
      : directionBtoA;

  return {
    symbol,
    bestDirection,
    bothDirections: [directionAtoB, directionBtoA],
    timestamp: Date.now(),
  };
}

function buildDirection(
  buyOn: 'A' | 'B',
  sellOn: 'A' | 'B',
  buyPrice: number,
  sellPrice: number,
  buyFeePercent: number,
  sellFeePercent: number,
): SpreadDirection {
  const grossSpreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
  // کارمزد هر دو طرف معامله (خرید و فروش) از Spread خام کسر میشه
  const netSpreadPercent = grossSpreadPercent - buyFeePercent - sellFeePercent;

  return {
    buyOn,
    sellOn,
    buyPrice,
    sellPrice,
    grossSpreadPercent,
    netSpreadPercent,
  };
}

/** آیا این فرصت با توجه به Threshold استراتژی قابل قبوله؟ */
export function isSpreadProfitable(result: SpreadResult, minSpreadPercent: number): boolean {
  return result.bestDirection.netSpreadPercent >= minSpreadPercent;
}
