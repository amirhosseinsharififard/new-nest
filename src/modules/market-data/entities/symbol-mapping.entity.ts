import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Exchange } from '../../exchanges/entities/exchange.entity';

/**
 * چون نماد یک ارز بین صرافی‌ها فرق می‌کنه (مثلا Binance: "BTCUSDT"،
 * OKX: "BTC-USDT-SWAP"، Hyperliquid: "BTC")، این جدول نگاشت نماد داخلی
 * مشترک ("BTC-USDT") به فرمت هر صرافی رو نگه می‌داره.
 *
 * نکته: توابع toBinanceSymbol/toOkxSymbol/... در adapters/ فعلا این تبدیل
 * رو Rule-based انجام میدن. این جدول برای مواردی هست که Rule ساده کافی
 * نیست (مثلا نمادهای غیرمعمول یا Alias) — و به‌مرور می‌تونه جایگزین
 * توابع Rule-based بشه.
 */
@Entity('symbol_mappings')
@Index(['internalSymbol', 'exchange'], { unique: true })
export class SymbolMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  internalSymbol: string; // مثلا "BTC-USDT"

  @ManyToOne(() => Exchange, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchange_id' })
  exchange: Exchange;

  @Column()
  exchangeSymbol: string; // مثلا "BTCUSDT" یا "BTC-USDT-SWAP"

  @Column({ default: true })
  isActive: boolean;
}
