import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // 1초 타임아웃으로 Redis ping 수행
      const pingPromise = this.ping();
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timeout')), 1000),
      );

      const isConnected = await Promise.race([pingPromise, timeoutPromise]);

      if (isConnected) {
        return this.getStatus(key, true, { message: 'Redis is connected' });
      }

      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: 'Redis is not connected' }),
      );
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  }

  private async ping(): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const result = await client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
