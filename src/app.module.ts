import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './common/config/env.validation';

import { User } from './modules/users/entities/user.entity';
import { Exchange } from './modules/exchanges/entities/exchange.entity';
import { ExchangeAccount } from './modules/exchange-accounts/entities/exchange-account.entity';
import { Balance } from './modules/balances/entities/balance.entity';
import { ArbitrageStrategy } from './modules/strategies/entities/arbitrage-strategy.entity';
import { SymbolMapping } from './modules/market-data/entities/symbol-mapping.entity';
import { ArbitrageOpportunity } from './modules/opportunities/entities/arbitrage-opportunity.entity';
import { ArbitragePosition } from './modules/positions/entities/arbitrage-position.entity';
import { PositionLeg } from './modules/positions/entities/position-leg.entity';
import { RiskConfig } from './modules/risk/entities/risk-config.entity';

import { AuthModule } from './modules/auth/auth.module';
import { ExchangesModule } from './modules/exchanges/exchanges.module';
import { ExchangeAccountsModule } from './modules/exchange-accounts/exchange-accounts.module';
import { BalancesModule } from './modules/balances/balances.module';
import { StrategiesModule } from './modules/strategies/strategies.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { PositionsModule } from './modules/positions/positions.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { RiskModule } from './modules/risk/risk.module';
import { ExchangeModule } from './core/exchange/exchange.module';
import { RedisModule } from './common/redis/redis.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),

    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      entities: [
        User,
        Exchange,
        ExchangeAccount,
        Balance,
        ArbitrageStrategy,
        SymbolMapping,
        ArbitrageOpportunity,
        ArbitragePosition,
        PositionLeg,
        RiskConfig,
      ],
      synchronize: false, // همیشه false — از migration استفاده می‌کنیم
      logging: process.env.NODE_ENV === 'development',
    }),

    // محدودیت پیش‌فرض نرخ درخواست برای کل اپ (روی login سخت‌گیرانه‌تره، جدا تعریف شده)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    RedisModule,
    HealthModule,
    AuthModule,
    ExchangesModule,
    ExchangeAccountsModule,
    BalancesModule,
    StrategiesModule,
    MarketDataModule,
    PositionsModule,
    OpportunitiesModule,
    RiskModule,
    ExchangeModule, // Registry صرافی‌ها (از فاز ۰)
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
