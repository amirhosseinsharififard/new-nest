import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Exchange } from '../exchanges/entities/exchange.entity';

import { SpreadCalculatorService } from './spread-calculator.service';

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketDataController {
  constructor(
    private readonly spreadCalculator: SpreadCalculatorService,

    @InjectRepository(Exchange)
    private readonly exchangeRepository: Repository<Exchange>,
  ) {}

  @Get('spread')
  async getSpread(
    @Query('symbol') symbol: string,
    @Query('exchangeA') exchangeA: string,
    @Query('exchangeB') exchangeB: string,
    @Query('feeA') feeA?: string,
    @Query('feeB') feeB?: string,
  ) {
    if (!symbol || !exchangeA || !exchangeB) {
      throw new BadRequestException(
        'symbol, exchangeA and exchangeB are required',
      );
    }

    return this.spreadCalculator.getLiveSpread(
      symbol,
      exchangeA,
      exchangeB,
      feeA ? parseFloat(feeA) : 0.04,
      feeB ? parseFloat(feeB) : 0.04,
    );
  }

  @Get('live')
  async getLiveMarket(@Query('symbol') symbol: string) {
    if (!symbol) {
      throw new BadRequestException('symbol parameter is required');
    }

    const exchanges = await this.exchangeRepository.find({
      where: {
        isActive: true,
      },
    });

    const result: Record<string, any> = {};
    console.log(exchanges)
   for (const exchange of exchanges) {
  const ticker = await this.spreadCalculator.getCachedTicker(
    exchange.slug,
    symbol,
  );
  result[exchange.slug] = ticker;
  console.log(result)

}

    return {
      symbol,
      exchanges: result,
    };
  }
}
