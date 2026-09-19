# مرجع API — Arbitrage Bot (فاز ۰ تا فاز ۶)

Base URL (dev): `http://localhost:3000`

اگر Endpoint نیاز به احراز هویت دارد، باید هدر زیر ارسال شود:
```
Authorization: Bearer <accessToken>
```

---

## Auth

### `POST /auth/register`
ثبت‌نام کاربر جدید. نیاز به JWT ندارد.

**Body:**
| فیلد | نوع | الزامی | قوانین |
|---|---|---|---|
| `username` | string | ✅ | حداقل ۴ کاراکتر |
| `password` | string | ✅ | حداقل ۱۰ کاراکتر، ترکیب حرف و عدد |

```json
{
  "username": "ali",
  "password": "MyPass123456"
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "username": "ali"
}
```

**خطاها:** `409 Conflict` اگر username تکراری باشد.

---

### `POST /auth/login`
ورود. Rate limit: حداکثر ۵ درخواست در دقیقه. نیاز به JWT ندارد.

**Body:**
| فیلد | نوع | الزامی | توضیح |
|---|---|---|---|
| `username` | string | ✅ | |
| `password` | string | ✅ | |
| `otpCode` | string | ⚠️ شرطی | فقط اگر 2FA کاربر فعال باشد الزامی می‌شود |

```json
{
  "username": "ali",
  "password": "MyPass123456",
  "otpCode": "123456"
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi..."
}
```
`accessToken` عمر کوتاه دارد (پیش‌فرض ۱۵ دقیقه)، `refreshToken` عمر بلند (پیش‌فرض ۷ روز).

**خطاها:** `401 Unauthorized` برای پسورد/یوزرنیم اشتباه (پیام یکسان برای هر دو حالت، برای جلوگیری از Username Enumeration)، یا کد 2FA نامعتبر/جاافتاده.

---

### `POST /auth/refresh-token`
گرفتن جفت توکن جدید با Refresh Token. نیاز به JWT ندارد (خود Refresh Token جای آن را می‌گیرد).

**Body:**
```json
{ "refreshToken": "eyJhbGciOi..." }
```

**Response `200`:** همان فرمت `login`.

**خطاها:** `401 Unauthorized` اگر توکن منقضی/نامعتبر باشد یا کاربر دیگر وجود نداشته باشد.

---

### `POST /auth/2fa/generate`
تولید Secret و لینک QR برای فعال‌سازی 2FA. نیاز به JWT دارد.

**Body:** ندارد.

**Response `201`:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpAuthUrl": "otpauth://totp/ArbitrageBot:ali?secret=JBSWY3DPEHPK3PXP&issuer=ArbitrageBot"
}
```
`otpAuthUrl` را می‌توان به QR Code تبدیل کرد و در Google Authenticator/Authy اسکن کرد.

---

### `POST /auth/2fa/enable`
تایید کد OTP اولیه و فعال کردن قطعی 2FA برای کاربر. نیاز به JWT دارد.

**Body:**
```json
{ "otpCode": "123456" }
```

**Response `201`:** بدون Body (فقط status 201).

**خطاها:** `401 Unauthorized` اگر کد اشتباه باشد یا `generate2fa` قبلاً صدا زده نشده باشد.

---

## Exchanges

### `GET /exchanges`
لیست صرافی‌های فعال (متادیتا، نه اکانت کاربر). نیاز به JWT دارد.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "slug": "binance",
    "displayName": "Binance",
    "marketType": "futures",
    "restBaseUrl": "https://fapi.binance.com",
    "wsBaseUrl": "wss://fstream.binance.com",
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

---

## Exchange Accounts

هر رکورد یعنی یک اکانت مشخص کاربر در یک صرافی مشخص (کاربر می‌تواند چند اکانت روی یک صرافی داشته باشد).

### `POST /exchange-accounts`
افزودن اکانت جدید. نیاز به JWT دارد.

چون صرافی‌های مختلف فرمت احراز هویت متفاوتی دارند، باید **حداقل یکی** از این دو ترکیب را ارسال کنید:
- `apiKey` + `apiSecret` (با `passphrase` اختیاری، برای صرافی‌هایی مثل OKX)
- `publicKey` + `privateKey`

**Body:**
| فیلد | نوع | الزامی | توضیح |
|---|---|---|---|
| `exchangeId` | uuid | ✅ | شناسه صرافی (از `GET /exchanges`) |
| `label` | string | ✅ | برچسب دلخواه، مثلا `"main"` یا `"hedge-2"` |
| `apiKey` | string | ⚠️ شرطی | برای اکثر صرافی‌ها |
| `apiSecret` | string | ⚠️ شرطی | برای اکثر صرافی‌ها |
| `passphrase` | string | اختیاری | فقط صرافی‌هایی مثل OKX |
| `publicKey` | string | ⚠️ شرطی | جایگزین apiKey/apiSecret |
| `privateKey` | string | ⚠️ شرطی | جایگزین apiKey/apiSecret |
| `permissionLevel` | enum | اختیاری | `read_only` \| `trade` \| `withdraw` (پیش‌فرض: `trade`) |

مثال (Binance):
```json
{
  "exchangeId": "uuid-of-binance",
  "label": "main",
  "apiKey": "abc123",
  "apiSecret": "xyz789"
}
```

مثال (OKX):
```json
{
  "exchangeId": "uuid-of-okx",
  "label": "main",
  "apiKey": "abc123",
  "apiSecret": "xyz789",
  "passphrase": "my-passphrase"
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "label": "main",
  "exchange": { "id": "uuid", "slug": "binance" },
  "credentialTypes": {
    "hasApiKeyPair": true,
    "hasPassphrase": false,
    "hasKeyPair": false
  },
  "permissionLevel": "trade",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```
> توجه: مقدار خام یا رمزنگاری‌شده `apiKey`/`apiSecret`/... **هرگز** در پاسخ برنمی‌گردد؛ فقط `credentialTypes` نشان می‌دهد کدام نوع credential ثبت شده.

**خطاها:**
- `404 Not Found` اگر `exchangeId` نامعتبر باشد
- `400 Bad Request` اگر هیچ ترکیب معتبری از credential ارسال نشده باشد (مثلا فقط `apiKey` بدون `apiSecret`)

---

### `GET /exchange-accounts`
لیست اکانت‌های صرافی متعلق به کاربر لاگین‌شده. نیاز به JWT دارد.

**Response `200`:** آرایه‌ای از همان فرمت پاسخ `POST /exchange-accounts`.

---

### `DELETE /exchange-accounts/:id`
حذف یک اکانت. نیاز به JWT دارد.

**Response `200`:** بدون Body.

**خطاها:**
- `404 Not Found` اگر اکانت وجود نداشته باشد
- `403 Forbidden` اگر اکانت متعلق به کاربر دیگری باشد

---

## Balances

### `GET /exchange-accounts/:accountId/balance`
موجودی زنده (`BalanceSyncService` هر ۶۰ ثانیه از صرافی می‌گیرد و در دیتابیس Upsert می‌کند). نیاز به JWT دارد.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "asset": "USDT",
    "free": "1000.50000000",
    "locked": "0.00000000",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

---

## Health

### `GET /health`
وضعیت سلامت اتصال به Postgres و Redis. نیاز به JWT ندارد (برای مانیتورینگ خارجی مثل Uptime Robot).

**Response `200`:**
```json
{
  "status": "ok",
  "database": "up",
  "redis": "up",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```
اگر یکی از دو سرویس در دسترس نباشد، `status` برابر `"degraded"` و مقدار مربوطه `"down"` می‌شود (کد پاسخ همچنان `200` است — تفسیر وضعیت بر عهده کلاینت/مانیتورینگ است).

---

## وضعیت Adapterهای صرافی (فاز ۲)

هیچ Endpoint جدیدی در این فاز اضافه نشده — Adapterها در پشت‌صحنه (`adapters/`) پیاده‌سازی شدن و در فاز ۶ (باز/بستن پوزیشن) از طریق API استفاده می‌شن.

| صرافی | نوع | REST | WebSocket | نکته |
|---|---|:---:|:---:|---|
| Binance | CEX (Futures) | ✅ کامل | ✅ کامل | Testnet: `testnet.binancefuture.com` |
| Bybit | CEX (Futures) | ✅ کامل | ✅ کامل | Testnet: `api-testnet.bybit.com` |
| OKX | CEX (Futures) | ✅ کامل | ✅ کامل | نیاز به `passphrase` اضافه دارد؛ Demo Trading با هدر `x-simulated-trading` |
| Hyperliquid | DEX (Perpetual) | ✅ Info کامل | ✅ کامل | باز/بستن پوزیشن با SDK رسمی (`@nktkas/hyperliquid`)، نه امضای دستی |

**⚠️ قبل از استفاده با پول واقعی روی هر صرافی:**
1. حتما با Testnet/Demo همان صرافی تست کنید
2. Endpoint ها و پارامترهای دقیق را با مستندات رسمی به‌روز مقایسه کنید
3. برای Hyperliquid، مطمئن شوید `@nktkas/hyperliquid` و `viem` نصب و به‌روز هستند

---

## Strategies (`/strategies`)

هر رکورد یعنی یک قانون آربیتراژ برای یک Symbol مشخص بین دو صرافی مشخص.

### `POST /strategies`
نیاز به JWT دارد.

**Body:**
| فیلد | نوع | الزامی | توضیح |
|---|---|---|---|
| `symbol` | string | ✅ | مثلا `"BTC-USDT"` |
| `exchangeAId` | uuid | ✅ | |
| `exchangeBId` | uuid | ✅ | باید متفاوت از exchangeAId باشد |
| `minSpreadPercent` | number | ✅ | حداقل Spread خالص برای اجرا |
| `takerFeeAPercent` | number | اختیاری | پیش‌فرض 0.04 |
| `takerFeeBPercent` | number | اختیاری | پیش‌فرض 0.04 |
| `maxPositionSize` | number | ✅ | سقف حجم (به Quote Asset) |
| `orderQuantity` | number | ✅ | مقدار ثابت هر سفارش (به Base Asset) |
| `autoExecute` | boolean | اختیاری | پیش‌فرض false؛ اگر true باشد، **هر دو** accountId زیر الزامی می‌شوند |
| `exchangeAAccountId` | uuid | ⚠️ شرطی | اکانتی که سیستم با آن روی exchangeA معامله می‌کند |
| `exchangeBAccountId` | uuid | ⚠️ شرطی | اکانتی که سیستم با آن روی exchangeB معامله می‌کند |

```json
{
  "symbol": "BTC-USDT",
  "exchangeAId": "uuid-binance",
  "exchangeBId": "uuid-bybit",
  "minSpreadPercent": 0.3,
  "maxPositionSize": 1000,
  "orderQuantity": 0.01,
  "autoExecute": true,
  "exchangeAAccountId": "uuid-account-a",
  "exchangeBAccountId": "uuid-account-b"
}
```

**خطاها:** `409 Conflict` اگر exchangeA=exchangeB، استراتژی تکراری باشد، یا autoExecute=true بدون هر دو accountId.

### `GET /strategies` / `GET /strategies/:id`
لیست یا جزئیات (با روابط exchangeA/B و exchangeAAccount/BAccount). نیاز به JWT دارد.

### `PATCH /strategies/:id`
تمام فیلدهای بالا (به‌جز symbol/exchangeAId/exchangeBId) قابل به‌روزرسانی هستند. نیاز به JWT دارد.

### `DELETE /strategies/:id`
نیاز به JWT دارد.

---

## Market Data (`/market`)

### `GET /market/spread`
محاسبه زنده Spread بین دو صرافی، بر اساس آخرین قیمت Cache شده در Redis (نه فراخوانی مستقیم صرافی). نیاز به JWT دارد.

**Query Params:** `symbol`, `exchangeA` (slug), `exchangeB` (slug), `feeA` (اختیاری، پیش‌فرض 0.04), `feeB` (اختیاری)

```
GET /market/spread?symbol=BTC-USDT&exchangeA=binance&exchangeB=bybit
```

**Response `200`:**
```json
{
  "symbol": "BTC-USDT",
  "bestDirection": {
    "buyOn": "A",
    "sellOn": "B",
    "buyPrice": 65000.1,
    "sellPrice": 65120,
    "grossSpreadPercent": 0.184,
    "netSpreadPercent": 0.104
  },
  "bothDirections": [ /* هر دو جهت ممکن */ ],
  "timestamp": 1234567890
}
```

**خطاها:** `404 Not Found` اگر قیمت زنده یکی از دو صرافی در Cache موجود/معتبر نباشد (TTL: ۱۰ ثانیه).

> نکته فنی: قیمت‌ها به‌صورت خودکار جمع‌آوری می‌شوند — `StrategyPriceWatcherService` هر ۳۰ ثانیه همه استراتژی‌های فعال (با هر دو اکانت مشخص‌شده) را بررسی می‌کند و WebSocket صرافی‌های مربوطه را برای آن Symbol متصل نگه می‌دارد. نیازی به فراخوانی دستی برای شروع دریافت قیمت نیست.

---

## Opportunities (`/opportunities`)

Audit Log کامل هر بار که سیستم یک استراتژی را چک کرده — چه اجرا شده باشد چه نه.

### `GET /opportunities`
نیاز به JWT دارد. **Query Params:** `strategyId` (اختیاری)، `limit` (پیش‌فرض 50، حداکثر 200)

**Response `200`:** آرایه‌ای با `outcome` یکی از: `below_threshold`, `detected_not_executed`, `executed`, `execution_failed`, `skipped_locked`, `skipped_position_open`.

---

## Positions (`/positions`)

### `GET /positions`
لیست پوزیشن‌های آربیتراژ (هر کدام شامل دو Leg). نیاز به JWT دارد. **Query Params:** `status` (اختیاری: `opening`|`open`|`hedging`|`failed`|`closed`|`needs_manual_review`)

### `GET /positions/:id`
جزئیات کامل یک پوزیشن + هر دو Leg + اکانت‌های مربوطه. نیاز به JWT دارد.

### `GET /positions/:id/pnl`
سود/زیان لحظه‌ای **تخمینی** (بر اساس آخرین قیمت Cache شده در Redis؛ Slippage و Fee بستن واقعی لحاظ نشده). نیاز به JWT دارد.

**Response `200`:**
```json
{
  "positionId": "uuid",
  "symbol": "BTC-USDT",
  "legs": [
    {
      "legId": "uuid",
      "exchangeSlug": "binance",
      "side": "long",
      "entryPrice": 65000,
      "currentPrice": 65120,
      "quantity": 0.01,
      "pnl": 1.2,
      "isStale": false
    },
    {
      "legId": "uuid",
      "exchangeSlug": "bybit",
      "side": "short",
      "entryPrice": 65100,
      "currentPrice": 65115,
      "quantity": 0.01,
      "pnl": -0.15,
      "isStale": false
    }
  ],
  "totalPnl": 1.05,
  "calculatedAt": 1234567890
}
```

> اگر قیمت یکی از Legها در Cache موجود نباشد (`isStale: true`)، `totalPnl` کل به `null` تنظیم می‌شود — چون جمع ناقص گمراه‌کننده‌ست، نه اینکه به‌اشتباه فقط یک طرف را نشان بدهد.

### `POST /positions/:id/close-pair`
بستن دستی هر دو Leg یک پوزیشن با یک فراخوانی. هر دو Leg موازی بسته می‌شوند. نیاز به JWT دارد.

**Response `201`:** رکورد پوزیشن به‌روزشده، با `status` یکی از `closed` (هر دو موفق بسته شدند) یا `needs_manual_review` (یکی fail شد).

**خطاها:** `404 Not Found` اگر پوزیشن یافت نشود؛ `409 Conflict` اگر پوزیشن دقیقا دو Leg نداشته باشد.

### `POST /positions/:id/close-single/:legId`
بستن دستی فقط یک Leg مشخص (نه هر دو). نیاز به JWT دارد.

**Response `201`:** رکورد Leg به‌روزشده. اگر Leg دیگر همچنان باز باشد، وضعیت کل پوزیشن به `hedging` تغییر می‌کند (نه `closed`).

---

## Risk (`/risk`)

مدیریت ریسک سراسری سیستم — یک رکورد Singleton که همه استراتژی‌ها را تحت تاثیر قرار می‌دهد.

### `GET /risk/config`
نیاز به JWT دارد.

**Response `200`:**
```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "maxConcurrentPositions": 5,
  "consecutiveFailureLimit": 3,
  "consecutiveFailureCount": 0,
  "killSwitchActive": false,
  "killSwitchReason": null
}
```

### `PATCH /risk/config`
**Body (هر دو اختیاری):** `maxConcurrentPositions`, `consecutiveFailureLimit`

### `GET /risk/status`
خلاصه‌ای برای نمایش سریع در Dashboard؛ شامل اینکه آیا الان اجازه باز کردن پوزیشن جدید هست یا نه.

```json
{
  "killSwitchActive": false,
  "killSwitchReason": null,
  "consecutiveFailureCount": 1,
  "consecutiveFailureLimit": 3,
  "canOpenNewPosition": true,
  "blockReason": null
}
```

### `POST /risk/kill-switch/activate`
توقف اضطراری دستی — بعد از این، هیچ پوزیشن جدیدی (نه خودکار، نه با تایید Detector) باز نمی‌شود.

**Body:** `{ "reason": "string" }`

### `POST /risk/kill-switch/deactivate`
غیرفعال کردن Kill Switch و ریست شمارنده شکست‌های پشت‌سرهم.

---

## نحوه کار خودکار Kill Switch

اگر **۳ اجرای پشت‌سرهم** (قابل تنظیم با `consecutiveFailureLimit`) با شکست مواجه بشن، سیستم خودش Kill Switch رو فعال می‌کنه و متوقف میشه تا یک نفر دستی بررسی و `POST /risk/kill-switch/deactivate` رو صدا بزنه. همچنین اگر تعداد پوزیشن‌های هم‌زمان باز/در حال باز شدن به `maxConcurrentPositions` برسه، هیچ پوزیشن جدیدی باز نمی‌شه (بدون نیاز به Kill Switch).

---

## نحوه کار خودکار سیستم (فاز ۵)

1. `PriceAggregatorService` روی WebSocket صرافی‌ها گوش می‌دهد و هر قیمت جدید را در Redis Cache می‌کند (TTL: ۱۰ ثانیه).
2. `OpportunityDetectorService` به دو روش موازی همه استراتژی‌های فعال را زیر نظر دارد:
   - **Event-driven (مسیر اصلی، بدون تاخیر)**: با هر قیمت جدیدی که از WebSocket می‌رسد (`ticker.updated` Event)، همان لحظه استراتژی‌های مرتبط با آن Symbol/صرافی چک می‌شوند.
   - **Interval (Fallback ایمنی، هر ۵ ثانیه)**: پوشش حالتی که یک Event به هر دلیلی از دست برود.
3. برای هر استراتژی، آخرین Spread را از Redis می‌خواند و با `minSpreadPercent` مقایسه می‌کند.
4. اگر سودآور بود و `autoExecute=true`: یک Redis Lock می‌گیرد (جلوگیری از اجرای هم‌زمان)، چک می‌کند پوزیشن باز دیگری از همین استراتژی وجود نداشته باشد، و `PositionExecutorService` را صدا می‌زند.
5. `PositionExecutorService` هر دو Leg را **موازی** باز می‌کند. اگر یکی fail شود، دیگری بلافاصله بسته می‌شود (Hedge-Close). اگر وضعیت هرکدام نامشخص (Timeout) باشد، پوزیشن `needs_manual_review` علامت می‌خورد و **هیچ بستن خودکاری انجام نمی‌شود**.
6. نتیجه هر تصمیم (چه اجرا شود چه نشود) در `arbitrage_opportunities` ثبت می‌شود.

---

## جدول خلاصه (Quick Reference)

| Method | Route | JWT | توضیح کوتاه |
|---|---|:---:|---|
| POST | `/auth/register` | ❌ | ثبت‌نام |
| POST | `/auth/login` | ❌ | ورود |
| POST | `/auth/refresh-token` | ❌ | تمدید توکن |
| POST | `/auth/2fa/generate` | ✅ | تولید Secret برای 2FA |
| POST | `/auth/2fa/enable` | ✅ | فعال‌سازی قطعی 2FA |
| GET | `/exchanges` | ✅ | لیست صرافی‌های فعال |
| POST | `/exchange-accounts` | ✅ | افزودن اکانت صرافی |
| GET | `/exchange-accounts` | ✅ | لیست اکانت‌های من |
| DELETE | `/exchange-accounts/:id` | ✅ | حذف اکانت |
| GET | `/exchange-accounts/:accountId/balance` | ✅ | موجودی اکانت |
| GET | `/health` | ❌ | سلامت سیستم |
| POST | `/strategies` | ✅ | ایجاد استراتژی آربیتراژ |
| GET | `/strategies`, `/strategies/:id` | ✅ | لیست/جزئیات استراتژی‌ها |
| PATCH | `/strategies/:id` | ✅ | به‌روزرسانی استراتژی |
| DELETE | `/strategies/:id` | ✅ | حذف استراتژی |
| GET | `/market/spread` | ✅ | محاسبه زنده Spread بین دو صرافی |
| GET | `/opportunities` | ✅ | تاریخچه فرصت‌های شناسایی‌شده |
| GET | `/positions`, `/positions/:id` | ✅ | لیست/جزئیات پوزیشن‌های آربیتراژ |
| GET | `/positions/:id/pnl` | ✅ | سود/زیان لحظه‌ای تخمینی |
| POST | `/positions/:id/close-pair` | ✅ | بستن دستی هر دو Leg |
| POST | `/positions/:id/close-single/:legId` | ✅ | بستن دستی یک Leg |
| GET | `/risk/config`, `/risk/status` | ✅ | تنظیمات و وضعیت لحظه‌ای ریسک |
| PATCH | `/risk/config` | ✅ | به‌روزرسانی سقف‌های ریسک |
| POST | `/risk/kill-switch/activate` | ✅ | توقف اضطراری دستی |
| POST | `/risk/kill-switch/deactivate` | ✅ | غیرفعال کردن Kill Switch |

---

## Endpointهای در انتظار (فازهای بعدی — هنوز پیاده نشده)

| فاز | Route | توضیح |
|---|---|---|
| ۸ | `GET /dashboard/summary`, `GET /audit-log` | داشبورد و لاگ تصمیمات سیستم |
| ۸ | Notification System | اطلاع‌رسانی Telegram/Email هنگام باز شدن پوزیشن، Kill Switch، یا نیاز به بررسی دستی |
