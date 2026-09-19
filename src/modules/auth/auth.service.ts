import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { User } from '../users/entities/user.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; username: string }> {
    const existing = await this.userRepo.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('این نام کاربری قبلا ثبت شده است');
    }

    // argon2id به‌جای bcrypt: مقاوم‌تر در برابر حملات GPU-based
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = this.userRepo.create({
      username: dto.username,
      passwordHash,
    });
    await this.userRepo.save(user);

    return { id: user.id, username: user.username };
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.userRepo.findOne({
      where: { username: dto.username },
    });

    // پیام خطای یکسان برای user-not-found و wrong-password
    // تا جلوی Username Enumeration گرفته بشه
    if (!user || !user.isActive) {
      throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    }

    if (user.isTwoFactorEnabled) {
      if (!dto.otpCode) {
        throw new UnauthorizedException('کد 2FA لازم است');
      }
      const isValidOtp = authenticator.verify({
        token: dto.otpCode,
        secret: user.twoFactorSecret!,
      });
      if (!isValidOtp) {
        throw new UnauthorizedException('کد 2FA نامعتبر است');
      }
    }

    return this.generateTokenPair(user);
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; username: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token نامعتبر یا منقضی شده است');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('کاربر یافت نشد');
    }

    return this.generateTokenPair(user);
  }

  async generate2faSecret(userId: string): Promise<{ secret: string; otpAuthUrl: string }> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    user.twoFactorSecret = secret;
    await this.userRepo.save(user);

    const otpAuthUrl = authenticator.keyuri(user.username, 'ArbitrageBot', secret);
    return { secret, otpAuthUrl };
  }

  async enable2fa(userId: string, otpCode: string): Promise<void> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    if (!user.twoFactorSecret) {
      throw new UnauthorizedException('ابتدا باید generate2faSecret صدا زده شود');
    }
    const isValid = authenticator.verify({ token: otpCode, secret: user.twoFactorSecret });
    if (!isValid) {
      throw new UnauthorizedException('کد 2FA نامعتبر است');
    }
    user.isTwoFactorEnabled = true;
    await this.userRepo.save(user);
  }

  private async generateTokenPair(user: User): Promise<TokenPair> {
    const payload = { sub: user.id, username: user.username };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN'),
    });

    return { accessToken, refreshToken };
  }
}
