import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArbitragePosition } from './entities/arbitrage-position.entity';
import { PositionLeg } from './entities/position-leg.entity';
import { SpreadCalculatorService } from '../market-data/spread-calculator.service';
import { OrderStatus, PositionSide } from '../../core/exchange/exchange.types';

export interface LegPnl {
  legId: string;
  exchangeSlug: string;
  side: PositionSide;
  entryPrice: number | null;
  currentPrice: number | null;
  quantity: number;
  pnl: number | null;
  isStale: boolean; // یعنی قیمت زنده‌ای در Cache نیست (WS قطع شده یا هنوز نیومده)
}

export interface PositionPnlResult {
  positionId: string;
  symbol: string;
  legs: LegPnl[];
  totalPnl: number | null;
  calculatedAt: number;
}

/**
 * محاسبه سود/زیان لحظه‌ای بر اساس آخرین قیمت Cache شده در Redis
 * (همون قیمتی که PriceAggregatorService از WebSocket می‌گیره).
 *
 * این PnL "تخمینی" است، نه دقیقاً همون چیزی که با بستن واقعی پوزیشن
 * به‌دست میاد — چون Slippage و Fee بستن رو لحاظ نمی‌کنه. برای دیدن
 * PnL دقیق واقعی، باید از استعلام مستقیم صرافی (adapter.getPositionStatus)
 * استفاده کرد که کندتر و به Rate Limit صرافی وابسته‌ست.
 */
@Injectable()
export class PositionPnlService {
  private readonly logger = new Logger(PositionPnlService.name);

  constructor(
    @InjectRepository(ArbitragePosition)
    private readonly positionRepo: Repository<ArbitragePosition>,
    private readonly spreadCalculator: SpreadCalculatorService,
  ) {}

  async calculateLivePnl(positionId: string): Promise<PositionPnlResult> {
    const position = await this.positionRepo.findOne({
      where: { id: positionId },
      relations: ['legs', 'legs.exchangeAccount', 'legs.exchangeAccount.exchange'],
    });
    if (!position) {
      throw new NotFoundException('پوزیشن یافت نشد');
    }

    const legResults = await Promise.all(
      position.legs.map((leg) => this.calculateLegPnl(position.symbol, leg)),
    );

    const allPricesAvailable = legResults.every((l) => !l.isStale && l.pnl !== null);
    const totalPnl = allPricesAvailable
      ? legResults.reduce((sum, l) => sum + (l.pnl ?? 0), 0)
      : null; // اگر قیمت یکی از Legها موجود نباشه، جمع کل هم قابل اعتماد نیست

    return {
      positionId: position.id,
      symbol: position.symbol,
      legs: legResults,
      totalPnl,
      calculatedAt: Date.now(),
    };
  }

  private async calculateLegPnl(symbol: string, leg: PositionLeg): Promise<LegPnl> {
    const exchangeSlug = leg.exchangeAccount.exchange?.slug ?? 'unknown';
    const isFilled = leg.status === OrderStatus.FILLED || leg.status === OrderStatus.PARTIALLY_FILLED;
    const quantity = parseFloat(leg.filledQuantity ?? '0');
    const entryPrice = leg.avgFillPrice ? parseFloat(leg.avgFillPrice) : null;

    if (!isFilled || entryPrice === null || quantity === 0) {
      return {
        legId: leg.id,
        exchangeSlug,
        side: leg.side,
        entryPrice,
        currentPrice: null,
        quantity,
        pnl: null,
        isStale: true,
      };
    }

    const ticker = await this.spreadCalculator.getCachedTicker(exchangeSlug, symbol);
    if (!ticker) {
      return {
        legId: leg.id,
        exchangeSlug,
        side: leg.side,
        entryPrice,
        currentPrice: null,
        quantity,
        pnl: null,
        isStale: true,
      };
    }

    // برای بستن واقعی: Long با Bid می‌بندیم (Sell)، Short با Ask می‌بندیم (Buy)
    const currentPrice = leg.side === PositionSide.LONG ? ticker.bidPrice : ticker.askPrice;
    const pnl =
      leg.side === PositionSide.LONG
        ? (currentPrice - entryPrice) * quantity
        : (entryPrice - currentPrice) * quantity;

    return {
      legId: leg.id,
      exchangeSlug,
      side: leg.side,
      entryPrice,
      currentPrice,
      quantity,
      pnl,
      isStale: false,
    };
  }
}
