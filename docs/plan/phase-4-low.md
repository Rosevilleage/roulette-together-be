# Phase 4: Low Priority - 낮은 우선순위 작업

> 🟢 **우선순위**: Low
> **목표**: 문서화 완성 및 운영 기반 구축

---

## 4.1 DTO 문서화 완성

### 현재 상태
- 일부 DTO에 ApiProperty 누락
- maxLength 불일치 (RoomJoinDto: 50 vs 실제 검증: 20)

### 목표
- 모든 DTO에 Swagger 문서화
- 검증 규칙 일관성

### 작업 항목

#### 4.1.1 ReadyToggleDto 문서화
- [ ] ApiProperty 추가

```typescript
// src/modules/roulette/dto/ready-toggle.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ReadyToggleDto {
  @ApiProperty({
    description: '참가자의 room-scoped ID',
    example: 'participant_abc123def456',
  })
  @IsString()
  @IsNotEmpty()
  rid: string;
}
```

#### 4.1.2 RoomLeaveDto 문서화
- [ ] ApiProperty 추가

```typescript
// src/modules/roulette/dto/room-leave.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RoomLeaveDto {
  @ApiProperty({
    description: '방 ID',
    example: 'room_abc123',
  })
  @IsString()
  @IsNotEmpty()
  roomId: string;
}
```

#### 4.1.3 RoomJoinDto maxLength 수정
- [ ] nickname maxLength 일관성 확보

```typescript
// src/modules/roulette/dto/room-join.dto.ts
export class RoomJoinDto {
  @ApiPropertyOptional({
    description: '사용자 닉네임 (1-20자)',
    maxLength: 20,  // 50에서 20으로 수정
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)  // 실제 검증과 일치
  nickname?: string;
}
```

#### 4.1.4 응답 DTO 클래스화
- [ ] interface → class 변환

```typescript
// src/modules/roulette/dto/create-room-response.dto.ts

// Before: interface
export interface CreateRoomResponseDto {
  roomId: string;
  ownerUrl: string;
  participantUrl: string;
}

// After: class with decorators
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomResponseDto {
  @ApiProperty({ description: '생성된 방 ID', example: 'room_abc123' })
  roomId: string;

  @ApiProperty({ description: '방장용 URL', example: 'https://example.com/room/abc123?owner=true' })
  ownerUrl: string;

  @ApiProperty({ description: '참가자용 URL', example: 'https://example.com/room/abc123' })
  participantUrl: string;
}
```

### 완료 기준
- [ ] 모든 DTO에 ApiProperty 적용
- [ ] Swagger UI에서 모든 필드 설명 확인
- [ ] 검증 규칙 일관성 확보

---

## 4.2 Health Check 엔드포인트

### 현재 상태
- 헬스 체크 엔드포인트 없음
- Redis 연결 상태 확인 불가

### 목표
- `/health` 엔드포인트 제공
- Redis 연결 상태 포함
- 쿠버네티스/로드밸런서 호환

### 작업 항목

#### 4.2.1 Terminus 패키지 설치
- [ ] 패키지 설치

```bash
pnpm add @nestjs/terminus
```

#### 4.2.2 Health 모듈 생성
- [ ] `src/common/health/` 디렉토리 생성

```typescript
// src/common/health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
```

#### 4.2.3 Redis Health Indicator 구현
- [ ] 커스텀 헬스 인디케이터

```typescript
// src/common/health/redis.health.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const isConnected = await this.redisService.ping();

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
        this.getStatus(key, false, { message: error.message }),
      );
    }
  }
}
```

#### 4.2.4 RedisService에 ping 메서드 추가
- [ ] 연결 확인 메서드

```typescript
// src/common/redis/redis.service.ts
async ping(): Promise<boolean> {
  try {
    const result = await this.client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
```

#### 4.2.5 Health Controller 구현
- [ ] 헬스 체크 엔드포인트

```typescript
// src/common/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private redis: RedisHealthIndicator,
    private memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: '서버 헬스 체크' })
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (쿠버네티스)' })
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (쿠버네티스)' })
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
```

#### 4.2.6 AppModule에 등록
- [ ] HealthModule import

```typescript
// src/app.module.ts
import { HealthModule } from './common/health/health.module';

@Module({
  imports: [
    // ...
    HealthModule,
  ],
})
export class AppModule {}
```

### 완료 기준
- [ ] `GET /health` 응답 확인
- [ ] Redis 상태 포함
- [ ] `GET /health/live`, `GET /health/ready` 동작

---

## 4.3 인라인 코드 문서화

### 현재 상태
- 복잡한 로직에 주석 부족
- JSDoc 스타일 문서화 없음

### 목표
- 핵심 메서드에 JSDoc 추가
- 복잡한 알고리즘 설명

### 작업 항목

#### 4.3.1 RedisService 문서화
- [ ] 주요 메서드 JSDoc 추가

```typescript
// src/common/redis/redis.service.ts

/**
 * Redis 서비스
 *
 * 룰렛 게임의 모든 상태를 Redis에 저장하고 관리합니다.
 * - 방 설정 및 멤버 관리
 * - 소켓 정보 추적
 * - 분산 락 및 멱등성 키 관리
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {

  /**
   * 분산 락 획득
   *
   * @param roomId - 방 ID
   * @param value - 락 소유자 식별값 (해제 시 검증용)
   * @param ttlMs - 락 만료 시간 (밀리초)
   * @returns 락 획득 성공 여부
   *
   * @example
   * const acquired = await this.redisService.acquireLock('room123', 'spin_abc', 10000);
   * if (!acquired) {
   *   throw new AlreadySpinningException();
   * }
   */
  async acquireLock(roomId: string, value: string, ttlMs: number): Promise<boolean> {
    // ...
  }

  /**
   * Fisher-Yates 셔플을 사용하여 당첨자 선정
   *
   * @param participants - 참가자 ID 배열
   * @param count - 선정할 당첨자 수
   * @returns 선정된 당첨자 ID 배열
   *
   * @remarks
   * - 참가자 수보다 count가 크면 전체 참가자 반환
   * - 원본 배열을 수정하지 않음
   */
  selectRandom<T>(participants: T[], count: number): T[] {
    // ...
  }
}
```

#### 4.3.2 RouletteService 문서화
- [ ] 핵심 비즈니스 로직 설명

```typescript
// src/modules/roulette/roulette.service.ts

/**
 * 룰렛 게임 비즈니스 로직 서비스
 *
 * WebSocket 이벤트 처리 및 게임 로직을 담당합니다.
 *
 * @remarks
 * 방 참가 플로우:
 * 1. 방장: HTTP로 방 생성 → WebSocket 연결 → room:join (owner)
 * 2. 참가자: URL로 접근 → WebSocket 연결 → room:join (participant)
 *
 * 스핀 플로우:
 * 1. 모든 참가자 ready 상태
 * 2. 방장 spin:request
 * 3. 서버에서 당첨자 선정
 * 4. 결과 브로드캐스트
 */
@Injectable()
export class RouletteService {
  // ...
}
```

#### 4.3.3 복잡한 알고리즘 주석
- [ ] 특수 로직에 인라인 주석

```typescript
/**
 * 방장 입장 처리
 *
 * @remarks
 * 방장 인증 플로우:
 * 1. HTTP-only 쿠키에서 owner_token_{roomId} 추출
 * 2. Redis의 room:owner:token:{roomId}와 비교
 * 3. 불일치 시 INVALID_OWNER_TOKEN으로 거부
 *
 * 멱등성:
 * - 동일 토큰으로 재연결 시 기존 정보 복원
 * - 다른 브라우저/기기에서는 참가자로 입장
 */
private async handleOwnerJoin(...) {
  // 토큰 검증 - HTTP-only 쿠키 사용으로 XSS 방지
  const cookieToken = this.getOwnerTokenFromCookie(client, roomId);

  // Lua 스크립트로 원자적 방장 등록
  // SET NX를 사용하여 race condition 방지
  const registered = await this.redisService.setRoomOwner(roomId, rid);

  // ...
}
```

### 완료 기준
- [ ] 공개 메서드에 JSDoc 추가
- [ ] 복잡한 로직에 인라인 주석
- [ ] IDE에서 타입 힌트 및 문서 확인

---

## 4.4 모니터링 기반 구축

### 현재 상태
- 메트릭 수집 없음
- 성능 모니터링 불가

### 목표
- 기본 메트릭 노출
- Prometheus 호환 엔드포인트

### 작업 항목

#### 4.4.1 Prometheus 클라이언트 설치
- [ ] 패키지 설치

```bash
pnpm add prom-client
```

#### 4.4.2 메트릭 서비스 생성
- [ ] `src/common/metrics/metrics.service.ts` 생성

```typescript
// src/common/metrics/metrics.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;

  // HTTP 요청 메트릭
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;

  // WebSocket 메트릭
  readonly wsConnectionsActive: Gauge;
  readonly wsEventsTotal: Counter;

  // 비즈니스 메트릭
  readonly roomsActive: Gauge;
  readonly spinsTotal: Counter;

  constructor() {
    this.registry = new Registry();

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'path'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });

    this.wsConnectionsActive = new Gauge({
      name: 'ws_connections_active',
      help: 'Active WebSocket connections',
      registers: [this.registry],
    });

    this.wsEventsTotal = new Counter({
      name: 'ws_events_total',
      help: 'Total WebSocket events',
      labelNames: ['event'],
      registers: [this.registry],
    });

    this.roomsActive = new Gauge({
      name: 'rooms_active',
      help: 'Active rooms',
      registers: [this.registry],
    });

    this.spinsTotal = new Counter({
      name: 'spins_total',
      help: 'Total spins performed',
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
```

#### 4.4.3 메트릭 컨트롤러 생성
- [ ] `/metrics` 엔드포인트

```typescript
// src/common/metrics/metrics.controller.ts
import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiExcludeEndpoint() // Swagger에서 숨김
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
```

#### 4.4.4 메트릭 수집 통합
- [ ] 미들웨어 및 서비스에 메트릭 수집

```typescript
// src/common/middleware/metrics.middleware.ts
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = (Date.now() - startTime) / 1000;

      this.metrics.httpRequestsTotal.inc({
        method: req.method,
        path: req.route?.path || req.path,
        status: res.statusCode,
      });

      this.metrics.httpRequestDuration.observe(
        { method: req.method, path: req.route?.path || req.path },
        duration,
      );
    });

    next();
  }
}
```

### 완료 기준
- [ ] `/metrics` 엔드포인트 동작
- [ ] 기본 Node.js 메트릭 포함
- [ ] HTTP/WebSocket 커스텀 메트릭

---

## 4.5 API 버전 관리 (선택)

### 현재 상태
- API 버전 관리 없음

### 목표
- URI 버전 관리 (/v1/rooms)
- 하위 호환성 지원 준비

### 작업 항목

#### 4.5.1 버전 관리 활성화
- [ ] main.ts 설정

```typescript
// src/main.ts
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: '1',
});
```

#### 4.5.2 Controller 버전 적용
- [ ] 버전 데코레이터 추가

```typescript
// src/modules/roulette/roulette.controller.ts
@Controller({
  path: 'rooms',
  version: '1',
})
export class RouletteController {
  // GET /v1/rooms
  // POST /v1/rooms
}
```

### 완료 기준
- [ ] /v1/rooms 경로 동작
- [ ] 버전 없는 요청 기본 버전 처리

---

## 체크리스트 요약

### DTO 문서화 (4.1)
- [ ] ReadyToggleDto 문서화
- [ ] RoomLeaveDto 문서화
- [ ] RoomJoinDto maxLength 수정
- [ ] 응답 DTO 클래스화

### Health Check (4.2)
- [ ] Terminus 설치
- [ ] Health 모듈 생성
- [ ] Redis Health Indicator
- [ ] Health Controller

### 코드 문서화 (4.3)
- [ ] RedisService JSDoc
- [ ] RouletteService JSDoc
- [ ] 인라인 주석 추가

### 모니터링 (4.4)
- [ ] Prometheus 클라이언트
- [ ] 메트릭 서비스
- [ ] 메트릭 컨트롤러

### API 버전 관리 (4.5) - 선택
- [ ] 버전 관리 활성화
- [ ] Controller 버전 적용

---

## 완료 후

모든 Phase 완료 시:
- NestJS 베스트 프랙티스 점수: 6.5/10 → 9/10 목표
- 프로덕션 배포 준비 완료
- 유지보수성 및 확장성 확보

---

## 부록: 권장 도구 및 라이브러리

| 카테고리 | 패키지 | 용도 |
|---------|--------|------|
| 테스트 | jest, @nestjs/testing | 단위/통합 테스트 |
| 테스트 | supertest | HTTP 테스트 |
| 테스트 | socket.io-client | WebSocket 테스트 |
| 보안 | @nestjs/throttler | Rate limiting |
| 보안 | helmet | 보안 헤더 |
| 모니터링 | @nestjs/terminus | Health check |
| 모니터링 | prom-client | Prometheus 메트릭 |
| 로깅 | winston (선택) | 고급 로깅 |
