import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, RegisterDto, Verify2faDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Rate limit سخت‌گیرانه‌تر روی login برای جلوگیری از Brute-force
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh-token')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  generate2fa(@Req() req: any) {
    return this.authService.generate2faSecret(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  enable2fa(@Req() req: any, @Body() dto: Verify2faDto) {
    return this.authService.enable2fa(req.user.userId, dto.otpCode);
  }
}
