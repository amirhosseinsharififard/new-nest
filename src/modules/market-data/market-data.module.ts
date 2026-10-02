import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolMapping } from './entities/symbol-mapping.entity';
import { Exchange } from '../exchanges/entities/exchange.entity';
import { SpreadCalculatorService } from './spread-calculator.service';
import { PriceAggregatorService } from './price-aggregator.service';
import { StrategyPriceWatcherService } from './strategy-price-watcher.service';
import { MarketDataController } from './market-data.controller';
import { RedisModule } from '../../common/redis/redis.module';
import { ExchangeModule } from '../../core/exchange/exchange.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeAccountsModule } from '../exchange-accounts/exchange-accounts.module';
import { MarketScannerService } from './market-scanner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SymbolMapping, Exchange]),
    RedisModule,
    ExchangeModule,
    StrategiesModule,
    ExchangeAccountsModule,
  ],
  controllers: [MarketDataController],
  providers: [SpreadCalculatorService, PriceAggregatorService, StrategyPriceWatcherService, MarketScannerService],
  exports: [SpreadCalculatorService, PriceAggregatorService, MarketScannerService],
})
export class MarketDataModule {}
