# ساختار پروژه — Arbitrage Bot

این فایل توضیح می‌دهد هر پوشه/فایل چه نقشی دارد و قوانین کلی معماری پروژه چیست.
هدف: هر Developer (یا خود شما بعد از چند هفته) بتواند سریع بفهمد کد جدید را کجا باید اضافه کند.

---

## فلسفه اصلی معماری

> **صرافی جدید = داده جدید، نه کد جدید در Core.**

هیچ فایلی داخل `core/` نباید بداند که "Binance" یا "Bybit" چیست. Core فقط با
Interface کار می‌کند (`IExchangeAdapter`). جزئیات هر صرافی در `adapters/` ایزوله شده.

---

## نمای کلی پوشه‌ها

```
arbitrage-bot/
├── src/
│   ├── main.ts                  ← نقطه ورود اپلیکیشن (bootstrap)
│   ├── app.module.ts            ← ریشه اصلی، همه ماژول‌ها اینجا import می‌شوند
│   │
│   ├── core/                    ← منطق مرکزی، صرافی‌agnostic (به هیچ صرافی خاصی وابسته نیست)
│   │   └── exchange/
│   │       ├── exchange.types.ts               مدل‌های داده مشترک بین همه صرافی‌ها
│   │       ├── exchange-adapter.interface.ts   قرارداد IExchangeAdapter + ExchangeError
│   │       ├── exchange-registry.ts            Registry مرکزی (Factory Pattern)
│   │       └── exchange.module.ts              اتصال Registry به NestJS DI
│   │
│   ├── adapters/                ← پیاده‌سازی مخصوص هر صرافی
│   │   ├── index.ts                            تنها فایلی که برای افزودن صرافی جدید ویرایش می‌شود
│   │   ├── index.spec.ts                       تست یکپارچگی: اثبات می‌کند صرافی جدید بدون تغییر Core کار می‌کند
│   │   ├── common/
│   │   │   ├── reconnecting-ws-client.ts       WebSocket مشترک با Auto-reconnect (همه Adapterها استفاده می‌کنند)
│   │   │   └── rate-limiter.ts                 Rate Limiter مشترک (Sliding Window)
│   │   ├── binance/                            CEX — REST (HMAC) + WebSocket کامل
│   │   │   ├── binance.adapter.ts
│   │   │   ├── binance.rest.ts
│   │   │   ├── binance.ws.ts
│   │   │   ├── binance.mapper.ts
│   │   │   └── binance.mapper.spec.ts
│   │   ├── bybit/                              CEX — REST (HMAC v5) + WebSocket کامل
│   │   │   └── (همان ساختار binance)
│   │   ├── okx/                                CEX — REST (HMAC+Passphrase) + WebSocket کامل
│   │   │   └── (همان ساختار binance)
│   │   └── hyperliquid/                        DEX Perpetual — Info API مستقیم + امضای تراکنش با SDK رسمی
│   │       ├── hyperliquid.adapter.ts
│   │       ├── hyperliquid.rest.ts             فقط Info Endpoint های عمومی (بدون امضا)
│   │       ├── hyperliquid.exchange-client.ts  لایه امضا با SDK رسمی (نه دستی!)
│   │       ├── hyperliquid.ws.ts
│   │       └── hyperliquid.mapper.ts
│   │
│   ├── modules/                 ← فیچرهای اصلی برنامه (هر کدام یک NestJS Module کامل)
│   │   ├── auth/                                ثبت‌نام، ورود، JWT، 2FA
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.service.spec.ts
│   │   │   ├── dto/auth.dto.ts
│   │   │   ├── guards/jwt-auth.guard.ts
│   │   │   └── strategies/jwt.strategy.ts
│   │   │
│   │   ├── users/                               Entity کاربر
│   │   │   └── entities/user.entity.ts
│   │   │
│   │   ├── exchanges/                           متادیتای صرافی‌ها (نام، URL، نوع بازار)
│   │   │   ├── exchanges.module.ts
│   │   │   └── entities/exchange.entity.ts
│   │   │
│   │   ├── exchange-accounts/                   اکانت‌های کاربر در هر صرافی (API Key و ...)
│   │   │   ├── exchange-accounts.module.ts
│   │   │   ├── exchange-accounts.controller.ts
│   │   │   ├── exchange-accounts.service.ts
│   │   │   ├── exchange-accounts.service.spec.ts
│   │   │   ├── dto/create-exchange-account.dto.ts
│   │   │   └── entities/exchange-account.entity.ts
│   │   │
│   │   ├── balances/                            موجودی هر اکانت + Sync خودکار زنده
│   │   │   ├── balances.module.ts
│   │   │   ├── balance-sync.service.ts           ⭐ حلقه اتصال: هر ۶۰ ثانیه موجودی واقعی صرافی را در دیتابیس Upsert می‌کند (+.spec.ts)
│   │   │   └── entities/balance.entity.ts
│   │   │
│   │   ├── strategies/                          تنظیمات استراتژی به تفکیک هر Symbol/صرافی (شامل autoExecute)
│   │   │   ├── strategies.module.ts / .controller.ts / .service.ts (+.spec.ts)
│   │   │   ├── dto/create-strategy.dto.ts / update-strategy.dto.ts
│   │   │   └── entities/arbitrage-strategy.entity.ts
│   │   │
│   │   ├── market-data/                          محاسبه Spread زنده و Cache قیمت در Redis
│   │   │   ├── market-data.module.ts / .controller.ts
│   │   │   ├── spread-calculation.util.ts        تابع خالص محاسبه Spread (+.spec.ts) — بدون هیچ وابستگی خارجی
│   │   │   ├── spread-calculator.service.ts      Cache و محاسبه زنده با Redis (+.spec.ts)
│   │   │   ├── price-aggregator.service.ts       گوش دادن به WS چند صرافی هم‌زمان (+.spec.ts)
│   │   │   ├── strategy-price-watcher.service.ts ⭐ حلقه اتصال: هر ۳۰ ثانیه استراتژی‌های فعال را به WebSocket وصل می‌کند (+.spec.ts)
│   │   │   └── entities/symbol-mapping.entity.ts
│   │   │
│   │   ├── opportunities/                        تشخیص فرصت — Event-driven (بلادرنگ) + Interval (Fallback)
│   │   │   ├── opportunities.module.ts / .controller.ts
│   │   │   ├── opportunity-detector.service.ts   با هر Tick قیمت فوراً چک می‌کند؛ هر ۵ ثانیه هم به‌عنوان Fallback (+.spec.ts)
│   │   │   └── entities/arbitrage-opportunity.entity.ts
│   │   │
│   │   ├── positions/                            اجرای واقعی + بستن دستی + Reconciliation + PnL لحظه‌ای
│   │   │   ├── positions.module.ts / .controller.ts
│   │   │   ├── position-executor.service.ts      Lock + اجرای موازی + Hedge-Close + closePair/closeSingleLeg (+.spec.ts)
│   │   │   ├── reconciliation.service.ts          چک دوره‌ای (هر ۶۰ ثانیه) وضعیت واقعی صرافی در برابر دیتابیس (+.spec.ts)
│   │   │   ├── position-pnl.service.ts            ⭐ سود/زیان لحظه‌ای تخمینی از قیمت Cache شده در Redis (+.spec.ts)
│   │   │   └── entities/arbitrage-position.entity.ts / position-leg.entity.ts
│   │   │
│   │   ├── risk/                                 مدیریت ریسک - سقف پوزیشن هم‌زمان و Kill Switch
│   │   │   ├── risk.module.ts / .controller.ts
│   │   │   ├── risk.service.ts                    Kill Switch خودکار (شکست پشت‌سرهم) و دستی (+.spec.ts)
│   │   │   └── entities/risk-config.entity.ts
│   │   │
│   │   └── health/                              health-check کل سیستم
│   │       └── health.module.ts
│   │
│   ├── common/                   ← ابزارهای مشترک، مستقل از فیچر خاص
│   │   ├── config/
│   │   │   ├── env.validation.ts               اعتبارسنجی .env هنگام boot
│   │   │   ├── env.validation.spec.ts
│   │   │   └── typeorm.config.ts               تنظیمات دیتاسورس (برای CLI migration)
│   │   ├── crypto/
│   │   │   ├── encryption.service.ts           رمزنگاری AES-256-GCM برای Secretها
│   │   │   └── encryption.service.spec.ts
│   │   └── redis/
│   │       ├── redis.module.ts                 اتصال ioredis (Global Module)
│   │       ├── redis.service.ts                لایه انتزاعی روی Redis (شامل Lock)
│   │       └── redis.service.spec.ts
│   │
│   ├── database/
│   │   └── seeds/
│   │       └── exchanges.seed.ts               داده اولیه جدول exchanges
│   │
│   └── migrations/               ← تاریخچه تغییرات اسکیمای دیتابیس (هرگز synchronize:true نمی‌کنیم)
│       ├── 1700000000000-InitialSchema.ts
│       └── 1700000100000-AddFlexibleCredentialColumns.ts
│
├── test/
│   └── jest.setup.ts             import اولیه reflect-metadata برای تست‌ها
│
├── docker-compose.yml            Postgres + Redis برای محیط توسعه
├── .env.example                  نمونه متغیرهای محیطی
├── package.json
├── tsconfig.json
└── nest-cli.json
```

---

## چه چیزی به کجا مربوط است؟ (راهنمای تصمیم‌گیری سریع)

| اگر می‌خواهید... | برو به... |
|---|---|
| یک صرافی جدید اضافه کنید | `adapters/<نام-صرافی>/` بساز + یک خط در `adapters/index.ts` |
| یک مدل داده مشترک جدید تعریف کنید (مثلا نوع جدید Order) | `core/exchange/exchange.types.ts` |
| رفتار مشترکی که همه صرافی‌ها باید پیاده کنند اضافه کنید | `core/exchange/exchange-adapter.interface.ts` |
| یک فیچر کاملاً جدید بسازید (مثلا `strategies` در فاز ۴) | پوشه جدید در `modules/strategies/` با همان الگوی auth/exchange-accounts |
| یک جدول جدید دیتابیس اضافه کنید | Entity در `modules/<فیچر>/entities/` + یک Migration جدید در `migrations/` |
| یک ابزار عمومی (نه مخصوص یک فیچر) اضافه کنید | `common/<دسته>/` |
| داده اولیه (Seed) برای جدولی نیاز دارید | `database/seeds/` |

---

## قوانین ثابت پروژه

1. **هرگز `synchronize: true` در TypeORM استفاده نمی‌کنیم.** هر تغییر اسکیما باید یک فایل Migration جدا داشته باشد (Migration های قبلی هرگز ویرایش نمی‌شوند).
2. **هیچ Secret/API Key هیچ‌وقت plain-text ذخیره نمی‌شود.** همیشه از `EncryptionService` عبور می‌کند.
3. **هیچ Response ای نباید مقدار رمزنگاری‌شده یا خام credential را برگرداند.** هر Service باید یک متد `toSafeResponse` مشابه داشته باشد.
4. **Core هیچ‌وقت نام یک صرافی خاص را در کد نمی‌بیند.** فقط از طریق `ExchangeRegistry` و `IExchangeAdapter` کار می‌کند.
5. **هر Service منطقی باید یک فایل `.spec.ts` کنار خودش داشته باشد.**
6. هر ماژول جدید باید ساختار مشابه بقیه را دنبال کند: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`.
7. **برای DEXها هرگز امضای تراکنش (EIP-712 یا مشابه) دستی پیاده‌سازی نمی‌شود.** همیشه از SDK رسمی صرافی استفاده کنید (مثال: `hyperliquid.exchange-client.ts`). امضای دستی اشتباه می‌تواند مستقیماً باعث از دست رفتن سرمایه واقعی شود.
8. **هیچ پوزیشنی بدون Redis Lock باز نمی‌شود.** `PositionExecutorService` قبل از هر اجرا قفل استراتژی را می‌گیرد؛ این جلوی اجرای تکراری همزمان (مثلا از دو تیک قیمت پشت‌سرهم) را می‌گیرد.
9. **وضعیت UNKNOWN (Timeout) هرگز به‌عنوان "fail" یا "success" فرض نمی‌شود.** بستن خودکار یک پوزیشنی که وضعیت واقعی‌اش نامشخص است، خودش می‌تواند ریسک جدید بسازد؛ این حالت باید `NEEDS_MANUAL_REVIEW` علامت بخورد.
10. **هر Service ای که "قیمت را نگه می‌دارد" یا "چیزی می‌سازد" باید یک Consumer واقعی داشته باشد که آن را صدا می‌زند.** `PriceAggregatorService.watchSymbol` و `BalanceSyncService` نمونه‌هایی بودند که در ابتدا فقط تعریف شدند ولی هیچ‌جا Wire نشده بودند — این نوع "حلقه‌های نیمه‌کاره" باید همیشه هنگام مرور کد جست‌وجو بشن (به دنبال Serviceهایی که تعریف شدن ولی جایی Inject/Call نشدن).
11. **مسیرهای زمان‌بندی‌شده (Interval) همیشه باید یک نسخه Event-driven هم داشته باشن اگر Latency مهمه.** `OpportunityDetectorService` علاوه بر Interval هر ۵ ثانیه، به `TICKER_UPDATED_EVENT` هم گوش می‌ده تا با هر قیمت جدید فوراً چک انجام بشه؛ Interval فقط Fallback ایمنیه، نه مسیر اصلی.

---

## نقشه فازهای آینده (کجا اضافه می‌شوند)

| فاز | ماژول جدید | مسیر پیشنهادی |
|---|---|---|
| ۲ | تکمیل واقعی Adapterها (REST+WS) | `adapters/binance/`, `adapters/bybit/` |
| ۴ | Strategy و Spread Calculation | `modules/strategies/`, `modules/market-data/` |
| ۵ | Opportunity Detector | `modules/opportunities/` |
| ۶ | Position Execution (مهم‌ترین بخش) | `modules/positions/` + `core/arbitrage-engine/` |
| ۷ | Risk Management | `modules/risk/` |
| ۸ | Dashboard / Audit | `modules/dashboard/`, `modules/audit-log/` |
