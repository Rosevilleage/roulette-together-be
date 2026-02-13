import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  VersioningType,
  Logger,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationError } from 'class-validator';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { setupSwagger } from './utils/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import {
  getValidationMessage,
  getValidationErrorCode,
} from './common/utils/validation-message';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Log startup info for debugging
  logger.log('Starting application...');
  logger.log(`Node version: ${process.version}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'not set'}`);
  logger.log(`PORT: ${process.env.PORT || 'not set'}`);
  logger.log(`REDIS_URL: ${process.env.REDIS_URL ? 'set' : 'NOT SET'}`);
  logger.log(`CORS_ORIGIN: ${process.env.CORS_ORIGIN || 'not set'}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // Trust proxy for correct client IP behind Vercel/Cloudflare/Nginx
  app.set('trust proxy', true);

  app.use(cookieParser());
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  // ThrottlerExceptionFilter를 먼저 등록하여 429 에러를 우선 처리
  app.useGlobalFilters(
    new ThrottlerExceptionFilter(),
    new AllExceptionsFilter(),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 정의되지 않은 속성 제거
      forbidNonWhitelisted: true, // DTO에 없는 속성이 있으면 에러
      transform: true, // 요청 데이터를 DTO 인스턴스로 자동 변환
      transformOptions: {
        enableImplicitConversion: false, // 명시적 타입 변환만 허용 (보안 강화)
      },
      exceptionFactory: (errors: ValidationError[]) => {
        // Validation 에러를 사용자 친화적인 한글 메시지로 변환
        const firstError = errors[0];
        const field = firstError.property;
        const constraints = firstError.constraints || {};

        const message = getValidationMessage(field, constraints);
        const errorCode = getValidationErrorCode(field, constraints);

        return new BadRequestException({
          errorCode,
          message,
          details: {
            field,
            constraints: Object.keys(constraints),
            value: firstError.value as unknown,
          },
        });
      },
    }),
  );
  setupSwagger(app, configService);

  const corsOrigin = configService.get<string[]>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = configService.get<number>('PORT') ?? 8080;
  await app.listen(port, '0.0.0.0');
  logger.log(`LISTENING ${port}`);

  // Graceful shutdown handling
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} received, starting graceful shutdown...`);
    try {
      await app.close();
      logger.log('Application closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // Unhandled rejection/exception handling
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    void shutdown('UNCAUGHT_EXCEPTION');
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
