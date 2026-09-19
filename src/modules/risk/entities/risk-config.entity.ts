import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * این جدول همیشه فقط یک رکورد داره (Singleton Pattern در سطح دیتابیس،
 * با یک id ثابت که در RiskService مدیریت میشه).
 *
 * منطق Kill Switch: اگر consecutiveFailureCount به consecutiveFailureLimit
 * برسه، killSwitchActive به‌صورت خودکار true میشه و هیچ پوزیشن جدیدی
 * (نه خودکار، نه با تایید Detector) باز نمیشه تا یک نفر دستی آن را
 * غیرفعال کنه.
 */
@Entity('risk_config')
export class RiskConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 5 })
  maxConcurrentPositions: number;

  // بعد از چند شکست پشت‌سرهم اجرا (EXECUTION_FAILED)، Kill Switch خودکار فعال بشه
  @Column({ default: 3 })
  consecutiveFailureLimit: number;

  // شمارنده داخلی؛ با هر اجرای موفق صفر میشه، با هر شکست یکی زیاد میشه
  @Column({ default: 0 })
  consecutiveFailureCount: number;

  @Column({ default: false })
  killSwitchActive: boolean;

  @Column({ type: 'text', nullable: true })
  killSwitchReason: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
