import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('Health')
@Controller({
  path: 'health',
  version: '',
})
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private redis: RedisHealthIndicator,
    private memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ALB 헬스체크 (항상 200)' })
  @ApiResponse({ status: 200, description: '서버가 실행 중' })
  check() {
    return { ok: true };
  }

  @Get('deps')
  @ApiOperation({ summary: '의존성 상태 체크 (Redis/Memory)' })
  @ApiResponse({ status: 200, description: '모든 의존성 정상' })
  @ApiResponse({ status: 503, description: '일부 의존성 비정상' })
  @HealthCheck()
  deps() {
    return this.health.check([
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (쿠버네티스)' })
  @ApiResponse({ status: 200, description: '서버가 실행 중' })
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (쿠버네티스)' })
  @ApiResponse({ status: 200, description: '서버가 요청을 처리할 준비 완료' })
  @ApiResponse({ status: 503, description: '서버가 요청을 처리할 준비가 안됨' })
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.redis.isHealthy('redis')]);
  }
}
