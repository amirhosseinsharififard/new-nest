import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;
  const validKey = 'a'.repeat(64); // 64 کاراکتر hex معتبر

  const buildService = (key: string | undefined) => {
    const configService = {
      get: jest.fn().mockReturnValue(key),
    } as unknown as ConfigService;
    return new EncryptionService(configService);
  };

  beforeEach(() => {
    service = buildService(validKey);
  });

  it('باید یک متن را رمزنگاری و سپس دقیقا همان مقدار را رمزگشایی کند', () => {
    const plainText = 'my-super-secret-api-key-12345';
    const encrypted = service.encrypt(plainText);
    const decrypted = service.decrypt(encrypted);

    expect(decrypted).toBe(plainText);
  });

  it('خروجی رمزنگاری‌شده نباید برابر متن اصلی باشد', () => {
    const plainText = 'test-secret';
    const encrypted = service.encrypt(plainText);

    expect(encrypted).not.toBe(plainText);
    expect(encrypted).toContain(':'); // فرمت iv:authTag:data
  });

  it('هر بار رمزنگاری همان متن باید IV متفاوت (خروجی متفاوت) تولید کند', () => {
    const plainText = 'same-input';
    const first = service.encrypt(plainText);
    const second = service.encrypt(plainText);

    expect(first).not.toBe(second);
    // ولی هر دو باید درست رمزگشایی بشن
    expect(service.decrypt(first)).toBe(plainText);
    expect(service.decrypt(second)).toBe(plainText);
  });

  it('اگر MASTER_ENCRYPTION_KEY نامعتبر (طول اشتباه) باشد باید Error پرتاب کند', () => {
    expect(() => buildService('short-key')).toThrow();
  });

  it('اگر MASTER_ENCRYPTION_KEY تعریف نشده باشد باید Error پرتاب کند', () => {
    expect(() => buildService(undefined)).toThrow();
  });

  it('اگر داده رمزنگاری‌شده دستکاری شده باشد (authTag نامعتبر) باید در decrypt خطا بدهد', () => {
    const encrypted = service.encrypt('sensitive-data');
    const [iv, authTag, data] = encrypted.split(':');
    // دستکاری عمدی داده رمزنگاری‌شده
    const tampered = `${iv}:${authTag}:${data.slice(0, -2)}ff`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('اگر فرمت ورودی decrypt نامعتبر باشد (بدون جداکننده کافی) باید خطا بدهد', () => {
    expect(() => service.decrypt('invalid-format-string')).toThrow(
      'فرمت داده رمزنگاری‌شده نامعتبر است',
    );
  });
});
