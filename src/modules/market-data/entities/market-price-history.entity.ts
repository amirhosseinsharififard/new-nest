import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('market_price_history')
@Index(['symbol', 'receivedAt'])
@Index(['exchangeSlug', 'symbol', 'receivedAt'])
export class MarketPriceHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 30 })
  exchangeSlug: string;

  @Column({ type: 'varchar', length: 100 })
  symbol: string;

  @Column({ type: 'numeric', precision: 30, scale: 12 })
  bidPrice: string;

  @Column({ type: 'numeric', precision: 30, scale: 12 })
  bidSize: string;

  @Column({ type: 'numeric', precision: 30, scale: 12 })
  askPrice: string;

  @Column({ type: 'numeric', precision: 30, scale: 12 })
  askSize: string;

  // Timestamp reported by the exchange, in milliseconds
  @Column({ type: 'bigint', nullable: true })
  exchangeTimestamp: string | null;

  // Timestamp when our application received the ticker
  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  receivedAt: Date;

  @Column({ type: 'varchar', length: 50, unique: true })
  streamId: string;
}
