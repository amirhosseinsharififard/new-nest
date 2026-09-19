import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: { findOne: jest.Mock; findOneOrFail: jest.Mock; create: jest.Mock; save: jest.Mock };
  let jwtService: Partial<JwtService>;
  let configService: Partial<ConfigService>;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      username: 'ali',
      passwordHash: 'hashed-password',
      twoFactorSecret: null,
      isTwoFactorEnabled: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as User;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data) => ({ id: 'user-1', ...data })),
      save: jest.fn(async (data) => data),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return values[key];
      }),
    };

    service = new AuthService(
      userRepo as any,
      jwtService as JwtService,
      configService as ConfigService,
    );
  });

  describe('register', () => {
    it('باید کاربر جدید را با پسورد هش‌شده (argon2) ذخیره کند', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const hashSpy = jest.spyOn(argon2, 'hash').mockResolvedValue('hashed-value' as any);

      const result = await service.register({ username: 'ali', password: 'MyPass123456' });

      expect(hashSpy).toHaveBeenCalledWith('MyPass123456', { type: argon2.argon2id });
      expect(userRepo.save).toHaveBeenCalled();
      expect(result).toEqual({ id: 'user-1', username: 'ali' });
    });

    it('اگر نام کاربری تکراری باشد باید ConflictException بدهد', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());

      await expect(
        service.register({ username: 'ali', password: 'MyPass123456' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('با یوزرنیم/پسورد درست و بدون 2FA باید توکن برگرداند', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());
      jest.spyOn(argon2, 'verify').mockResolvedValue(true);

      const result = await service.login({ username: 'ali', password: 'correct-pass' });

      expect(result).toEqual({ accessToken: 'signed-token', refreshToken: 'signed-token' });
    });

    it('اگر کاربر وجود نداشته باشد باید همان پیام عمومی خطا را بدهد (جلوگیری از Username Enumeration)', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow('نام کاربری یا رمز عبور اشتباه است');
    });

    it('اگر پسورد اشتباه باشد باید همان پیام عمومی خطا را بدهد', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());
      jest.spyOn(argon2, 'verify').mockResolvedValue(false);

      await expect(
        service.login({ username: 'ali', password: 'wrong-pass' }),
      ).rejects.toThrow('نام کاربری یا رمز عبور اشتباه است');
    });

    it('اگر کاربر غیرفعال (isActive=false) باشد باید Unauthorized بدهد', async () => {
      userRepo.findOne.mockResolvedValue(buildUser({ isActive: false }));

      await expect(
        service.login({ username: 'ali', password: 'correct-pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('اگر 2FA فعال باشد ولی otpCode ارسال نشده باشد باید خطا بدهد', async () => {
      userRepo.findOne.mockResolvedValue(
        buildUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET123' }),
      );
      jest.spyOn(argon2, 'verify').mockResolvedValue(true);

      await expect(
        service.login({ username: 'ali', password: 'correct-pass' }),
      ).rejects.toThrow('کد 2FA لازم است');
    });

    it('اگر 2FA فعال باشد و otpCode نامعتبر باشد باید خطا بدهد', async () => {
      userRepo.findOne.mockResolvedValue(
        buildUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET123' }),
      );
      jest.spyOn(argon2, 'verify').mockResolvedValue(true);
      jest.spyOn(authenticator, 'verify').mockReturnValue(false);

      await expect(
        service.login({ username: 'ali', password: 'correct-pass', otpCode: '000000' }),
      ).rejects.toThrow('کد 2FA نامعتبر است');
    });

    it('با otpCode معتبر و 2FA فعال باید توکن برگرداند', async () => {
      userRepo.findOne.mockResolvedValue(
        buildUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET123' }),
      );
      jest.spyOn(argon2, 'verify').mockResolvedValue(true);
      jest.spyOn(authenticator, 'verify').mockReturnValue(true);

      const result = await service.login({
        username: 'ali',
        password: 'correct-pass',
        otpCode: '123456',
      });

      expect(result.accessToken).toBe('signed-token');
    });
  });

  describe('refreshTokens', () => {
    it('با refresh token معتبر باید جفت توکن جدید بدهد', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-1', username: 'ali' });
      userRepo.findOne.mockResolvedValue(buildUser());

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result).toEqual({ accessToken: 'signed-token', refreshToken: 'signed-token' });
    });

    it('با refresh token نامعتبر باید Unauthorized بدهد', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(service.refreshTokens('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('اگر کاربر مربوط به توکن دیگر وجود نداشته باشد باید Unauthorized بدهد', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-1', username: 'ali' });
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.refreshTokens('valid-but-user-deleted')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('2FA', () => {
    it('generate2faSecret باید secret تولید و در کاربر ذخیره کند', async () => {
      userRepo.findOneOrFail.mockResolvedValue(buildUser());
      jest.spyOn(authenticator, 'generateSecret').mockReturnValue('GENERATED_SECRET');

      const result = await service.generate2faSecret('user-1');

      expect(result.secret).toBe('GENERATED_SECRET');
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ twoFactorSecret: 'GENERATED_SECRET' }),
      );
    });

    it('enable2fa با کد درست باید isTwoFactorEnabled را true کند', async () => {
      userRepo.findOneOrFail.mockResolvedValue(
        buildUser({ twoFactorSecret: 'SECRET123' }),
      );
      jest.spyOn(authenticator, 'verify').mockReturnValue(true);

      await service.enable2fa('user-1', '123456');

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isTwoFactorEnabled: true }),
      );
    });

    it('enable2fa با کد اشتباه باید خطا بدهد و ذخیره نکند', async () => {
      userRepo.findOneOrFail.mockResolvedValue(
        buildUser({ twoFactorSecret: 'SECRET123' }),
      );
      jest.spyOn(authenticator, 'verify').mockReturnValue(false);

      await expect(service.enable2fa('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
