import { ExchangeRegistry, ExchangeAccountConfig } from '../core/exchange/exchange-registry';
import { BinanceAdapter } from './binance/binance.adapter';
import { BybitAdapter } from './bybit/bybit.adapter';
import { OkxAdapter } from './okx/okx.adapter';
import { HyperliquidAdapter } from './hyperliquid/hyperliquid.adapter';

/**
 * تنها جایی که هنگام افزودن صرافی جدید باید ویرایش بشه.
 * خود Core Engine و ArbitrageEngine هیچ وابستگی به این فایل ندارن.
 *
 * برای افزودن صرافی بعدی (CEX یا DEX):
 * ۱. یک پوشه adapters/<نام>/ بساز که IExchangeAdapter رو پیاده کنه
 * ۲. یک خط import + register اینجا اضافه کن
 * ۳. یک رکورد در جدول exchanges (یا database/seeds/exchanges.seed.ts) اضافه کن
 */
export function registerAllAdapters(registry: ExchangeRegistry): void {
  // --- CEX (Centralized Exchanges) ---
  registry.register(
    'binance',
    (config: ExchangeAccountConfig) => new BinanceAdapter(config),
  );

  registry.register(
    'bybit',
    (config: ExchangeAccountConfig) => new BybitAdapter(config),
  );

  registry.register(
    'okx',
    (config: ExchangeAccountConfig) => new OkxAdapter(config),
  );

  // --- DEX (Decentralized Exchanges - Perpetual) ---
  registry.register(
    'hyperliquid',
    (config: ExchangeAccountConfig) => new HyperliquidAdapter(config),
  );
}
