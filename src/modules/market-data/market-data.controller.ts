import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpreadCalculatorService } from './spread-calculator.service';

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketDataController {
  constructor(private readonly spreadCalculator: SpreadCalculatorService) {}

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
        'پارامترهای symbol، exchangeA و exchangeB الزامی هستند',
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
}
