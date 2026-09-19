import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ArbitragePosition } from './arbitrage-position.entity';
import { ExchangeAccount } from '../../exchange-accounts/entities/exchange-account.entity';
import { OrderStatus, PositionSide } from '../../../core/exchange/exchange.types';

@Entity('position_legs')
export class PositionLeg {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ArbitragePosition, (position) => position.legs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'position_id' })
  position: ArbitragePosition;

  @ManyToOne(() => ExchangeAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'exchange_account_id' })
  exchangeAccount: ExchangeAccount;

  @Column({ type: 'enum', enum: PositionSide })
  side: PositionSide;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  requestedQuantity: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  filledQuantity: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  avgFillPrice: string | null;

  @Column({ nullable: true })
  exchangeOrderId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
