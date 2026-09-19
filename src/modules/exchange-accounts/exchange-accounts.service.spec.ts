import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExchangeAccountsService } from './exchange-accounts.service';

describe('ExchangeAccountsService', () => {
  let service: ExchangeAccountsService;
  let accountRepo: any;
  let exchangeRepo: any;
  let encryptionService: any;

  beforeEach(() => {
    accountRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'account-1', ...data })),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      remove: jest.fn(),
    };
    exchangeRepo = {
      findOne: jest.fn(),
    };
    encryptionService = {
      encrypt: jest.fn((val: string) => `encrypted(${val})`),
      decrypt: jest.fn((val: string) => val.replace('encrypted(', '').replace(')', '')),
    };

    service = new ExchangeAccountsService(accountRepo, exchangeRepo, encryptionService);
  });

  describe('create — سناریوی apiKey/apiSecret (مثلا Binance)', () => {
    beforeEach(() => {
      exchangeRepo.findOne.mockResolvedValue({ id: 'exchange-1', slug: 'binance' });
    });

    it('باید apiKey و apiSecret را رمزنگاری و ذخیره کند', async () => {
      await service.create('user-1', {
        exchangeId: 'exchange-1',
        label: 'main',
        apiKey: 'real-api-key',
        apiSecret: 'real-api-secret',
      });

      expect(encryptionService.encrypt).toHaveBeenCalledWith('real-api-key');
      expect(encryptionService.encrypt).toHaveBeenCalledWith('real-api-secret');
      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          encryptedApiKey: 'encrypted(real-api-key)',
          encryptedApiSecret: 'encrypted(real-api-secret)',
          encryptedPassphrase: null,
          encryptedPublicKey: null,
          encryptedPrivateKey: null,
        }),
      );
    });
  });

  describe('create — سناریوی apiKey/apiSecret/passphrase (مثلا OKX)', () => {
    it('باید passphrase را هم رمزنگاری و ذخیره کند', async () => {
      exchangeRepo.findOne.mockResolvedValue({ id: 'exchange-2', slug: 'okx' });

      await service.create('user-1', {
        exchangeId: 'exchange-2',
        label: 'main',
        apiKey: 'key',
        apiSecret: 'secret',
        passphrase: 'my-passphrase',
      });

      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          encryptedPassphrase: 'encrypted(my-passphrase)',
        }),
      );
    });
  });

  describe('create — سناریوی publicKey/privateKey', () => {
    it('باید بدون apiKey/apiSecret هم قبول شود اگر publicKey/privateKey داده شده باشد', async () => {
      exchangeRepo.findOne.mockResolvedValue({ id: 'exchange-3', slug: 'custom-dex' });

      await service.create('user-1', {
        exchangeId: 'exchange-3',
        label: 'main',
        publicKey: 'pub-123',
        privateKey: 'priv-456',
      });

      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          encryptedApiKey: null,
          encryptedApiSecret: null,
          encryptedPublicKey: 'encrypted(pub-123)',
          encryptedPrivateKey: 'encrypted(priv-456)',
        }),
      );
    });
  });

  describe('create — اعتبارسنجی ترکیب credential', () => {
    beforeEach(() => {
      exchangeRepo.findOne.mockResolvedValue({ id: 'exchange-1', slug: 'binance' });
    });

    it('اگر هیچ ترکیب معتبری داده نشود باید BadRequestException بدهد', async () => {
      await expect(
        service.create('user-1', { exchangeId: 'exchange-1', label: 'main' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('فقط apiKey بدون apiSecret باید رد شود', async () => {
      await expect(
        service.create('user-1', {
          exchangeId: 'exchange-1',
          label: 'main',
          apiKey: 'key-only',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('فقط publicKey بدون privateKey باید رد شود', async () => {
      await expect(
        service.create('user-1', {
          exchangeId: 'exchange-1',
          label: 'main',
          publicKey: 'pub-only',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — عدم افشای credential در پاسخ', () => {
    it('پاسخ نباید هیچ‌وقت مقدار خام یا رمزنگاری‌شده credential را برگرداند، فقط نوع آن را نشان دهد', async () => {
      exchangeRepo.findOne.mockResolvedValue({ id: 'exchange-1', slug: 'binance' });

      const result = await service.create('user-1', {
        exchangeId: 'exchange-1',
        label: 'main',
        apiKey: 'real-api-key',
        apiSecret: 'real-api-secret',
      });

      expect(result).not.toHaveProperty('encryptedApiKey');
      expect(result).not.toHaveProperty('encryptedApiSecret');
      expect(JSON.stringify(result)).not.toContain('real-api-key');
      expect(result).toHaveProperty('credentialTypes');
      expect((result as any).credentialTypes.hasApiKeyPair).toBe(true);
      expect((result as any).credentialTypes.hasKeyPair).toBe(false);
    });

    it('اگر صرافی مورد نظر یافت نشود باید NotFoundException بدهد', async () => {
      exchangeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          exchangeId: 'non-existent',
          label: 'main',
          apiKey: 'k',
          apiSecret: 's',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('اگر اکانت متعلق به کاربر دیگری باشد باید ForbiddenException بدهد', async () => {
      accountRepo.findOne.mockResolvedValue({
        id: 'account-1',
        user: { id: 'another-user' },
      });

      await expect(service.remove('user-1', 'account-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(accountRepo.remove).not.toHaveBeenCalled();
    });

    it('اگر اکانت یافت نشود باید NotFoundException بدهد', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('user-1', 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('با مالکیت درست باید اکانت را حذف کند', async () => {
      accountRepo.findOne.mockResolvedValue({
        id: 'account-1',
        user: { id: 'user-1' },
      });

      await service.remove('user-1', 'account-1');

      expect(accountRepo.remove).toHaveBeenCalled();
    });
  });

  describe('getDecryptedCredentials', () => {
    it('باید فقط فیلدهای موجود را رمزگشایی کند و بقیه را null برگرداند', async () => {
      accountRepo.findOneOrFail.mockResolvedValue({
        encryptedApiKey: 'encrypted(real-api-key)',
        encryptedApiSecret: 'encrypted(real-api-secret)',
        encryptedPassphrase: null,
        encryptedPublicKey: null,
        encryptedPrivateKey: null,
      });

      const result = await service.getDecryptedCredentials('account-1');

      expect(result).toEqual({
        apiKey: 'real-api-key',
        apiSecret: 'real-api-secret',
        passphrase: null,
        publicKey: null,
        privateKey: null,
      });
    });

    it('برای اکانت مبتنی بر publicKey/privateKey باید apiKey/apiSecret را null برگرداند', async () => {
      accountRepo.findOneOrFail.mockResolvedValue({
        encryptedApiKey: null,
        encryptedApiSecret: null,
        encryptedPassphrase: null,
        encryptedPublicKey: 'encrypted(pub-123)',
        encryptedPrivateKey: 'encrypted(priv-456)',
      });

      const result = await service.getDecryptedCredentials('account-1');

      expect(result).toEqual({
        apiKey: null,
        apiSecret: null,
        passphrase: null,
        publicKey: 'pub-123',
        privateKey: 'priv-456',
      });
    });
  });
});
