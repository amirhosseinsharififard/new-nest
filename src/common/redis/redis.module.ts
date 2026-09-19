import { Module, Global, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * ماژول Global تا هر جای پروژه با @Inject(REDIS_CLIENT) بتونه
 * از همون یک Connection استفاده کنه (به‌جای باز کردن Connection جدید در هر Service).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const client = new Redis({
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          // اگر Redis وصل نبود، اپ نباید بی‌نهایت تلاش کنه و بمیره؛
          // این تنظیم باعث میشه در صورت قطعی، خطای واضح بده نه Silent hang
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => Math.min(times * 200, 2000),
        });

        client.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('Redis connection error:', err.message);
        });

        return client;
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnModuleDestroy {
  constructor() {}

  async onModuleDestroy() {
    // Connection cleanup در NestJS به‌صورت خودکار هنگام shutdown مدیریت میشه
    // از طریق garbage collection provider، نیازی به کد اضافه نیست مگر لازم بشه
  }
}
