# Redis 모듈 명세서

## 개요

Redis를 활용한 분산 데이터 저장, 캐싱, pub/sub 기능을 제공하는 공통 모듈입니다.
Socket.io Redis Adapter와 룰렛 게임 상태 관리를 위한 추상화 계층을 제공합니다.

## 모듈 구조

### 파일 구성

```
redis/
├── redis.module.ts     # 모듈 정의 (@Global)
└── redis.service.ts    # Redis 클라이언트 및 메서드
```

### 특징

- **Global Module**: 애플리케이션 전역에서 import 없이 사용 가능
- **다중 클라이언트**: client, subscriber, publisher 분리
- **자동 재연결**: 지수 백오프 전략 (50ms~2000ms)

---

## 주요 컴포넌트

### 1. RedisModule

전역 모듈로 설정되어 있어 다른 모듈에서 `RedisService`를 자동으로 주입받을 수 있습니다.

**데코레이터**: `@Global()`

**Export**: `RedisService`

---

### 2. RedisService

Redis 작업을 위한 서비스 계층입니다.

#### 라이프사이클 훅

##### `onModuleInit()`

**기능**: 모듈 초기화 시 Redis 클라이언트 생성 및 연결 대기

**처리 흐름**:

1. 환경변수에서 Redis URL 읽기 (기본: `redis://localhost:6379`)
2. 3개의 Redis 클라이언트 생성:
   - `client`: 일반 작업용
   - `subscriber`: Socket.io pub/sub (구독)
   - `publisher`: Socket.io pub/sub (발행)
3. 재연결 전략 설정 (지수 백오프)
4. 모든 클라이언트가 'ready' 상태가 될 때까지 대기

**재연결 전략**:

```typescript
retryStrategy: (times) => {
  const delay = Math.min(times * 50, 2000);
  return delay;
};
```

- 1회: 50ms
- 2회: 100ms
- ...
- 40회 이상: 2000ms (최대)

---

##### `onModuleDestroy()`

**기능**: 모듈 종료 시 모든 Redis 연결 정리

**처리**:

```typescript
await this.client.quit();
await this.subscriber.quit();
await this.publisher.quit();
```

---

#### 클라이언트 접근자

##### `getClient(): Redis`

일반 Redis 작업용 클라이언트 반환

##### `getSubscriber(): Redis`

Socket.io 어댑터용 구독 클라이언트 반환

##### `getPublisher(): Redis`

Socket.io 어댑터용 발행 클라이언트 반환

---

#### 방(Room) 설정 관리

##### `getRoomConfig(roomId: string): Promise<RoomConfig | null>`

**기능**: 방 설정 조회

**반환**:

```typescript
{
  winnersCount: number; // 승자 수
  winSentiment: 'POSITIVE' | 'NEGATIVE'; // 승리 감정
  updatedAt: number; // 업데이트 시각 (Unix ms)
}
```

**Redis 키**: `room:config:{roomId}`

**TTL**: 2시간

---

##### `setRoomConfig(roomId: string, config: RoomConfig): Promise<void>`

**기능**: 방 설정 저장

**저장 형식**: JSON 문자열

**Redis 명령**:

```
SET room:config:{roomId} {json} EX 7200
```

---

#### 방장 관리

##### `getRoomOwner(roomId: string): Promise<string | null>`

**기능**: 방장 rid 조회

**반환**: 방장의 rid 또는 null

**Redis 키**: `room:owner:{roomId}`

---

##### `setRoomOwner(roomId: string, rid: string): Promise<boolean>`

**기능**: 방장 설정 (최초 1회만 성공)

**Redis 명령**:

```
SET room:owner:{roomId} {rid} EX 7200 NX
```

**반환**:

- `true`: 방장 설정 성공 (최초)
- `false`: 이미 방장 존재 (NX 실패)

**특징**: Redis의 NX (Not eXists) 플래그로 원자적 방장 선정

---

#### 방 멤버 관리

##### `addRoomMember(roomId: string, socketId: string): Promise<void>`

**기능**: 방에 소켓 추가

**Redis 명령**:

```
SADD room:members:{roomId} {socketId}
```

---

##### `removeRoomMember(roomId: string, socketId: string): Promise<void>`

**기능**: 방에서 소켓 제거

**Redis 명령**:

```
SREM room:members:{roomId} {socketId}
```

---

##### `getRoomMembers(roomId: string): Promise<string[]>`

**기능**: 방의 모든 소켓 ID 목록 조회

**Redis 명령**:

```
SMEMBERS room:members:{roomId}
```

**반환**: 소켓 ID 배열

---

#### 소켓 정보 관리

##### `setSocketInfo(socketId: string, info: SocketInfo): Promise<void>`

**기능**: 소켓 정보 저장

**저장 데이터**:

```typescript
{
  roomId: string; // 참가 중인 방 ID
  rid: string; // 유저 ID (방 내에서만 유효)
  nickname: string; // 닉네임
  role: 'owner' | 'participant'; // 역할
  lastSeen: number; // 마지막 활동 시각 (Unix ms)
}
```

**Redis 키**: `room:socket:{socketId}`

**TTL**: 2시간

---

##### `getSocketInfo(socketId: string): Promise<SocketInfo | null>`

**기능**: 소켓 정보 조회

**반환**: SocketInfo 객체 또는 null

---

##### `removeSocketInfo(socketId: string): Promise<void>`

**기능**: 소켓 정보 삭제

**Redis 명령**:

```
DEL room:socket:{socketId}
```

---

#### 분산 락 (Spin Lock)

##### `acquireSpinLock(roomId: string, spinId: string, ttlMs: number): Promise<boolean>`

**기능**: 스핀 실행 분산 락 획득

**Redis 명령**:

```
SET lock:spin:{roomId} {spinId} PX {ttlMs} NX
```

**반환**:

- `true`: 락 획득 성공
- `false`: 이미 락 존재 (다른 스핀 진행 중)

**파라미터**:

- `ttlMs`: 락 타임아웃 (밀리초, 일반적으로 10000 = 10초)

**용도**: 동시 스핀 요청 방지

---

##### `releaseSpinLock(roomId: string, spinId: string): Promise<void>`

**기능**: 스핀 실행 분산 락 해제

**구현**: Lua 스크립트로 안전한 락 해제

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

**특징**:

- spinId 일치 시에만 해제 (다른 스핀의 락 해제 방지)
- 원자적 연산 (race condition 방지)

---

#### 멱등성 관리

##### `checkIdempotency(roomId: string, requestId: string): Promise<string | null>`

**기능**: 이미 처리된 요청인지 확인

**반환**:

- `string`: 이미 처리됨 (기존 spinId 반환)
- `null`: 신규 요청

**Redis 키**: `idem:spin:{roomId}:{requestId}`

---

##### `setIdempotency(roomId: string, requestId: string, spinId: string): Promise<void>`

**기능**: 요청 처리 완료 기록

**Redis 명령**:

```
SET idem:spin:{roomId}:{requestId} {spinId} EX 30
```

**TTL**: 30초 (짧은 시간 내 중복 요청 방지용)

---

#### 방 상태 관리

##### `getRoomState(roomId: string): Promise<RoomState | null>`

**기능**: 방의 현재 상태 조회

**반환**:

```typescript
{
  lastSpin?: {
    spinId: string;         // 마지막 스핀 ID
    resultSummary?: string; // 결과 요약 (선택)
    decidedAt: number;      // 결정 시각 (Unix ms)
  }
}
```

**Redis 키**: `room:state:{roomId}`

---

##### `setRoomState(roomId: string, state: RoomState): Promise<void>`

**기능**: 방 상태 업데이트

**TTL**: 2시간

---

#### 방 토큰 관리

##### `setRoomOwnerToken(roomId: string, token: string): Promise<void>`

**기능**: 방장 인증 토큰 저장

**Redis 명령**:

```
SET room:owner:token:{roomId} {token} EX 7200
```

**Redis 키**: `room:owner:token:{roomId}`

**TTL**: 2시간

**용도**: HTTP API로 방 생성 시 발급된 토큰 저장

---

##### `verifyRoomOwnerToken(roomId: string, token: string): Promise<boolean>`

**기능**: 방장 토큰 검증

**반환**:

- `true`: 토큰 일치
- `false`: 토큰 불일치 또는 없음

**용도**: 프론트엔드에서 방장 권한 확인용 (선택적 사용)

---

##### `setInitialOwnerNickname(roomId: string, nickname: string): Promise<void>`

**기능**: 방장 초기 닉네임 저장 (방 생성 시)

**Redis 명령**:

```
SET room:owner:initial-nickname:{roomId} {nickname} EX 7200
```

**Redis 키**: `room:owner:initial-nickname:{roomId}`

**TTL**: 2시간

**용도**: 방 생성 시 지정한 방장 닉네임을 저장하여, 방 입장 시 닉네임이 없으면 사용

---

##### `getInitialOwnerNickname(roomId: string): Promise<string | null>`

**기능**: 방장 초기 닉네임 조회

**반환**:

- 저장된 닉네임 문자열
- `null`: 저장된 닉네임이 없음

---

##### `removeInitialOwnerNickname(roomId: string): Promise<void>`

**기능**: 방장 초기 닉네임 삭제

**Redis 명령**:

```
DEL room:owner:initial-nickname:{roomId}
```

**용도**: 방장이 방에 입장하여 닉네임을 사용한 후 삭제

---

#### 참가자 카운터 관리

##### `getNextParticipantNumber(roomId: string): Promise<number>`

**기능**: 다음 참가자 번호 조회 및 증가

**Redis 명령**:

```
INCR room:participant:counter:{roomId}
EXPIRE room:participant:counter:{roomId} 7200
```

**반환**: 증가된 카운터 값 (1부터 시작)

**Redis 키**: `room:participant:counter:{roomId}`

**TTL**: 2시간

**용도**: 닉네임이 없는 참가자에게 "참가자 N" 자동 생성

**예시**:

```typescript
const num = await getNextParticipantNumber('room-123'); // 1
const nickname = `참가자 ${num}`; // "참가자 1"
```

---

#### 참가자 준비 상태 관리 (v2.1)

##### `setParticipantReady(roomId: string, socketId: string): Promise<void>`

**기능**: 참가자를 준비 완료 상태로 설정

**Redis 명령**:

```
SADD room:ready:{roomId} {socketId}
```

**Redis 키**: `room:ready:{roomId}`

**타입**: Set

**용도**: 참가자가 준비 완료 버튼을 누를 때 사용

---

##### `removeParticipantReady(roomId: string, socketId: string): Promise<void>`

**기능**: 참가자의 준비 상태 해제

**Redis 명령**:

```
SREM room:ready:{roomId} {socketId}
```

**용도**: 참가자가 준비 취소 버튼을 누르거나 방을 나갈 때 사용

---

##### `getReadyParticipants(roomId: string): Promise<string[]>`

**기능**: 준비 완료한 참가자 소켓 ID 목록 조회

**Redis 명령**:

```
SMEMBERS room:ready:{roomId}
```

**반환**: 준비 완료한 참가자의 소켓 ID 배열

**용도**: 모든 참가자가 준비되었는지 확인할 때 사용

---

#### 닉네임 업데이트 (v2.1)

##### `updateSocketNickname(socketId: string, nickname: string): Promise<void>`

**기능**: 기존 소켓 정보의 닉네임 업데이트

**처리 흐름**:

1. `getSocketInfo(socketId)` 호출하여 기존 정보 조회
2. `nickname` 필드 업데이트
3. `setSocketInfo(socketId, updatedInfo)` 호출하여 저장

**용도**: 방 입장 후 닉네임 변경 시 사용

---

## 데이터 타입

### RoomConfig

```typescript
interface RoomConfig {
  winnersCount: number; // 승자 수
  winSentiment: 'POSITIVE' | 'NEGATIVE'; // 승리 감정
  updatedAt: number; // 업데이트 시각
}
```

### RoomState

```typescript
interface RoomState {
  lastSpin?: {
    spinId: string; // 스핀 ID
    resultSummary?: string; // 결과 요약
    decidedAt: number; // 결정 시각
  };
}
```

### SocketInfo

```typescript
interface SocketInfo {
  roomId: string; // 참가 중인 방
  rid: string; // 유저 ID (방 내에서만 유효)
  nickname: string; // 닉네임
  role: 'owner' | 'participant'; // 역할
  lastSeen: number; // 마지막 활동
}
```

---

## Redis 키 네이밍 규칙

| 키 패턴                                | 타입          | 설명                            | TTL    |
| -------------------------------------- | ------------- | ------------------------------- | ------ |
| `room:config:{roomId}`                 | String (JSON) | 방 설정                         | 2시간  |
| `room:owner:{roomId}`                  | String        | 방장 rid                        | 2시간  |
| `room:owner:token:{roomId}`            | String        | 방장 인증 토큰                  | 2시간  |
| `room:owner:initial-nickname:{roomId}` | String        | 방장 초기 닉네임 (방 생성 시)   | 2시간  |
| `room:participant:counter:{roomId}`    | Number        | 참가자 번호 카운터              | 2시간  |
| `room:members:{roomId}`                | Set           | 방 멤버 소켓 ID 목록            | 없음\* |
| `room:socket:{socketId}`               | String (JSON) | 소켓 정보 (nickname, role 포함) | 2시간  |
| `room:state:{roomId}`                  | String (JSON) | 방 상태                         | 2시간  |
| `room:ready:{roomId}`                  | Set           | 준비 완료한 참가자 소켓 ID 목록 | 없음\* |
| `lock:spin:{roomId}`                   | String        | 스핀 분산 락                    | 10초   |
| `idem:spin:{roomId}:{requestId}`       | String        | 멱등성 키                       | 30초   |

**참고**: `room:members:{roomId}`는 TTL이 없지만, 소켓 연결 종료 시 멤버가 제거됩니다.

---

## 설정 가능한 환경 변수

| 변수 명     | 설명           | 기본값                   | 필수 |
| ----------- | -------------- | ------------------------ | ---- |
| `REDIS_URL` | Redis 연결 URL | `redis://localhost:6379` | 선택 |

**URL 형식**:

```
redis://[:password@]host[:port][/db]
redis://localhost:6379
redis://:password123@redis.example.com:6380/0
```

---

## 동시성 및 분산 처리

### 분산 락

- **구현**: Redis SET NX PX
- **용도**: 스핀 동시 실행 방지
- **타임아웃**: 10초 (configurable)
- **안전한 해제**: Lua 스크립트로 소유권 검증

### 멱등성 보장

- **키**: `{roomId}:{requestId}`
- **TTL**: 30초
- **효과**: 네트워크 재시도 시 중복 처리 방지

### 원자적 연산

- **방장 선정**: SET NX (최초 1회만 성공)
- **락 해제**: Lua 스크립트 (원자적 조건부 삭제)

---

## 연결 관리

### 재연결 전략

- **방식**: 지수 백오프 (exponential backoff)
- **초기 지연**: 50ms
- **최대 지연**: 2000ms
- **무한 재시도**: 연결 성공까지 계속 재시도

### 연결 상태

- **초기화 시**: 모든 클라이언트 'ready' 상태 대기
- **게이트웨이 초기화**: 최대 50회 재시도 (100ms 간격)

### 에러 처리

- Redis 연결 실패 시 재연결 시도
- 명령 실패 시 예외 발생 (호출자가 처리)

---

## 성능 고려사항

### TTL 설정

- **짧은 TTL** (30초): 멱등성 키 (단기 중복 방지)
- **중간 TTL** (10초): 분산 락 (스핀 진행 시간)
- **긴 TTL** (2시간): 방 데이터 (사용자 활동 시간)

### 데이터 타입 선택

- **String**: 단순 값, JSON 객체
- **Set**: 멤버 목록 (중복 제거, 빠른 조회)

### 최적화 팁

- JSON 직렬화 최소화 (필요시만 저장)
- Set 대신 Sorted Set 사용 고려 (순서 필요 시)
- Pipeline 사용 고려 (다중 명령 시)

---

## 확장성

### 수평 확장

- Redis 클러스터 지원 (URL만 변경)
- Redis Sentinel 지원 (고가용성)

### 멀티 인스턴스

- pub/sub 클라이언트로 Socket.io 동기화
- 분산 락으로 동시성 제어

---

## 장애 대응

### Redis 다운 시

- 자동 재연결 시도
- 재연결 실패 시 애플리케이션 서비스 중단

### 락 타임아웃

- 스핀 락: 10초 후 자동 해제
- 처리 실패 시에도 락 만료로 복구

### 데이터 손실

- 모든 데이터에 TTL 설정 (메모리 누수 방지)
- 중요 데이터는 재생성 가능하도록 설계

---

## 모니터링

### 권장 메트릭

- Redis 연결 상태
- 명령 실행 시간 (latency)
- 메모리 사용량
- 락 대기 시간
- 멱등성 히트율

### 로깅

- 연결/재연결 이벤트
- 락 획득/해제
- 명령 실패

---

## 주요 변경사항 (v2.0)

### ✅ 추가된 기능

- [x] 방장 토큰 관리 (`setRoomOwnerToken`, `verifyRoomOwnerToken`)
- [x] 방장 초기 닉네임 관리 (`setInitialOwnerNickname`, `getInitialOwnerNickname`, `removeInitialOwnerNickname`)
- [x] 참가자 카운터 (`getNextParticipantNumber`)
- [x] 참가자 준비 상태 관리 (`setParticipantReady`, `removeParticipantReady`, `getReadyParticipants`)
- [x] 닉네임 업데이트 (`updateSocketNickname`)
- [x] SocketInfo에 nickname, role 필드 추가

### 변경된 데이터 구조

**SocketInfo (이전)**:

```typescript
{
  roomId: string;
  rid: string;
  lastSeen: number;
}
```

**SocketInfo (현재)**:

```typescript
{
  roomId: string;
  rid: string;
  nickname: string;
  role: 'owner' | 'participant';
  lastSeen: number;
}
```

### rid 역할 변경

- **이전**: 쿠키 기반 세션 ID (전역 유저 식별)
- **현재**: WebSocket 연결 시 생성되는 임의 ID (방 내에서만 유저 구분)

---

## 향후 개선 사항

- [ ] Pipeline 지원으로 성능 최적화
- [ ] Redis 클러스터 명시적 지원
- [ ] 락 타임아웃 설정 가능하게
- [ ] 커넥션 풀 설정 옵션
- [ ] 헬스체크 엔드포인트
- [ ] 메트릭 수집 및 export
- [ ] TTL 설정 외부화 (config)
- [ ] 키 prefix 설정 가능하게

---

## 사용 예시

### 다른 서비스에서 주입

```typescript
@Injectable()
export class MyService {
  constructor(private readonly redisService: RedisService) {}

  async doSomething() {
    const config = await this.redisService.getRoomConfig('room-123');
    // ...
  }
}
```

### 분산 락 패턴

```typescript
const lockAcquired = await this.redisService.acquireSpinLock(
  roomId,
  spinId,
  10000,
);

if (!lockAcquired) {
  throw new Error('Already spinning');
}

try {
  // 임계 영역 (critical section)
  await this.doSomething();
} finally {
  await this.redisService.releaseSpinLock(roomId, spinId);
}
```

### 멱등성 체크 패턴

```typescript
const existingSpinId = await this.redisService.checkIdempotency(
  roomId,
  requestId,
);

if (existingSpinId) {
  throw new Error('Already processed');
}

const spinId = generateSpinId();
await this.redisService.setIdempotency(roomId, requestId, spinId);
// 요청 처리...
```

---

## 테스트 가이드

### 단위 테스트

- Mock Redis 클라이언트 사용
- ioredis-mock 라이브러리 활용

### 통합 테스트

- Docker로 실제 Redis 컨테이너 실행
- Testcontainers 사용 권장

### 테스트 예시

```typescript
describe('RedisService', () => {
  let service: RedisService;
  let redisContainer: StartedTestContainer;

  beforeAll(async () => {
    // Testcontainers로 Redis 시작
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();

    process.env.REDIS_URL = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    const module = await Test.createTestingModule({
      providers: [RedisService],
    }).compile();

    service = module.get<RedisService>(RedisService);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    await redisContainer.stop();
  });

  it('should acquire and release lock', async () => {
    const acquired = await service.acquireSpinLock('room-1', 'spin-1', 5000);
    expect(acquired).toBe(true);

    const acquiredAgain = await service.acquireSpinLock(
      'room-1',
      'spin-2',
      5000,
    );
    expect(acquiredAgain).toBe(false);

    await service.releaseSpinLock('room-1', 'spin-1');

    const acquiredAfterRelease = await service.acquireSpinLock(
      'room-1',
      'spin-2',
      5000,
    );
    expect(acquiredAfterRelease).toBe(true);
  });
});
```
