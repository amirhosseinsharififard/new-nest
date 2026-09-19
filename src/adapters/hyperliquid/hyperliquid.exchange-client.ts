import { Logger } from '@nestjs/common';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';

/**
 * این کلاس عمداً امضای EIP-712 رو دستی پیاده نمی‌کنه.
 *
 * چرا؟ چون فرمت Wire و نحوه Hash کردن Action های Hyperliquid (order/cancel/...)
 * پیچیده و به‌مرور در حال تغییره. اگر این امضا اشتباه پیاده بشه، دو حالت ممکنه:
 * ۱) صرافی درخواست رو رد کنه (بی‌ضرر ولی سیستم کار نمی‌کنه)
 * ۲) بدتر: امضای اشتباه با معنای متفاوت پردازش بشه و باعث ضرر مالی واقعی بشه.
 *
 * به همین دلیل، این بخش باید با SDK رسمی Hyperliquid انجام بشه، نه با
 * کد دست‌نویس. بسته‌های رسمی TypeScript مثل "@nktkas/hyperliquid" این
 * پیچیدگی (msgpack encoding + EIP-712 signing + nonce management) رو
 * به‌صورت تست‌شده مدیریت می‌کنن.
 *
 * نصب:
 *   npm install @nktkas/hyperliquid viem
 *
 * قبل از استفاده با پول واقعی:
 * ۱. حتما مستندات فعلی این پکیج رو چک کنید (ممکنه API تغییر کرده باشه)
 * ۲. حتما روی Testnet (https://api.hyperliquid-testnet.xyz) تست کنید
 * ۳. مطمئن بشید نسخه SDK با نسخه فعلی صرافی سازگاره
 */
export interface HyperliquidExchangeClient {
  placeMarketOrder(params: {
    asset: string;
    isBuy: boolean;
    size: number;
    reduceOnly: boolean;
  }): Promise<{ orderId: string | number; status: string; filledSize: number; avgPrice: number | null }>;
}

/**
 * پیاده‌سازی نمونه با استفاده از @nktkas/hyperliquid.
 * این کد باید قبل از استفاده Production با نسخه فعلی SDK تست بشه —
 * امضای متدهای زیر ممکنه در نسخه‌های جدیدتر SDK تغییر کرده باشه.
 */
export class NktkasHyperliquidExchangeClient implements HyperliquidExchangeClient {
  private readonly logger = new Logger(NktkasHyperliquidExchangeClient.name);
  private client: any = null;

  constructor(private readonly walletPrivateKey: string) {}

  private async getClient() {
    if (this.client) return this.client;

    // Dynamic import تا این وابستگی فقط وقتی واقعا از Hyperliquid استفاده میشه لود بشه
    let ExchangeClient: any, HttpTransport: any, privateKeyToAccount: any;
    try {
      ({ ExchangeClient, HttpTransport } = await import('@nktkas/hyperliquid' as string));
      ({ privateKeyToAccount } = await import('viem/accounts' as string));
    } catch {
      throw new ExchangeError(
        'hyperliquid',
        'UNKNOWN',
        'پکیج @nktkas/hyperliquid یا viem نصب نشده. اجرا کنید: npm install @nktkas/hyperliquid viem',
      );
    }

    const account = privateKeyToAccount(this.walletPrivateKey as `0x${string}`);
    this.client = new ExchangeClient({ wallet: account, transport: new HttpTransport() });
    return this.client;
  }

  async placeMarketOrder(params: {
    asset: string;
    isBuy: boolean;
    size: number;
    reduceOnly: boolean;
  }) {
    const client = await this.getClient();

    // ⚠️ نام دقیق متد و پارامترها را حتما با مستندات فعلی SDK تطبیق بدید.
    // این فراخوانی بر اساس الگوی مستندات عمومی SDK نوشته شده و ممکنه
    // در نسخه نصب‌شده شما نام/امضای متفاوتی داشته باشه.
    const result = await client.order({
      name: params.asset,
      is_buy: params.isBuy,
      sz: params.size,
      order_type: { market: {} },
      reduce_only: params.reduceOnly,
    });

    const status = result?.response?.data?.statuses?.[0];
    return {
      orderId: status?.resting?.oid ?? status?.filled?.oid ?? 'unknown',
      status: status?.filled ? 'filled' : status?.resting ? 'resting' : 'unknown',
      filledSize: status?.filled?.totalSz ? parseFloat(status.filled.totalSz) : 0,
      avgPrice: status?.filled?.avgPx ? parseFloat(status.filled.avgPx) : null,
    };
  }
}
