import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExchangeAccount } from '../../exchange-accounts/entities/exchange-account.entity';

/**
 * موجودی هر Asset به تفکیک هر اکانت.
 * این جدول در فاز ۲ توسط WebSocket/Polling صرافی به‌روزرسانی میشه.
 * فعلا فقط ساختار و یک Endpoint دستی برای تست داریم.
 */
@Entity('balances')
@Index(['exchangeAccount', 'asset'], { unique: true })
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ExchangeAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchange_account_id' })
  exchangeAccount: ExchangeAccount;

  @Column()
  asset: string; // مثلا "USDT"

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  free: string; // decimal رو به صورت string نگه می‌داریم تا دقت float از بین نره

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  locked: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
