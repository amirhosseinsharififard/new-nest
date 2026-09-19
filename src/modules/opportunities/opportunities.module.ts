import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArbitrageOpportunity } from './entities/arbitrage-opportunity.entity';
import { OpportunityDetectorService } from './opportunity-detector.service';
import { OpportunitiesController } from './opportunities.controller';
import { StrategiesModule } from '../strategies/strategies.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { PositionsModule } from '../positions/positions.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ArbitrageOpportunity]),
    StrategiesModule,
    MarketDataModule,
    PositionsModule,
    RiskModule,
  ],
  controllers: [OpportunitiesController],
  providers: [OpportunityDetectorService],
  exports: [OpportunityDetectorService],
})
export class OpportunitiesModule {}
