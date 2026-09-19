import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArbitrageStrategy } from './entities/arbitrage-strategy.entity';
import { Exchange } from '../exchanges/entities/exchange.entity';
import { ExchangeAccount } from '../exchange-accounts/entities/exchange-account.entity';
import { StrategiesService } from './strategies.service';
import { StrategiesController } from './strategies.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ArbitrageStrategy, Exchange, ExchangeAccount])],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService],
})
export class StrategiesModule {}
