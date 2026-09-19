import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // اعتبارسنجی سراسری همه DTOها + حذف فیلدهای اضافه ارسالی از کلاینت
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors(); // در Production باید origin مشخص محدود بشه

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`🚀 Application در حال اجرا روی پورت ${port}`, 'Bootstrap');
}

bootstrap();
