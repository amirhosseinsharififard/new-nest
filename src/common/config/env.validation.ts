import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  Length,
  validateSync,
  IsOptional,
  IsBoolean,
  Min,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * اعتبارسنجی متغیرهای محیطی هنگام بالا آمدن اپلیکیشن.
 * اگر یکی از این‌ها ناقص یا اشتباه باشه، اپ اصلا Start نمیشه —
 * بهتره در زمان بوت شدن بفهمیم تا وسط کار روی یک صرافی واقعی.
 */
class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  PORT: number;

  @IsString()
  DB_HOST: string;

  @IsNumber()
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  @IsString()
  REDIS_HOST: string;

  @IsNumber()
  REDIS_PORT: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string;

  @IsString()
  @Length(64, 64, { message: 'MASTER_ENCRYPTION_KEY باید دقیقا 64 کاراکتر hex (32 بایت) باشد' })
  MASTER_ENCRYPTION_KEY: string;

  @IsOptional() @IsBoolean()
  MARKET_SCANNER_ENABLED?: boolean;

  @IsOptional() @IsNumber() @Min(1)
  MARKET_SCANNER_TTL_SECONDS?: number;

  @IsOptional() @IsNumber() @Min(1)
  MARKET_SCANNER_FRESHNESS_MS?: number;

  @IsOptional() @IsNumber()
  MARKET_SCANNER_MIN_SPREAD_PERCENT?: number;

  @IsOptional() @IsNumber() @Min(1)
  MARKET_SCANNER_MAX_RESULTS?: number;

  @IsOptional() @IsNumber() @Min(0)
  MARKET_SCANNER_DEBOUNCE_MS?: number;

  @IsOptional() @IsString()
  MARKET_SCANNER_EXCHANGES?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `پیکربندی Environment نامعتبر است:\n${errors
        .map((e) => Object.values(e.constraints || {}).join(', '))
        .join('\n')}`,
    );
  }
  return validatedConfig;
}
