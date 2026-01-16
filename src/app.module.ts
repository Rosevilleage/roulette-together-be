import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validate } from './common/config/env.validation';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { RedisModule } from './common/redis/redis.module';
import { RouletteModule } from './modules/roulette/roulette.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1초
        limit: 10, // 10 요청
      },
      {
        name: 'medium',
        ttl: 10000, // 10초
        limit: 50, // 50 요청
      },
      {
        name: 'long',
        ttl: 60000, // 1분
        limit: 200, // 200 요청
      },
    ]),
    RedisModule,
    RouletteModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
