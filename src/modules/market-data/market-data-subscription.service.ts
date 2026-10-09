import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Exchange } from '../exchanges/entities/exchange.entity';

import {
  ExchangeAccountConfig,
  ExchangeRegistry,
} from '../../core/exchange/exchange-registry';

import { PriceAggregatorService } from './price-aggregator.service';

@Injectable()
export class MarketDataSubscriptionService
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(
    MarketDataSubscriptionService.name,
  );

  private readonly symbols = ['BTC-USDT'];

  constructor(
    @InjectRepository(Exchange)
    private readonly exchangeRepository: Repository<Exchange>,

    private readonly exchangeRegistry: ExchangeRegistry,

    private readonly priceAggregatorService: PriceAggregatorService,
  ) {
    this.logger.log('MarketDataSubscriptionService constructed');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(
      '========== MARKET DATA BOOTSTRAP ==========',
    );

    await this.startSubscriptions();
  }

  async startSubscriptions(): Promise<void> {
    const exchanges = await this.exchangeRepository.find({
      where: {
        isActive: true,
      },
    });

    this.logger.log(
      `Active exchanges: ${exchanges.map((e) => e.slug).join(', ')}`,
    );

    this.logger.log(
      `Registered adapters: ${this.exchangeRegistry
        .getRegisteredExchanges()
        .join(', ')}`,
    );

    for (const exchange of exchanges) {
      for (const symbol of this.symbols) {
        try {
          const config: ExchangeAccountConfig = {
            accountId: `public-market-data:${exchange.slug}`,
            exchangeId: exchange.slug,
            restBaseUrl: exchange.restBaseUrl,
            wsBaseUrl: exchange.wsBaseUrl,
          };

          this.logger.log(
            `SUBSCRIBE START -> ${exchange.slug} -> ${symbol}`,
          );

          this.priceAggregatorService.watchSymbol(
            config,
            symbol,
          );

          this.logger.log(
            `SUBSCRIBE DONE -> ${exchange.slug} -> ${symbol}`,
          );
        } catch (error) {
          this.logger.error(
            `SUBSCRIBE FAILED -> ${exchange.slug} -> ${symbol} -> ${
              error instanceof Error
                ? error.message
                : String(error)
            }`,
          );
        }
      }
    }
  }
}
