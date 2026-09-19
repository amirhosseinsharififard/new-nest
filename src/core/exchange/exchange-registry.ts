import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IExchangeAdapter } from './exchange-adapter.interface';

type AdapterFactory = (config: ExchangeAccountConfig) => IExchangeAdapter;

export interface ExchangeAccountConfig {
  accountId: string;
  exchangeId: string;
  // apiKey/apiSecret برای اکثر CEX ها (Binance, Bybit, ...)
  apiKey?: string;
  apiSecret?: string;
  // passphrase اضافی که برخی صرافی‌ها (مثلا OKX) نیاز دارند
  passphrase?: string;
  // برای DEX هایی که با کیف‌پول (نه apiKey/apiSecret) کار می‌کنند
  publicKey?: string;
  privateKey?: string;
  restBaseUrl: string;
  wsBaseUrl: string;
}

/**
 * Registry مرکزی صرافی‌ها.
 *
 * نحوه اضافه کردن صرافی جدید:
 * 1. یک Adapter جدید در پوشه adapters/ بساز که IExchangeAdapter رو پیاده کنه
 * 2. در فایل adapters/index.ts یک خط اضافه کن: registry.register('okx', OkxAdapter)
 * 3. یک رکورد در جدول exchanges دیتابیس اضافه کن
 *
 * هیچ تغییری در ArbitrageEngine یا سایر بخش‌های Core لازم نیست.
 */
@Injectable()
export class ExchangeRegistry {
  private readonly logger = new Logger(ExchangeRegistry.name);

  // نگاشت نام صرافی -> تابع سازنده Adapter
  private factories = new Map<string, AdapterFactory>();

  // نمونه‌های فعال Adapter، به تفکیک هر Account
  // کلید: `${exchangeId}:${accountId}`
  private activeInstances = new Map<string, IExchangeAdapter>();

  /**
   * ثبت یک نوع صرافی جدید در سیستم.
   * این متد در فایل bootstrap صدا زده میشه، نه در Core Logic.
   */
  register(exchangeId: string, factory: AdapterFactory): void {
    if (this.factories.has(exchangeId)) {
      this.logger.warn(`Exchange "${exchangeId}" قبلا ثبت شده، بازنویسی می‌شود`);
    }
    this.factories.set(exchangeId, factory);
    this.logger.log(`Exchange adapter ثبت شد: ${exchangeId}`);
  }

  /**
   * ساخت یا برگرداندن نمونه Adapter برای یک اکانت خاص.
   * هر اکانت (حتی از یک صرافی) نمونه جدای خودش رو داره
   * چون API Key متفاوت و اتصال WebSocket جدا نیاز داره.
   */
  getInstance(config: ExchangeAccountConfig): IExchangeAdapter {
    const key = `${config.exchangeId}:${config.accountId}`;
    const existing = this.activeInstances.get(key);
    if (existing) return existing;

    const factory = this.factories.get(config.exchangeId);
    if (!factory) {
      throw new Error(
        `صرافی "${config.exchangeId}" ثبت نشده. ابتدا Adapter آن را register کنید.`,
      );
    }

    const instance = factory(config);
    this.activeInstances.set(key, instance);
    return instance;
  }

  getRegisteredExchanges(): string[] {
    return Array.from(this.factories.keys());
  }

  async disconnectAll(): Promise<void> {
    for (const instance of this.activeInstances.values()) {
      await instance.disconnectWebSocket();
    }
    this.activeInstances.clear();
  }
}
