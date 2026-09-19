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
import { Exchange } from '../../exchanges/entities/exchange.entity';
import { ExchangeAccount } from '../../exchange-accounts/entities/exchange-account.entity';

/**
 * هر رکورد یعنی یک قانون آربیتراژ برای یک جفت‌ارز مشخص بین دو صرافی مشخص.
 * چون کاربر گفته "روش‌های متفاوت برای هر ارز ممکنه متفاوت باشه"، این تنظیمات
 * سراسری (Global) نیست — هر Symbol/Exchange-Pair می‌تونه Threshold خودش رو داشته باشه.
 */
@Entity('arbitrage_strategies')
@Index(['symbol', 'exchangeA', 'exchangeB'], { unique: true })
export class ArbitrageStrategy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // نماد داخلی مشترک، مثلا "BTC-USDT"
  @Column()
  symbol: string;

  @ManyToOne(() => Exchange, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exchange_a_id' })
  exchangeA: Exchange;

  @ManyToOne(() => Exchange, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exchange_b_id' })
  exchangeB: Exchange;

  // حداقل درصد Spread خالص (بعد از کسر کارمزد) برای این‌که فرصت معتبر در نظر گرفته بشه
  @Column({ type: 'decimal', precision: 6, scale: 4 })
  minSpreadPercent: string;

  // کارمزد Taker هر صرافی، چون این مستقیم روی محاسبه Spread خالص اثر می‌ذاره
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.04 })
  takerFeeAPercent: string;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.04 })
  takerFeeBPercent: string;

  // حداکثر حجم مجاز برای این استراتژی (به واحد Quote Asset، مثلا USDT)
  @Column({ type: 'decimal', precision: 20, scale: 8 })
  maxPositionSize: string;

  /**
   * وقتی فرصت سودآور تشخیص داده بشه و autoExecute=true باشه، سیستم
   * خودش (بدون تایید دستی) پوزیشن باز می‌کنه. پیش‌فرض false است —
   * کاربر باید صراحتاً این ریسک رو فعال کنه.
   */
  @Column({ default: false })
  autoExecute: boolean;

  // مقدار ثابت هر سفارش (به واحد Base Asset، مثلا مقدار BTC)
  @Column({ type: 'decimal', precision: 20, scale: 8 })
  orderQuantity: string;

  // اکانت مشخصی که سیستم باید با اون روی exchangeA معامله کنه
  @ManyToOne(() => ExchangeAccount, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'exchange_a_account_id' })
  exchangeAAccount: ExchangeAccount | null;

  @ManyToOne(() => ExchangeAccount, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'exchange_b_account_id' })
  exchangeBAccount: ExchangeAccount | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
