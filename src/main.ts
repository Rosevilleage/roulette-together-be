import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { setupSwagger } from './utils/swagger';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 정의되지 않은 속성 제거
      forbidNonWhitelisted: true, // DTO에 없는 속성이 있으면 에러
      transform: true, // 요청 데이터를 DTO 인스턴스로 자동 변환
      transformOptions: {
        enableImplicitConversion: true, // 타입 자동 변환
      },
    }),
  );
  setupSwagger(app);
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();
