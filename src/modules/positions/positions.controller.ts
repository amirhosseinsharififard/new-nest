import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ArbitragePosition } from './entities/arbitrage-position.entity';
import { PositionExecutorService } from './position-executor.service';
import { PositionPnlService } from './position-pnl.service';

@UseGuards(JwtAuthGuard)
@Controller('positions')
export class PositionsController {
  constructor(
    @InjectRepository(ArbitragePosition)
    private readonly repo: Repository<ArbitragePosition>,
    private readonly positionExecutor: PositionExecutorService,
    private readonly positionPnlService: PositionPnlService,
  ) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.repo.find({
      where: status ? { status: status as any } : {},
      order: { createdAt: 'DESC' },
      relations: ['strategy', 'legs'],
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.repo.findOne({
      where: { id },
      relations: ['strategy', 'legs', 'legs.exchangeAccount'],
    });
  }

  /** سود/زیان لحظه‌ای (تخمینی، بر اساس آخرین قیمت Cache شده در Redis) */
  @Get(':id/pnl')
  getLivePnl(@Param('id') id: string) {
    return this.positionPnlService.calculateLivePnl(id);
  }

  /** بستن هر دو Leg یک پوزیشن با یک فراخوانی */
  @Post(':id/close-pair')
  closePair(@Param('id') id: string) {
    return this.positionExecutor.closePair(id);
  }

  /** بستن فقط یک Leg مشخص از یک پوزیشن */
  @Post(':id/close-single/:legId')
  closeSingleLeg(@Param('id') id: string, @Param('legId') legId: string) {
    return this.positionExecutor.closeSingleLeg(id, legId);
  }
}
