
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MarketPriceHistory } from
  '../market-data/entities/market-price-history.entity';

import { SpreadAnalyticsController } from
  './spread-analytics.controller';

import { SpreadAnalyticsService } from
  './services/spread-analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketPriceHistory]),
  ],
  controllers: [SpreadAnalyticsController],
  providers: [SpreadAnalyticsService],
  exports: [SpreadAnalyticsService],
})
export class SpreadAnalyticsModule {}
