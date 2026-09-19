import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * رمزنگاری API Key/Secret صرافی‌ها با AES-256-GCM.
 * کلید اصلی (MASTER_ENCRYPTION_KEY) در ENV نگه داشته میشه، نه در دیتابیس.
 * این یعنی حتی اگر دیتابیس لو بره، بدون این کلید نمیشه Secret ها رو خوند.
 *
 * در Production واقعی پیشنهاد میشه این کلید در یک Secret Manager
 * (AWS KMS / HashiCorp Vault) نگه داشته بشه، نه فقط .env روی سرور.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {
    const hexKey = this.configService.get<string>('MASTER_ENCRYPTION_KEY');
    if (!hexKey || hexKey.length !== 64) {
      throw new Error(
        'MASTER_ENCRYPTION_KEY باید 64 کاراکتر hex (32 بایت) باشد',
      );
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12); // GCM استاندارد 12 بایت
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // فرمت ذخیره: iv:authTag:encryptedData (همه hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(cipherText: string): string {
    const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('فرمت داده رمزنگاری‌شده نامعتبر است');
    }

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
