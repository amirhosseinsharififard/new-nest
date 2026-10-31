
import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';

import { SpreadAnalyticsService } from
  './services/spread-analytics.service';

@Controller('spread-analytics')
export class SpreadAnalyticsController {
  constructor(
    private readonly spreadAnalyticsService: SpreadAnalyticsService,
  ) {}

  @Get()
  async analyze(
    @Query('symbol') symbol: string,
    @Query('maxQuoteAgeMs') maxQuoteAgeMs?: string,
  ) {
    const maxAge = maxQuoteAgeMs
      ? Number(maxQuoteAgeMs)
      : 10_000;

    if (!Number.isInteger(maxAge)) {
      throw new BadRequestException(
        'maxQuoteAgeMs must be an integer',
      );
    }

    return this.spreadAnalyticsService.analyze(
      symbol,
      maxAge,
    );
  }
}
