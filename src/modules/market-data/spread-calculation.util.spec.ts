import { calculateSpread, isSpreadProfitable } from './spread-calculation.util';

describe('calculateSpread', () => {
  it('باید جهت صحیح آربیتراژ را وقتی B گران‌تر از A است تشخیص دهد', () => {
    // A: bid=100, ask=100.1  |  B: bid=102, ask=102.1
    // بهترین حالت: خرید در A (با ask=100.1) و فروش در B (با bid=102)
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100.1 },
      { bidPrice: 102, askPrice: 102.1 },
      0,
      0,
    );

    expect(result.bestDirection.buyOn).toBe('A');
    expect(result.bestDirection.sellOn).toBe('B');
    expect(result.bestDirection.buyPrice).toBe(100.1);
    expect(result.bestDirection.sellPrice).toBe(102);
  });

  it('باید جهت صحیح را وقتی A گران‌تر از B است تشخیص دهد', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 102, askPrice: 102.1 },
      { bidPrice: 100, askPrice: 100.1 },
      0,
      0,
    );

    expect(result.bestDirection.buyOn).toBe('B');
    expect(result.bestDirection.sellOn).toBe('A');
  });

  it('باید Gross Spread را درست محاسبه کند (بدون کارمزد)', () => {
    // خرید با 100، فروش با 102 => Spread = 2%
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 102, askPrice: 102 },
      0,
      0,
    );

    expect(result.bestDirection.grossSpreadPercent).toBeCloseTo(2, 5);
    expect(result.bestDirection.netSpreadPercent).toBeCloseTo(2, 5);
  });

  it('باید کارمزد هر دو صرافی را از Net Spread کسر کند', () => {
    // Gross = 2%, کارمزد هر طرف 0.04% => Net = 2 - 0.04 - 0.04 = 1.92%
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 102, askPrice: 102 },
      0.04,
      0.04,
    );

    expect(result.bestDirection.netSpreadPercent).toBeCloseTo(1.92, 5);
  });

  it('اگر کارمزد از Gross Spread بیشتر باشد، Net Spread باید منفی شود', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 100.1, askPrice: 100.1 }, // Spread خیلی کوچیک
      0.5,
      0.5,
    );

    expect(result.bestDirection.netSpreadPercent).toBeLessThan(0);
  });

  it('باید هر دو جهت را در bothDirections برگرداند', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100.1 },
      { bidPrice: 102, askPrice: 102.1 },
      0.04,
      0.04,
    );

    expect(result.bothDirections).toHaveLength(2);
    expect(result.bothDirections[0].buyOn).toBe('A');
    expect(result.bothDirections[1].buyOn).toBe('B');
  });

  it('وقتی قیمت‌ها برابرند، هر دو جهت باید Spread صفر (یا منفی به‌خاطر کارمزد) داشته باشند', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 100, askPrice: 100 },
      0.04,
      0.04,
    );

    expect(result.bestDirection.grossSpreadPercent).toBeCloseTo(0, 5);
    expect(result.bestDirection.netSpreadPercent).toBeCloseTo(-0.08, 5);
  });

  it('باید symbol و timestamp را در خروجی برگرداند', () => {
    const before = Date.now();
    const result = calculateSpread(
      'ETH-USDT',
      { bidPrice: 10, askPrice: 10.1 },
      { bidPrice: 11, askPrice: 11.1 },
      0,
      0,
    );
    const after = Date.now();

    expect(result.symbol).toBe('ETH-USDT');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('isSpreadProfitable', () => {
  it('باید true برگرداند اگر netSpreadPercent >= minSpreadPercent باشد', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 102, askPrice: 102 },
      0,
      0,
    );

    expect(isSpreadProfitable(result, 1.5)).toBe(true);
  });

  it('باید false برگرداند اگر netSpreadPercent کمتر از minSpreadPercent باشد', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 100.5, askPrice: 100.5 },
      0,
      0,
    );

    expect(isSpreadProfitable(result, 1)).toBe(false);
  });

  it('باید مرز دقیق (تساوی) را true در نظر بگیرد', () => {
    const result = calculateSpread(
      'BTC-USDT',
      { bidPrice: 100, askPrice: 100 },
      { bidPrice: 102, askPrice: 102 },
      0,
      0,
    );

    expect(isSpreadProfitable(result, 2)).toBe(true);
  });
});
