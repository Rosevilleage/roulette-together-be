import { Controller, Get, Logger, HttpStatus, Res } from '@nestjs/common';
import { MemoryHealthIndicator } from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
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
  check(@Res() res: Response) {
    // 즉시 응답 - 어떤 의존성도 체크하지 않음
    // @Res()를 사용하여 NestJS 응답 처리 파이프라인을 완전히 우회
    res.status(200).send('OK');
  }

  @Get('deps')
  @ApiOperation({ summary: '의존성 상태 체크 (Redis/Memory)' })
  @ApiResponse({ status: 200, description: '모든 의존성 정상' })
  @ApiResponse({ status: 503, description: '일부 의존성 비정상' })
  async deps(@Res() res: Response) {
    try {
      // 1초 타임아웃으로 직접 체크 (빠른 실패)
      const results = await Promise.race([
        Promise.all([
          this.redis.isHealthy('redis'),
          this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 1000),
        ),
      ]);

      return res.status(HttpStatus.OK).json({
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
      });
    } catch (error) {
      // 타임아웃이나 에러 발생시 503 응답
      this.logger.warn(
        `Health deps check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        info: {},
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        details: {},
      });
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (쿠버네티스)' })
  @ApiResponse({ status: 200, description: '서버가 실행 중' })
  liveness(@Res() res: Response) {
    // 즉시 응답 - 어떨 의존성도 체크하지 않음
    // @Res()를 사용하여 NestJS 응답 처리 파이프라인을 완전히 우회
    res.status(200).send('OK');
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (쿠버네티스)' })
  @ApiResponse({ status: 200, description: '서버가 요청을 처리할 준비 완료' })
  @ApiResponse({ status: 503, description: '서버가 요청을 처리할 준비가 안됨' })
  async readiness(@Res() res: Response) {
    try {
      // 1초 타임아웃으로 Redis 체크 (빠른 실패)
      const result = await Promise.race([
        this.redis.isHealthy('redis'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Readiness check timeout')), 1000),
        ),
      ]);

      return res.status(HttpStatus.OK).json({
        status: 'ok',
        info: { redis: result },
        error: {},
        details: { redis: result },
      });
    } catch (error) {
      // 타임아웃이나 에러 발생시 503 응답
      this.logger.warn(
        `Health readiness check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        info: {},
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        details: {},
      });
    }
  }
}
