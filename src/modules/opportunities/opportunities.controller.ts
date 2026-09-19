import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ArbitrageOpportunity } from './entities/arbitrage-opportunity.entity';

@UseGuards(JwtAuthGuard)
@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    @InjectRepository(ArbitrageOpportunity)
    private readonly repo: Repository<ArbitrageOpportunity>,
  ) {}

  @Get()
  findAll(@Query('strategyId') strategyId?: string, @Query('limit') limit = '50') {
    return this.repo.find({
      where: strategyId ? { strategy: { id: strategyId } } : {},
      order: { createdAt: 'DESC' },
      take: Math.min(parseInt(limit, 10) || 50, 200),
      relations: ['strategy'],
    });
  }
}
