import { DataSource } from 'typeorm';
import { Exchange, ExchangeMarketType } from '../../modules/exchanges/entities/exchange.entity';
import { User } from '../../modules/users/entities/user.entity';
import { ExchangeAccount } from '../../modules/exchange-accounts/entities/exchange-account.entity';
import { Balance } from '../../modules/balances/entities/balance.entity';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * داده اولیه صرافی‌ها. برای اضافه کردن صرافی جدید به سیستم،
 * کافیه یک آبجکت دیگه به این آرایه اضافه کنید — دقیقا همون فلسفه
 * "افزودن با داده، نه با کد" که در معماری Registry هم رعایت شده.
 *
 * نکته: مقدار slug باید دقیقا با کلید ثبت‌شده در adapters/index.ts یکی باشه.
 */
const EXCHANGES_SEED = [
  {
    slug: 'binance',
    displayName: 'Binance',
    marketType: ExchangeMarketType.FUTURES,
    restBaseUrl: 'https://fapi.binance.com',
    wsBaseUrl: 'wss://fstream.binance.com',
  },
  {
    slug: 'bybit',
    displayName: 'Bybit',
    marketType: ExchangeMarketType.FUTURES,
    restBaseUrl: 'https://api.bybit.com',
    wsBaseUrl: 'wss://stream.bybit.com',
  },
  {
    slug: 'okx',
    displayName: 'OKX',
    marketType: ExchangeMarketType.FUTURES,
    restBaseUrl: 'https://www.okx.com',
    wsBaseUrl: 'wss://ws.okx.com:8443/ws/v5/public',
  },
  {
    slug: 'hyperliquid',
    displayName: 'Hyperliquid (DEX)',
    marketType: ExchangeMarketType.FUTURES,
    restBaseUrl: 'https://api.hyperliquid.xyz',
    wsBaseUrl: 'wss://api.hyperliquid.xyz/ws',
  },
  // برای افزودن صرافی بعدی، فقط یک آیتم دیگه اینجا اضافه کنید:
  // {
  //   slug: 'dydx',
  //   displayName: 'dYdX (DEX)',
  //   marketType: ExchangeMarketType.FUTURES,
  //   restBaseUrl: 'https://indexer.dydx.trade',
  //   wsBaseUrl: 'wss://indexer.dydx.trade/v4/ws',
  // },
];

async function runSeed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [Exchange, User, ExchangeAccount, Balance],
  });

  await dataSource.initialize();
  const repo = dataSource.getRepository(Exchange);

  for (const seed of EXCHANGES_SEED) {
    const existing = await repo.findOne({ where: { slug: seed.slug } });
    if (existing) {
      console.log(`صرافی "${seed.slug}" از قبل وجود دارد، رد شد.`);
      continue;
    }
    const created = repo.create(seed);
    await repo.save(created);
    console.log(`صرافی "${seed.slug}" اضافه شد.`);
  }

  await dataSource.destroy();
  console.log('Seed کامل شد.');
}

runSeed().catch((err) => {
  console.error('خطا در اجرای Seed:', err);
  process.exit(1);
});
