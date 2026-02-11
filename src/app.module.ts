import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './common/config/env.validation';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { HealthModule } from './common/health/health.module';
import { MetricsModule } from './common/metrics/metrics.module';
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
    ThrottlerModule.forRoot({
      throttlers: [
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
      ],
      // Use in-memory storage (default) instead of Redis
      // This prevents health check hangs when Redis is unavailable
      // For multi-instance deployments, consider using Redis storage with proper timeouts
      // storage: new ThrottlerStorageRedisService(redisUrl),
    }),
    RedisModule,
    HealthModule,
    MetricsModule,
    RouletteModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard, // Custom guard that skips /health* and /metrics*
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
