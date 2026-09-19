import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArbitragePosition } from './entities/arbitrage-position.entity';
import { PositionLeg } from './entities/position-leg.entity';
import { PositionExecutorService } from './position-executor.service';
import { ReconciliationService } from './reconciliation.service';
import { PositionPnlService } from './position-pnl.service';
import { PositionsController } from './positions.controller';
import { ExchangeAccountsModule } from '../exchange-accounts/exchange-accounts.module';
import { ExchangeModule } from '../../core/exchange/exchange.module';
import { RedisModule } from '../../common/redis/redis.module';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ArbitragePosition, PositionLeg]),
    ExchangeAccountsModule,
    ExchangeModule,
    RedisModule,
    MarketDataModule,
  ],
  controllers: [PositionsController],
  providers: [PositionExecutorService, ReconciliationService, PositionPnlService],
  exports: [PositionExecutorService, ReconciliationService],
})
export class PositionsModule {}
