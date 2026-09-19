import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PermissionLevel } from '../entities/exchange-account.entity';

/**
 * چون صرافی‌ها فرمت احراز هویت متفاوتی دارن:
 * - Binance / Bybit: فقط apiKey + apiSecret
 * - OKX: apiKey + apiSecret + passphrase
 * - بعضی سیستم‌ها: publicKey + privateKey
 *
 * همه فیلدها اختیاری تعریف شدن و اعتبارسنجی ترکیب صحیح در
 * ExchangeAccountsService انجام میشه، نه اینجا. اضافه کردن
 * صرافی با فرمت جدید یعنی فقط این DTO یک فیلد اختیاری دیگه می‌گیره،
 * بدون نیاز به تغییر Migration های قبلی.
 */
export class CreateExchangeAccountDto {
  @IsUUID()
  exchangeId: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsString()
  passphrase?: string;

  @IsOptional()
  @IsString()
  publicKey?: string;

  @IsOptional()
  @IsString()
  privateKey?: string;

  @IsOptional()
  @IsEnum(PermissionLevel)
  permissionLevel?: PermissionLevel;
}
