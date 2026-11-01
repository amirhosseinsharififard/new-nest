
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TelegramService } from './telegram.service';
import { TelegramCommandsService } from './telegram.commands.service';

import { RedisModule } from '../../common/redis/redis.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { RiskModule } from '../risk/risk.module';

import { ArbitragePosition } from '../positions/entities/arbitrage-position.entity';

import { TelegramLiveScannerService } from './telegram-live-scanner.service';
@Module({
  imports: [
    TypeOrmModule.forFeature([ArbitragePosition]),
    RedisModule,
    MarketDataModule,
    RiskModule,
  ],
  providers: [
    TelegramService,
    TelegramCommandsService,
    TelegramLiveScannerService
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
