import { IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(4)
  username: string;

  @IsString()
  @MinLength(10, { message: 'رمز عبور باید حداقل ۱۰ کاراکتر باشد' })
  // حداقل یک حرف و یک عدد
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'رمز عبور باید ترکیبی از حروف و عدد باشد',
  })
  password: string;
}

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;

  // اگر 2FA فعال باشه لازمه، وگرنه اختیاریه
  otpCode?: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class Verify2faDto {
  @IsString()
  otpCode: string;
}
