# Phase 3: Medium Priority - 중간 우선순위 작업

> 🟡 **우선순위**: Medium
> **목표**: 성능 최적화 및 코드 품질 개선

---

## 3.1 긴 메서드 리팩토링

### 현재 상태
- `handleRoomJoin`: ~262줄 (너무 김)
- `getRooms`: ~170줄 (너무 김)
- 단일 책임 원칙 위반

### 목표
- 각 메서드 50줄 이내로 분리
- 명확한 단일 책임
- 테스트 용이성 향상

### 작업 항목

#### 3.1.1 handleRoomJoin 분리
- [ ] 역할별 핸들러 분리

```typescript
// src/modules/roulette/roulette.service.ts

// Before: 하나의 거대한 메서드
async handleRoomJoin(client: Socket, payload: RoomJoinDto) {
  // 262줄의 로직...
}

// After: 역할별로 분리
async handleRoomJoin(client: Socket, payload: RoomJoinDto) {
  const { roomId, role, nickname } = payload;

  const roomConfig = await this.validateRoom(roomId);
  if (!roomConfig) {
    return this.rejectJoin(client, 'ROOM_NOT_FOUND');
  }

  const result = role === 'owner'
    ? await this.handleOwnerJoin(client, roomId, nickname)
    : await this.handleParticipantJoin(client, roomId, nickname);

  if (!result.success) {
    return this.rejectJoin(client, result.reason);
  }

  await this.completeJoin(client, roomId, result);
}

private async validateRoom(roomId: string): Promise<RoomConfig | null> {
  return this.redisService.getRoomConfig(roomId);
}

private async handleOwnerJoin(
  client: Socket,
  roomId: string,
  nickname?: string,
): Promise<JoinResult> {
  // 방장 전용 로직 (~40줄)
  // - 토큰 검증
  // - 방장 등록
  // - 닉네임 설정
}

private async handleParticipantJoin(
  client: Socket,
  roomId: string,
  nickname?: string,
): Promise<JoinResult> {
  // 참가자 전용 로직 (~30줄)
  // - rid 생성
  // - 닉네임 자동 생성
}

private async completeJoin(
  client: Socket,
  roomId: string,
  result: JoinResult,
): Promise<void> {
  // 공통 완료 로직 (~30줄)
  // - 소켓 정보 저장
  // - 방 멤버 추가
  // - 이벤트 발송
}

private rejectJoin(client: Socket, reason: string): void {
  client.emit('room:join:rejected', { reason });
}
```

#### 3.1.2 getRooms 분리
- [ ] Controller 메서드 분리

```typescript
// src/modules/roulette/roulette.controller.ts

// Before
@Get()
async getRooms(@Req() req: Request): Promise<GetRoomsResponseDto> {
  // 170줄...
}

// After
@Get()
async getRooms(@Req() req: Request): Promise<GetRoomsResponseDto> {
  const ownerTokens = this.parseOwnerTokens(req);

  if (Object.keys(ownerTokens).length === 0) {
    return { rooms: [] };
  }

  const rooms = await this.fetchRoomsWithInfo(ownerTokens);
  return { rooms };
}

private parseOwnerTokens(req: Request): Record<string, string> {
  // 쿠키 파싱 로직 (~20줄)
}

private async fetchRoomsWithInfo(
  ownerTokens: Record<string, string>,
): Promise<RoomInfo[]> {
  const rooms: RoomInfo[] = [];

  for (const [roomId, token] of Object.entries(ownerTokens)) {
    const roomInfo = await this.fetchSingleRoomInfo(roomId, token);
    if (roomInfo) {
      rooms.push(roomInfo);
    }
  }

  return rooms;
}

private async fetchSingleRoomInfo(
  roomId: string,
  token: string,
): Promise<RoomInfo | null> {
  // 단일 방 정보 조회 (~40줄)
}
```

#### 3.1.3 헬퍼 메서드 추출
- [ ] 공통 유틸리티 함수 분리

```typescript
// src/modules/roulette/roulette.utils.ts
export function generateRid(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function generateDefaultNickname(role: 'owner' | 'participant', count?: number): string {
  return role === 'owner' ? '생성자' : `참가자 ${count}`;
}
```

### 완료 기준
- [ ] 각 메서드 50줄 이내
- [ ] private 헬퍼 메서드로 로직 분리
- [ ] 기존 테스트 통과

---

## 3.2 N+1 쿼리 패턴 해결

### 현재 상태
```typescript
// 문제: N+1 쿼리 패턴
for (const socketId of members) {
  const socketInfo = await this.redisService.getSocketInfo(socketId); // N번 호출
}
```

### 목표
- Redis 파이프라인으로 배치 조회
- 조회 횟수 N → 1로 감소

### 작업 항목

#### 3.2.1 배치 조회 메서드 추가
- [ ] RedisService에 배치 메서드 추가

```typescript
// src/common/redis/redis.service.ts

/**
 * 여러 소켓 정보를 한 번에 조회
 */
async getSocketInfoBatch(socketIds: string[]): Promise<Map<string, SocketInfo | null>> {
  if (socketIds.length === 0) {
    return new Map();
  }

  const pipeline = this.client.pipeline();
  socketIds.forEach((socketId) => {
    pipeline.get(`room:socket:${socketId}`);
  });

  const results = await pipeline.exec();
  const map = new Map<string, SocketInfo | null>();

  socketIds.forEach((socketId, index) => {
    const [err, data] = results![index];
    if (err || !data) {
      map.set(socketId, null);
    } else {
      map.set(socketId, JSON.parse(data as string));
    }
  });

  return map;
}

/**
 * 방 멤버와 정보를 한 번에 조회
 */
async getRoomMembersWithInfo(roomId: string): Promise<SocketInfo[]> {
  const members = await this.getRoomMembers(roomId);
  if (members.length === 0) {
    return [];
  }

  const infoMap = await this.getSocketInfoBatch(members);
  return Array.from(infoMap.values()).filter((info): info is SocketInfo => info !== null);
}
```

#### 3.2.2 서비스 메서드 수정
- [ ] 기존 N+1 코드 → 배치 조회로 변경

```typescript
// src/modules/roulette/roulette.service.ts

// Before
async broadcastParticipantsToOwner(roomId: string): Promise<void> {
  const members = await this.redisService.getRoomMembers(roomId);
  const participants = [];

  for (const socketId of members) {
    const socketInfo = await this.redisService.getSocketInfo(socketId); // N번
    if (socketInfo) {
      participants.push(socketInfo);
    }
  }
}

// After
async broadcastParticipantsToOwner(roomId: string): Promise<void> {
  const participants = await this.redisService.getRoomMembersWithInfo(roomId); // 1번
  // ...
}
```

#### 3.2.3 Controller 수정
- [ ] getRooms 메서드 최적화

```typescript
// src/modules/roulette/roulette.controller.ts

// 여러 방의 정보를 한 번에 조회
private async fetchRoomsWithInfo(roomIds: string[]): Promise<RoomInfo[]> {
  // 모든 방의 config를 파이프라인으로 조회
  const configs = await this.redisService.getRoomConfigBatch(roomIds);

  // 각 방의 멤버 정보도 최적화
  const roomsInfo = await Promise.all(
    roomIds.map(async (roomId) => {
      const config = configs.get(roomId);
      if (!config) return null;

      const members = await this.redisService.getRoomMembersWithInfo(roomId);
      return { roomId, config, members };
    })
  );

  return roomsInfo.filter(Boolean);
}
```

### 완료 기준
- [ ] 배치 조회 메서드 구현
- [ ] 기존 코드 배치 조회로 변경
- [ ] 성능 개선 확인 (Redis MONITOR로 검증)

---

## 3.3 Rate Limiting 추가

### 현재 상태
- API 요청 제한 없음
- DoS 공격에 취약

### 목표
- HTTP 및 WebSocket 요청 제한
- IP 기반 제한

### 작업 항목

#### 3.3.1 ThrottlerModule 설치
- [ ] 패키지 설치

```bash
pnpm add @nestjs/throttler
```

#### 3.3.2 전역 Rate Limiting 설정
- [ ] app.module.ts에 설정

```typescript
// src/app.module.ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,    // 1초
        limit: 10,    // 10 요청
      },
      {
        name: 'medium',
        ttl: 10000,   // 10초
        limit: 50,    // 50 요청
      },
      {
        name: 'long',
        ttl: 60000,   // 1분
        limit: 200,   // 200 요청
      },
    ]),
    // ...
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

#### 3.3.3 엔드포인트별 커스텀 제한
- [ ] 특정 엔드포인트 제한 강화

```typescript
// src/modules/roulette/roulette.controller.ts
import { Throttle, SkipThrottle } from '@nestjs/throttler';

@Controller('rooms')
export class RouletteController {
  // 방 생성은 더 엄격하게 제한
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 분당 5개
  async createRoom() {}

  // 조회는 기본 제한
  @Get()
  async getRooms() {}
}
```

#### 3.3.4 WebSocket Rate Limiting (선택)
- [ ] 커스텀 WebSocket throttler 구현

```typescript
// src/common/guards/ws-throttler.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class WsThrottlerGuard implements CanActivate {
  private readonly requestCounts = new Map<string, number[]>();
  private readonly limit = 30;  // 10초당 30 이벤트
  private readonly ttl = 10000;

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const clientId = client.id;
    const now = Date.now();

    const requests = this.requestCounts.get(clientId) || [];
    const recentRequests = requests.filter((time) => now - time < this.ttl);

    if (recentRequests.length >= this.limit) {
      client.emit('error:rate_limit', {
        message: 'Too many requests',
        retryAfter: Math.ceil((recentRequests[0] + this.ttl - now) / 1000),
      });
      return false;
    }

    recentRequests.push(now);
    this.requestCounts.set(clientId, recentRequests);
    return true;
  }
}
```

### 완료 기준
- [ ] HTTP 요청 제한 동작
- [ ] 429 Too Many Requests 응답 확인
- [ ] WebSocket 과다 요청 차단

---

## 3.4 요청 로깅 미들웨어

### 현재 상태
- HTTP 요청 로깅 없음
- 디버깅 어려움

### 목표
- 모든 HTTP 요청/응답 로깅
- 요청 시간 측정

### 작업 항목

#### 3.4.1 로깅 미들웨어 생성
- [ ] `src/common/middleware/logging.middleware.ts` 생성

```typescript
// src/common/middleware/logging.middleware.ts
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - startTime;
      const contentLength = res.get('content-length') || 0;

      const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log';

      this.logger[logLevel](
        `${method} ${originalUrl} ${statusCode} ${duration}ms ${contentLength}b - ${ip} "${userAgent}"`,
      );
    });

    next();
  }
}
```

#### 3.4.2 미들웨어 등록
- [ ] app.module.ts에 등록

```typescript
// src/app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggingMiddleware } from './common/middleware/logging.middleware';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
```

### 완료 기준
- [ ] 모든 HTTP 요청 로그 출력
- [ ] 요청 시간, 상태 코드 포함

---

## 체크리스트 요약

### 메서드 리팩토링 (3.1)
- [ ] handleRoomJoin 분리
- [ ] getRooms 분리
- [ ] 헬퍼 메서드 추출

### N+1 해결 (3.2)
- [ ] 배치 조회 메서드
- [ ] 서비스 메서드 수정
- [ ] Controller 최적화

### Rate Limiting (3.3)
- [ ] ThrottlerModule 설정
- [ ] 엔드포인트별 제한
- [ ] WebSocket 제한 (선택)

### 요청 로깅 (3.4)
- [ ] 로깅 미들웨어
- [ ] 미들웨어 등록

---

## 다음 단계

Phase 3 완료 후 → [Phase 4: Low Priority](phase-4-low.md)
