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
      0, // کارمزد صرافی A؛ فعلاً صفر
      0, // کارمزد صرافی B؛ فعلاً صفر
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



@Get('live/all')
async getAllLiveMarket() {
  const exchanges = await this.exchangeRepository.find({
    where: {
      isActive: true,
    },
  });

  return this.spreadCalculator.getAllLiveMarketData(
    exchanges.map((exchange) => exchange.slug),
  );
}



}
