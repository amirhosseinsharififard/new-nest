import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ArbitrageStrategy } from '../../strategies/entities/arbitrage-strategy.entity';
import { PositionLeg } from './position-leg.entity';

export enum ArbitragePositionStatus {
  /** هر دو Leg در حال باز شدن هستند */
  OPENING = 'opening',
  /** هر دو Leg با موفقیت باز شدند */
  OPEN = 'open',
  /** فقط یکی از دو Leg باز شد؛ سیستم در حال بستن آن (Hedge-Close) است */
  HEDGING = 'hedging',
  /** هیچ‌کدام باز نماندند (یا با موفقیت Hedge-Close شدند) */
  FAILED = 'failed',
  /** هر دو Leg با موفقیت بسته شدند (خروج عادی) */
  CLOSED = 'closed',
  /** حالت نامشخص که نیاز به بررسی دستی دارد (مثلا بعد از Timeout که Reconcile هم شکست خورد) */
  NEEDS_MANUAL_REVIEW = 'needs_manual_review',
}

/**
 * رکورد والد یک پوزیشن آربیتراژ. هر پوزیشن دقیقا دو Leg دارد
 * (یکی Long روی یک صرافی، یکی Short روی صرافی دیگر).
 */
@Entity('arbitrage_positions')
export class ArbitragePosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ArbitrageStrategy, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'strategy_id' })
  strategy: ArbitrageStrategy;

  @Column()
  symbol: string;

  @Column({ type: 'enum', enum: ArbitragePositionStatus, default: ArbitragePositionStatus.OPENING })
  status: ArbitragePositionStatus;

  // Idempotency Key مشترک بین هر دو Leg همین پوزیشن (جلوگیری از اجرای تکراری)
  @Column({ unique: true })
  idempotencyKey: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  expectedNetSpreadPercent: string | null;

  @OneToMany(() => PositionLeg, (leg) => leg.position, { cascade: true })
  legs: PositionLeg[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
