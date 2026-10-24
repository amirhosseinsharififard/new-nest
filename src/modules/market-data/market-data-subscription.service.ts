
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

  constructor(
    @InjectRepository(Exchange)
    private readonly exchangeRepository: Repository<Exchange>,

    private readonly exchangeRegistry: ExchangeRegistry,

    private readonly priceAggregatorService: PriceAggregatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('========== MARKET DATA BOOTSTRAP ==========');
    await this.startSubscriptions();
  }

  async startSubscriptions(): Promise<void> {
    const exchanges = await this.exchangeRepository.find({
      where: { isActive: true },
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
      const config: ExchangeAccountConfig = {
        accountId: `public-market-data:${exchange.slug}`,
        exchangeId: exchange.slug,
        restBaseUrl: exchange.restBaseUrl,
        wsBaseUrl: exchange.wsBaseUrl,
      };

      try {
        this.logger.log(
          `Discovering market symbols: ${exchange.slug}`,
        );

        const adapter = this.exchangeRegistry.getInstance(config);

        if (!adapter.getMarketSymbols) {
          this.logger.warn(
            `${exchange.slug}: getMarketSymbols() is not implemented`,
          );
          continue;
        }

        const symbols = await adapter.getMarketSymbols();

        if (!symbols.length) {
          this.logger.warn(
            `${exchange.slug}: no market symbols discovered`,
          );
          continue;
        }

        this.logger.log(
          `${exchange.slug}: discovered ${symbols.length} symbols`,
        );

        this.priceAggregatorService.watchSymbols(
          config,
          symbols,
        );

        this.logger.log(
          `${exchange.slug}: subscription requested for ${symbols.length} symbols`,
        );
      } catch (error) {
        this.logger.error(
          `${exchange.slug}: market subscription failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }
  }
}
