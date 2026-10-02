import { BadRequestException, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpreadCalculatorService } from './spread-calculator.service';
import { MarketScannerService } from './market-scanner.service';

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketDataController {
  constructor(private readonly spreadCalculator: SpreadCalculatorService, private readonly scanner: MarketScannerService) {}

  @Post('scanner/start') async startScanner() { await this.scanner.start(); return this.scanner.status(); }
  @Post('scanner/stop') stopScanner() { this.scanner.stop(); return this.scanner.status(); }
  @Get('scanner/status') scannerStatus() { return this.scanner.status(); }
  @Get('scanner/symbols') scannerSymbols() { return this.scanner.symbols(); }
  @Get('scanner/tickers') scannerTickers(@Query('exchange') exchange?: string, @Query('symbol') symbol?: string, @Query('limit') limit?: string) {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1_000)) throw new BadRequestException('پارامتر limit باید عدد صحیح بین ۱ و ۱۰۰۰ باشد');
    return this.scanner.getTickers({ exchange, symbol, limit: parsedLimit });
  }
  @Get('scanner/opportunities') scannerOpportunities(@Query('minSpreadPercent') minimum?: string, @Query('limit') limit?: string, @Query('exchanges') exchanges?: string, @Query('symbol') symbol?: string) {
    const parsedLimit = limit === undefined ? undefined : Number(limit); const parsedMinimum = minimum === undefined ? undefined : Number(minimum);
    if ((parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)) || (parsedMinimum !== undefined && !Number.isFinite(parsedMinimum))) throw new BadRequestException('پارامترهای scanner نامعتبر هستند');
    return this.scanner.getOpportunities({ minSpreadPercent: parsedMinimum, limit: parsedLimit, exchanges: exchanges?.split(',').map((x) => x.trim()).filter(Boolean), symbol });
  }

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
