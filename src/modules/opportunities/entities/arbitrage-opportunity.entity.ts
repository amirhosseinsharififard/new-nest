import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ArbitrageStrategy } from '../../strategies/entities/arbitrage-strategy.entity';

export enum OpportunityOutcome {
  /** Spread پیدا شد ولی به Threshold نرسید */
  BELOW_THRESHOLD = 'below_threshold',
  /** Spread سودآور بود ولی autoExecute استراتژی خاموش بود، فقط لاگ شد */
  DETECTED_NOT_EXECUTED = 'detected_not_executed',
  /** سودآور بود، اجرا شد، هر دو پا موفق */
  EXECUTED = 'executed',
  /** سودآور بود ولی اجرا با خطا مواجه شد */
  EXECUTION_FAILED = 'execution_failed',
  /** به‌خاطر قفل Redis (اجرای هم‌زمان دیگری در جریان بود) رد شد */
  SKIPPED_LOCKED = 'skipped_locked',
  /** چون یک پوزیشن باز دیگر از همین استراتژی وجود داشت، رد شد */
  SKIPPED_POSITION_OPEN = 'skipped_position_open',
  /** به‌خاطر Kill Switch فعال یا رسیدن به سقف پوزیشن هم‌زمان، رد شد */
  RISK_BLOCKED = 'risk_blocked',
}

/**
 * هر بار OpportunityDetector یک استراتژی رو چک می‌کنه، نتیجه (چه مثبت
 * چه منفی) اینجا ثبت میشه. این جدول برای Debug بعدی حیاتیه — بدونش
 * وقتی یک فرصت از دست رفت یا یک اجرا fail شد، هیچ ردی از چرایی‌ش نمی‌مونه.
 */
@Entity('arbitrage_opportunities')
@Index(['strategy', 'createdAt'])
export class ArbitrageOpportunity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ArbitrageStrategy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategy_id' })
  strategy: ArbitrageStrategy;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  netSpreadPercent: string;

  @Column()
  buyOnExchangeSlug: string;

  @Column()
  sellOnExchangeSlug: string;

  @Column({ type: 'enum', enum: OpportunityOutcome })
  outcome: OpportunityOutcome;

  // شناسه پوزیشنی که (در صورت اجرا) از این فرصت ساخته شد
  @Column({ nullable: true })
  resultingPositionId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
