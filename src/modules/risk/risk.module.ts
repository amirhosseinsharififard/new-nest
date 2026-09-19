import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskConfig } from './entities/risk-config.entity';
import { ArbitragePosition } from '../positions/entities/arbitrage-position.entity';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RiskConfig, ArbitragePosition])],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
