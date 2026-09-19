import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeAccount } from './entities/exchange-account.entity';
import { Exchange } from '../exchanges/entities/exchange.entity';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { CreateExchangeAccountDto } from './dto/create-exchange-account.dto';

@Injectable()
export class ExchangeAccountsService {
  constructor(
    @InjectRepository(ExchangeAccount)
    private readonly accountRepo: Repository<ExchangeAccount>,
    @InjectRepository(Exchange)
    private readonly exchangeRepo: Repository<Exchange>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async create(userId: string, dto: CreateExchangeAccountDto) {
    const exchange = await this.exchangeRepo.findOne({
      where: { id: dto.exchangeId },
    });
    if (!exchange) {
      throw new NotFoundException('صرافی مورد نظر یافت نشد');
    }

    this.validateCredentialCombination(dto);

    const account = this.accountRepo.create({
      user: { id: userId } as any,
      exchange,
      label: dto.label,
      encryptedApiKey: dto.apiKey ? this.encryptionService.encrypt(dto.apiKey) : null,
      encryptedApiSecret: dto.apiSecret
        ? this.encryptionService.encrypt(dto.apiSecret)
        : null,
      encryptedPassphrase: dto.passphrase
        ? this.encryptionService.encrypt(dto.passphrase)
        : null,
      encryptedPublicKey: dto.publicKey
        ? this.encryptionService.encrypt(dto.publicKey)
        : null,
      encryptedPrivateKey: dto.privateKey
        ? this.encryptionService.encrypt(dto.privateKey)
        : null,
      permissionLevel: dto.permissionLevel,
    });

    const saved = await this.accountRepo.save(account);
    return this.toSafeResponse(saved);
  }

  async findAllForUser(userId: string) {
    const accounts = await this.accountRepo.find({
      where: { user: { id: userId } },
      relations: ['exchange'],
    });
    return accounts.map((a) => this.toSafeResponse(a));
  }

  async remove(userId: string, accountId: string) {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      relations: ['user'],
    });
    if (!account) {
      throw new NotFoundException('اکانت یافت نشد');
    }
    if (account.user.id !== userId) {
      throw new ForbiddenException('دسترسی به این اکانت مجاز نیست');
    }
    await this.accountRepo.remove(account);
  }

  /**
   * فقط برای استفاده داخلی (مثلا وقتی Adapter نیاز به Credential واقعی داره).
   * این متد هرگز نباید مستقیم به Controller/Response برگرده.
   * فیلدهایی که برای این اکانت ست نشدن، null برمی‌گردن (نه رشته خالی)
   * تا Adapter بتونه به‌وضوح تشخیص بده کدوم نوع credential موجوده.
   */
  async getDecryptedCredentials(accountId: string) {
    const account = await this.accountRepo.findOneOrFail({
      where: { id: accountId },
    });

    return {
      apiKey: this.decryptIfPresent(account.encryptedApiKey),
      apiSecret: this.decryptIfPresent(account.encryptedApiSecret),
      passphrase: this.decryptIfPresent(account.encryptedPassphrase),
      publicKey: this.decryptIfPresent(account.encryptedPublicKey),
      privateKey: this.decryptIfPresent(account.encryptedPrivateKey),
    };
  }

  /**
   * خروجی این متد مستقیم به ExchangeRegistry.getInstance() داده میشه
   * تا Adapter مربوطه (Binance/Bybit/OKX/Hyperliquid/...) ساخته بشه.
   * این نقطه اتصال بین لایه Auth/Storage و لایه Adapter هست.
   */
  async buildAdapterConfig(accountId: string) {
    const account = await this.accountRepo.findOneOrFail({
      where: { id: accountId },
      relations: ['exchange'],
    });
    const credentials = await this.getDecryptedCredentials(accountId);

    return {
      accountId: account.id,
      exchangeId: account.exchange.slug,
      restBaseUrl: account.exchange.restBaseUrl,
      wsBaseUrl: account.exchange.wsBaseUrl,
      apiKey: credentials.apiKey ?? undefined,
      apiSecret: credentials.apiSecret ?? undefined,
      passphrase: credentials.passphrase ?? undefined,
      publicKey: credentials.publicKey ?? undefined,
      privateKey: credentials.privateKey ?? undefined,
    };
  }

  /**
   * هر صرافی حداقل یکی از این دو ترکیب رو باید داشته باشه:
   * ۱) apiKey + apiSecret (با passphrase اختیاری، برای OKX و مشابه)
   * ۲) publicKey + privateKey
   *
   * این اعتبارسنجی اینجا (نه در DTO) انجام میشه چون به ترکیب چند فیلد
   * بستگی داره، نه به تک‌تک فیلدها.
   */
  private validateCredentialCombination(dto: CreateExchangeAccountDto): void {
    const hasApiKeyPair = Boolean(dto.apiKey && dto.apiSecret);
    const hasKeyPair = Boolean(dto.publicKey && dto.privateKey);

    if (!hasApiKeyPair && !hasKeyPair) {
      throw new BadRequestException(
        'باید یا (apiKey و apiSecret) یا (publicKey و privateKey) ارسال شود',
      );
    }
  }

  private decryptIfPresent(value: string | null): string | null {
    return value ? this.encryptionService.decrypt(value) : null;
  }

  // هرگز مقادیر رمزنگاری‌شده یا خام credential رو در پاسخ API برنگردون
  private toSafeResponse(account: ExchangeAccount) {
    return {
      id: account.id,
      label: account.label,
      exchange: account.exchange
        ? { id: account.exchange.id, slug: account.exchange.slug }
        : undefined,
      // فقط نشون میده کدوم نوع credential ست شده، بدون افشای مقدار
      credentialTypes: {
        hasApiKeyPair: Boolean(account.encryptedApiKey && account.encryptedApiSecret),
        hasPassphrase: Boolean(account.encryptedPassphrase),
        hasKeyPair: Boolean(account.encryptedPublicKey && account.encryptedPrivateKey),
      },
      permissionLevel: account.permissionLevel,
      isActive: account.isActive,
      createdAt: account.createdAt,
    };
  }
}
