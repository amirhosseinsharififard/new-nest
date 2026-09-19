import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Exchange } from '../../exchanges/entities/exchange.entity';

export enum PermissionLevel {
  READ_ONLY = 'read_only',
  TRADE = 'trade',
  WITHDRAW = 'withdraw', // معمولا نباید هرگز استفاده بشه در این سیستم
}

/**
 * هر رکورد یعنی یک اکانت مشخص در یک صرافی مشخص، متعلق به یک کاربر.
 * چون گفتید ممکنه چند اکانت در یک صرافی داشته باشیم، این جدول
 * one-to-many از User به ExchangeAccount هست (نه unique روی exchange+user).
 */
@Entity('exchange_accounts')
@Index(['user', 'exchange', 'label'], { unique: true })
export class ExchangeAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Exchange, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exchange_id' })
  exchange: Exchange;

  // برچسب دلخواه برای تمایز اکانت‌های مختلف روی یک صرافی، مثلا "main" یا "hedge-2"
  @Column()
  label: string;

  // این‌ها هرگز plain نیستن — همیشه از EncryptionService عبور می‌کنن

  // apiKey/apiSecret برای اکثر صرافی‌ها (Binance, Bybit, ...) استفاده میشه.
  // Nullable هستن چون اکانت‌هایی که فقط publicKey/privateKey دارن این دو رو خالی می‌ذارن؛
  // قانون "حداقل یک ترکیب معتبر باید موجود باشه" هم در Service و هم در DB (CHECK constraint) اعمال شده.
  @Column({ type: 'text', nullable: true })
  encryptedApiKey: string | null;

  @Column({ type: 'text', nullable: true })
  encryptedApiSecret: string | null;

  // برخی صرافی‌ها (مثلا OKX) علاوه بر Key/Secret به Passphrase هم نیاز دارند
  @Column({ type: 'text', nullable: true })
  encryptedPassphrase: string | null;

  // برای صرافی‌ها/سیستم‌هایی که از مدل Public/Private Key استفاده می‌کنند (نه apiKey/apiSecret)
  @Column({ type: 'text', nullable: true })
  encryptedPublicKey: string | null;

  @Column({ type: 'text', nullable: true })
  encryptedPrivateKey: string | null;

  @Column({ type: 'enum', enum: PermissionLevel, default: PermissionLevel.TRADE })
  permissionLevel: PermissionLevel;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
