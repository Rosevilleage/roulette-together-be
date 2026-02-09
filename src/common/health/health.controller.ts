import { Controller, Get, Logger } from '@nestjs/common';
import { MemoryHealthIndicator } from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('Health')
@Controller({
  path: 'health',
  version: '',
})
@SkipThrottle() // 헬스체크는 스로틀링 제외
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private redis: RedisHealthIndicator,
    private memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ALB 헬스체크 (항상 200)' })
  @ApiResponse({ status: 200, description: '서버가 실행 중' })
  check() {
    // 로그 제거 - 헬스체크는 매우 빈번하게 호출되므로 로깅 생략
    return { ok: true };
  }

  @Get('deps')
  @ApiOperation({ summary: '의존성 상태 체크 (Redis/Memory)' })
  @ApiResponse({ status: 200, description: '모든 의존성 정상' })
  @ApiResponse({ status: 503, description: '일부 의존성 비정상' })
  async deps() {
    try {
      // 2초 타임아웃으로 직접 체크
      const results = await Promise.race([
        Promise.all([
          this.redis.isHealthy('redis'),
          this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 2000),
        ),
      ]);

      return {
        status: 'ok',
        info: {
          redis: results[0],
          memory: results[1],
        },
        error: {},
        details: {
          redis: results[0],
          memory: results[1],
        },
      };
    } catch (error) {
      // 타임아웃이나 에러 발생시 503 응답
      return {
        status: 'error',
        info: {},
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        details: {},
      };
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (쿠버네티스)' })
  @ApiResponse({ status: 200, description: '서버가 실행 중' })
  liveness() {
    // 로그 제거 - 헬스체크는 매우 빈번하게 호출되므로 로깅 생략
    // 무조건 즉시 응답 - 어떤 의존성도 체크하지 않음
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (쿠버네티스)' })
  @ApiResponse({ status: 200, description: '서버가 요청을 처리할 준비 완료' })
  @ApiResponse({ status: 503, description: '서버가 요청을 처리할 준비가 안됨' })
  async readiness() {
    try {
      // 2초 타임아웃으로 Redis 체크
      const result = await Promise.race([
        this.redis.isHealthy('redis'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Readiness check timeout')), 2000),
        ),
      ]);

      return {
        status: 'ok',
        info: { redis: result },
        error: {},
        details: { redis: result },
      };
    } catch (error) {
      // 타임아웃이나 에러 발생시 503 응답
      return {
        status: 'error',
        info: {},
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        details: {},
      };
    }
  }
}
