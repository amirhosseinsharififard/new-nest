import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ExchangeMarketType {
  SPOT = 'spot',
  FUTURES = 'futures',
}

/**
 * جدول تعریف صرافی‌ها. این داده مستقیما به ExchangeRegistry
 * کمک می‌کنه بفهمه چه Adapter ای رو برای کدوم exchangeId صدا بزنه.
 * نکته: خود این رکورد باعث "شناخته شدن" صرافی نمیشه — Adapter کد هم
 * باید در adapters/index.ts ثبت شده باشه. این جدول فقط Config/Metadata است.
 */
@Entity('exchanges')
export class Exchange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // باید دقیقا با کلید ثبت‌شده در ExchangeRegistry یکی باشه (مثلا "binance")
  @Column({ unique: true })
  slug: string;

  @Column()
  displayName: string;

  @Column({ type: 'enum', enum: ExchangeMarketType })
  marketType: ExchangeMarketType;

  @Column()
  restBaseUrl: string;

  @Column()
  wsBaseUrl: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
