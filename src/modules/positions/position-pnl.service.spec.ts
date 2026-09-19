import { NotFoundException } from '@nestjs/common';
import { PositionPnlService } from './position-pnl.service';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

describe('PositionPnlService', () => {
  let service: PositionPnlService;
  let positionRepo: any;
  let spreadCalculator: any;

  beforeEach(() => {
    positionRepo = { findOne: jest.fn() };
    spreadCalculator = { getCachedTicker: jest.fn() };
    service = new PositionPnlService(positionRepo, spreadCalculator);
  });

  const buildLeg = (overrides = {}) => ({
    id: 'leg-1',
    side: PositionSide.LONG,
    status: OrderStatus.FILLED,
    filledQuantity: '0.01',
    avgFillPrice: '100',
    exchangeAccount: { exchange: { slug: 'binance' } },
    ...overrides,
  });

  describe('calculateLivePnl', () => {
    it('اگر پوزیشن یافت نشود باید NotFoundException بدهد', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      await expect(service.calculateLivePnl('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('برای Leg با side=LONG، سود باید با قیمت Bid فعلی محاسبه شود', async () => {
      const leg = buildLeg({ side: PositionSide.LONG, avgFillPrice: '100' });
      positionRepo.findOne.mockResolvedValue({ id: 'pos-1', symbol: 'BTC-USDT', legs: [leg] });
      spreadCalculator.getCachedTicker.mockResolvedValue({ bidPrice: 105, askPrice: 105.2 });

      const result = await service.calculateLivePnl('pos-1');

      // (105 - 100) * 0.01 = 0.05
      expect(result.legs[0].pnl).toBeCloseTo(0.05, 6);
      expect(result.legs[0].currentPrice).toBe(105);
      expect(result.totalPnl).toBeCloseTo(0.05, 6);
    });

    it('برای Leg با side=SHORT، سود باید با قیمت Ask فعلی محاسبه شود', async () => {
      const leg = buildLeg({ side: PositionSide.SHORT, avgFillPrice: '100' });
      positionRepo.findOne.mockResolvedValue({ id: 'pos-1', symbol: 'BTC-USDT', legs: [leg] });
      spreadCalculator.getCachedTicker.mockResolvedValue({ bidPrice: 94.8, askPrice: 95 });

      const result = await service.calculateLivePnl('pos-1');

      // (100 - 95) * 0.01 = 0.05  (چون Short بوده و قیمت افت کرده، سود می‌کنیم)
      expect(result.legs[0].pnl).toBeCloseTo(0.05, 6);
      expect(result.legs[0].currentPrice).toBe(95);
    });

    it('باید PnL هر دو Leg را جمع بزند و totalPnl صحیح بدهد', async () => {
      const legA = buildLeg({
        id: 'leg-a',
        side: PositionSide.LONG,
        avgFillPrice: '100',
        exchangeAccount: { exchange: { slug: 'binance' } },
      });
      const legB = buildLeg({
        id: 'leg-b',
        side: PositionSide.SHORT,
        avgFillPrice: '102',
        exchangeAccount: { exchange: { slug: 'bybit' } },
      });
      positionRepo.findOne.mockResolvedValue({ id: 'pos-1', symbol: 'BTC-USDT', legs: [legA, legB] });
      spreadCalculator.getCachedTicker.mockImplementation((slug: string) =>
        slug === 'binance'
          ? Promise.resolve({ bidPrice: 101, askPrice: 101.2 })
          : Promise.resolve({ bidPrice: 100.8, askPrice: 101 }),
      );

      const result = await service.calculateLivePnl('pos-1');

      // Leg A (LONG@100): (101-100)*0.01 = 0.01
      // Leg B (SHORT@102): (102-101)*0.01 = 0.01
      expect(result.totalPnl).toBeCloseTo(0.02, 6);
    });

    it('اگر قیمت یکی از Legها در Cache نباشد، آن Leg باید isStale=true و pnl=null داشته باشد', async () => {
      const leg = buildLeg();
      positionRepo.findOne.mockResolvedValue({ id: 'pos-1', symbol: 'BTC-USDT', legs: [leg] });
      spreadCalculator.getCachedTicker.mockResolvedValue(null);

      const result = await service.calculateLivePnl('pos-1');

      expect(result.legs[0].isStale).toBe(true);
      expect(result.legs[0].pnl).toBeNull();
    });

    it('اگر یک Leg قیمت نداشته باشد، totalPnl کل باید null باشد (نه جمع ناقص)', async () => {
      const legA = buildLeg({ id: 'leg-a', exchangeAccount: { exchange: { slug: 'binance' } } });
      const legB = buildLeg({ id: 'leg-b', exchangeAccount: { exchange: { slug: 'bybit' } } });
      positionRepo.findOne.mockResolvedValue({ id: 'pos-1', symbol: 'BTC-USDT', legs: [legA, legB] });
      spreadCalculator.getCachedTicker.mockImplementation((slug: string) =>
        slug === 'binance'
          ? Promise.resolve({ bidPrice: 105, askPrice: 105.2 })
          : Promise.resolve(null), // این یکی قیمت نداره
      );

      const result = await service.calculateLivePnl('pos-1');

      expect(result.totalPnl).toBeNull();
    });

    it('اگر Leg هنوز پر نشده باشد (status != FILLED)، باید isStale=true باشد', async () => {
      const leg = buildLeg({ status: OrderStatus.PENDING, avgFillPrice: null, filledQuantity: null });
      positionRepo.findOne.mockResolvedValue({ id: 'pos-1', symbol: 'BTC-USDT', legs: [leg] });

      const result = await service.calculateLivePnl('pos-1');

      expect(result.legs[0].isStale).toBe(true);
      expect(spreadCalculator.getCachedTicker).not.toHaveBeenCalled();
    });
  });
});
