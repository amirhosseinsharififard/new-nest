
import { Injectable, Logger } from '@nestjs/common';
import { IExchangeAdapter } from './exchange-adapter.interface';

export interface ExchangeAccountConfig {
  accountId: string;
  exchangeId: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  publicKey?: string;
  privateKey?: string;
  restBaseUrl: string;
  wsBaseUrl: string;
}

type AdapterFactory = (
  config: ExchangeAccountConfig,
) => IExchangeAdapter;

@Injectable()
export class ExchangeRegistry {
  private readonly logger = new Logger(ExchangeRegistry.name);

  private readonly factories = new Map<string, AdapterFactory>();

  private readonly activeInstances = new Map<
    string,
    IExchangeAdapter
  >();

  register(exchangeId: string, factory: AdapterFactory): void {
    const normalizedId = exchangeId.toLowerCase();

    if (this.factories.has(normalizedId)) {
      this.logger.warn(
        `Adapter "${normalizedId}" is already registered; replacing it.`,
      );
    }

    this.factories.set(normalizedId, factory);

    this.logger.log(`Exchange adapter registered: ${normalizedId}`);
  }

  getInstance(config: ExchangeAccountConfig): IExchangeAdapter {
    const exchangeId = config.exchangeId.toLowerCase();
    const key = `${exchangeId}:${config.accountId}`;

    const existing = this.activeInstances.get(key);

    if (existing) {
      return existing;
    }

    const factory = this.factories.get(exchangeId);

    if (!factory) {
      throw new Error(
        `Exchange "${exchangeId}" is not registered. Register its adapter first.`,
      );
    }

    const instance = factory({
      ...config,
      exchangeId,
    });

    this.activeInstances.set(key, instance);

    return instance;
  }

  getRegisteredExchanges(): string[] {
    return Array.from(this.factories.keys());
  }

  async disconnectAll(): Promise<void> {
    const instances = Array.from(this.activeInstances.values());

    this.activeInstances.clear();

    const results = await Promise.allSettled(
      instances.map((instance) => instance.disconnectWebSocket()),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Error disconnecting adapter: ${String(result.reason)}`,
        );
      }
    }
  }
}
