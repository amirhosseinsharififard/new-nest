import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string; // argon2 hash، هرگز plain text

  @Column({ nullable: true })
  twoFactorSecret: string | null; // برای otplib، خودش هم باید در سطح دیتابیس محافظت بشه

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
