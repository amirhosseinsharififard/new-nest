import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validConfig = {
    NODE_ENV: 'development',
    PORT: '3000',
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USERNAME: 'arbitrage',
    DB_PASSWORD: 'secret',
    DB_DATABASE: 'arbitrage_bot',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_REFRESH_EXPIRES_IN: '7d',
    MASTER_ENCRYPTION_KEY: 'a'.repeat(64),
  };

  it('با تنظیمات معتبر نباید خطا بدهد', () => {
    expect(() => validateEnv(validConfig)).not.toThrow();
  });

  it('باید NODE_ENV نامعتبر را رد کند', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging-typo' })).toThrow();
  });

  it('باید نبود PORT را رد کند', () => {
    const { PORT, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('باید MASTER_ENCRYPTION_KEY با طول اشتباه را رد کند', () => {
    expect(() =>
      validateEnv({ ...validConfig, MASTER_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/MASTER_ENCRYPTION_KEY/);
  });

  it('REDIS_PASSWORD باید اختیاری باشد (نبودش نباید خطا بدهد)', () => {
    expect(() => validateEnv(validConfig)).not.toThrow();
  });
});
