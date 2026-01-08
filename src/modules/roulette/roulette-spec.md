# Roulette 모듈 명세서

## 개요

룰렛 게임의 핵심 기능을 제공하는 WebSocket 기반 실시간 멀티플레이어 모듈입니다.
방(Room) 생성, 참가, 설정, 룰렛 회전 및 결과 처리를 담당합니다.

## 모듈 구조

### 파일 구성

```
roulette/
├── roulette.module.ts       # 모듈 정의
├── roulette.gateway.ts      # WebSocket 게이트웨이
├── roulette.service.ts      # 비즈니스 로직
└── dto/
    ├── room-join.dto.ts           # 방 입장 요청
    ├── room-config-set.dto.ts     # 방 설정 변경 요청
    └── spin-request.dto.ts        # 룰렛 회전 요청
```

### 의존성

- **SessionModule**: 세션(rid) 검증
- **RedisModule**: 분산 상태 관리 및 pub/sub

---

## 주요 컴포넌트

### 1. RouletteGateway

WebSocket 연결 및 메시지 처리를 담당하는 게이트웨이입니다.

#### 연결 관리

- **CORS 설정**: 환경변수 `CORS_ORIGIN` 또는 전체 허용
- **Redis Adapter**: Socket.io의 멀티 인스턴스 지원을 위한 Redis 어댑터 설정
- **인증**: 쿠키의 `rid` 검증 (SessionService 활용)

#### 라이프사이클 훅

- `afterInit()`: Redis pub/sub 클라이언트 초기화 및 어댑터 설정 (최대 50회 재시도, 100ms 간격)
- `handleConnection()`: 연결 시 쿠키에서 `rid` 추출 및 검증, 실패 시 연결 종료
- `handleDisconnect()`: 연결 종료 시 방 멤버 제거 및 소켓 정보 삭제

#### WebSocket 이벤트 핸들러

| 이벤트 명         | 설명                         | DTO                |
| ----------------- | ---------------------------- | ------------------ |
| `room:join`       | 방 입장 요청                 | `RoomJoinDto`      |
| `room:config:set` | 방 설정 변경 (방장만 가능)   | `RoomConfigSetDto` |
| `spin:request`    | 룰렛 회전 요청 (방장만 가능) | `SpinRequestDto`   |

---

### 2. RouletteService

룰렛 게임의 핵심 비즈니스 로직을 처리합니다.

#### 주요 메서드

##### `handleRoomJoin(socket, data)`

**기능**: 사용자가 방에 입장할 때 처리

**처리 흐름**:

1. `roomId` 및 `rid` 유효성 검증
2. Socket.io 방에 소켓 추가
3. Redis에 방 멤버 추가 (`room:members:{roomId}`)
4. Redis에 소켓 정보 저장 (`room:socket:{socketId}`)
5. 첫 입장자인 경우 방장으로 설정 (Redis NX 플래그 활용)
6. 기본 방 설정 초기화 (없는 경우)
7. 클라이언트에 응답 전송:
   - `room:joined`: 입장 완료 (isOwner 포함)
   - `room:config`: 현재 방 설정
   - `room:state`: 마지막 스핀 정보 (있는 경우)

**기본 방 설정**:

- `winnersCount`: 1
- `winSentiment`: 'POSITIVE'

---

##### `handleRoomConfigSet(socket, data, server)`

**기능**: 방장이 방 설정을 변경

**처리 흐름**:

1. `rid` 검증
2. `winnersCount` 유효성 검증 (1 이상)
3. 방장 권한 확인 (Redis에서 `room:owner:{roomId}` 조회)
4. 설정 업데이트 (Redis)
5. 방 전체에 브로드캐스트: `room:config`

**실패 시 응답**: `room:config:rejected`

- `INVALID`: winnersCount < 1
- `NOT_OWNER`: 방장이 아님

---

##### `handleSpinRequest(socket, data, server)`

**기능**: 룰렛 회전 요청 및 결과 생성

**처리 흐름**:

1. `rid` 및 방장 권한 검증
2. 멱등성(Idempotency) 체크 (`requestId` 기반, 30초 TTL)
3. 분산 락 획득 (`lock:spin:{roomId}`, 10초 TTL)
4. 활성 멤버 조회 (Redis에서 소켓 정보 검증)
5. 승자 선택 (Fisher-Yates 셔플 알고리즘)
6. 이벤트 브로드캐스트:
   - `spin:resolved`: 전체 방에 룰렛 시작 알림 (애니메이션 정보 포함)
   - `spin:outcome`: 각 참가자에게 개별 결과 (WIN/LOSE)
7. 방 상태 업데이트 (마지막 스핀 정보)
8. 분산 락 해제

**타이밍**:

- `decidedAt`: 결정 시각
- `revealAt`: 결과 공개 시각 (decidedAt + 2초)
- `durationMs`: 애니메이션 길이 (3초)

**실패 시 응답**: `spin:rejected`

- `NOT_OWNER`: 방장이 아님
- `IDEMPOTENT_REPLAY`: 중복 요청
- `ALREADY_SPINNING`: 이미 스핀 진행 중
- `NO_MEMBERS`: 참가자 없음
- `ROOM_NOT_FOUND`: 방 설정 없음

**분산 락**: Lua 스크립트로 안전한 락 해제 (spinId 일치 시에만)

---

##### `handleDisconnect(socket)`

**기능**: 연결 종료 시 정리 작업

**처리 흐름**:

1. 소켓 정보 조회
2. 방 멤버에서 제거
3. 소켓 정보 삭제

---

##### `selectRandom<T>(array, count)` (private)

**기능**: Fisher-Yates 셔플 알고리즘으로 무작위 승자 선택

**반환**: 배열에서 무작위로 선택된 `count`개의 요소

---

## 데이터 구조

### DTO

#### RoomJoinDto

```typescript
{
  roomId: string;        // 방 ID
  nickname?: string;     // 닉네임 (선택, 현재 미사용)
}
```

#### RoomConfigSetDto

```typescript
{
  roomId: string; // 방 ID
  winnersCount: number; // 승자 수 (>= 1)
  winSentiment: 'POSITIVE' | 'NEGATIVE'; // 승리 감정
}
```

#### SpinRequestDto

```typescript
{
  roomId: string; // 방 ID
  requestId: string; // 멱등성 키 (UUID 권장)
}
```

---

### Redis 데이터 구조

| 키 패턴                          | 타입          | 설명                  | TTL    |
| -------------------------------- | ------------- | --------------------- | ------ |
| `room:config:{roomId}`           | String (JSON) | 방 설정               | 2시간  |
| `room:owner:{roomId}`            | String        | 방장 rid              | 2시간  |
| `room:members:{roomId}`          | Set           | 방 멤버 소켓 ID 목록  | 무제한 |
| `room:socket:{socketId}`         | String (JSON) | 소켓 정보             | 2시간  |
| `room:state:{roomId}`            | String (JSON) | 방 상태 (마지막 스핀) | 2시간  |
| `lock:spin:{roomId}`             | String        | 스핀 분산 락          | 10초   |
| `idem:spin:{roomId}:{requestId}` | String        | 멱등성 키             | 30초   |

---

## WebSocket 이벤트 명세

### 클라이언트 → 서버

#### `room:join`

**요청**:

```json
{
  "roomId": "room-123",
  "nickname": "플레이어1" // 선택
}
```

**응답**: `room:joined`, `room:config`, `room:state` (아래 참조)

---

#### `room:config:set`

**요청**:

```json
{
  "roomId": "room-123",
  "winnersCount": 3,
  "winSentiment": "POSITIVE"
}
```

**성공 응답** (전체 방에 브로드캐스트): `room:config`

**실패 응답**: `room:config:rejected`

```json
{
  "roomId": "room-123",
  "reason": "NOT_OWNER" // 또는 "INVALID"
}
```

---

#### `spin:request`

**요청**:

```json
{
  "roomId": "room-123",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**성공 응답**: `spin:resolved` (전체 방), `spin:outcome` (개별)

**실패 응답**: `spin:rejected`

```json
{
  "roomId": "room-123",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "reason": "NOT_OWNER" // 또는 다른 실패 사유
}
```

---

### 서버 → 클라이언트

#### `room:joined`

방 입장 완료 알림 (개별)

```json
{
  "roomId": "room-123",
  "serverTime": 1704729600000,
  "you": {
    "isOwner": true
  }
}
```

---

#### `room:config`

방 설정 정보 (입장 시 또는 설정 변경 시)

```json
{
  "roomId": "room-123",
  "winnersCount": 1,
  "winSentiment": "POSITIVE",
  "updatedAt": 1704729600000
}
```

---

#### `room:state`

방 상태 정보 (입장 시, 이전 스핀이 있는 경우)

```json
{
  "roomId": "room-123",
  "ownerRid": "abc123:1704729600000:signature",
  "lastSpin": {
    "spinId": "3f5a8b9c...",
    "decidedAt": 1704729595000
  }
}
```

---

#### `spin:resolved`

룰렛 회전 시작 알림 (전체 방에 브로드캐스트)

```json
{
  "roomId": "room-123",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "spinId": "3f5a8b9c2d1e4f6a8b7c9d0e1f2a3b4c",
  "winnersCount": 3,
  "winSentiment": "POSITIVE",
  "decidedAt": 1704729600000,
  "animation": {
    "revealAt": 1704729602000, // decidedAt + 2초
    "durationMs": 3000 // 3초 애니메이션
  }
}
```

---

#### `spin:outcome`

개별 참가자 결과 (각 소켓에 개별 전송)

```json
{
  "roomId": "room-123",
  "spinId": "3f5a8b9c2d1e4f6a8b7c9d0e1f2a3b4c",
  "outcome": "WIN", // 또는 "LOSE"
  "winSentiment": "POSITIVE"
}
```

---

## 에러 처리

### 연결 거부 사유

- 쿠키 없음
- `rid` 쿠키 없음
- `rid` 검증 실패

### 요청 거부 사유

- **방 입장**: roomId 없음, rid 없음
- **설정 변경**: 방장 아님, winnersCount < 1
- **스핀 요청**: 방장 아님, 중복 요청, 이미 스핀 중, 참가자 없음, 방 없음

---

## 보안 및 동시성 제어

### 인증

- 모든 WebSocket 연결은 쿠키 기반 `rid` 검증 필요
- 방장 권한 검증은 Redis 기반

### 멱등성

- `requestId` 기반 30초 TTL 캐시
- 동일 요청 재처리 방지

### 분산 락

- Redis SET NX PX 활용
- Lua 스크립트로 안전한 락 해제
- 락 타임아웃: 10초

### 소켓 정리

- 연결 종료 시 자동 정리
- Redis TTL 2시간 (자동 만료)

---

## 확장성

### 멀티 인스턴스 지원

- Redis Adapter를 통한 Socket.io 멀티 인스턴스 동기화
- 분산 락으로 동시성 제어

### 수평 확장

- 상태를 Redis에 저장하여 stateless 서버 구성
- Socket.io 룸을 통한 효율적인 브로드캐스트

---

## 설정 가능한 환경 변수

- `CORS_ORIGIN`: WebSocket CORS 설정 (기본: `*`)
- Redis 관련 설정은 RedisModule 참조

---

## 향후 개선 사항

- [ ] 닉네임 기능 활용
- [ ] 방 목록 조회 API
- [ ] 방 삭제/종료 기능
- [ ] 재연결 시 상태 복구
- [ ] 스핀 히스토리 저장 및 조회
- [ ] 방 참가자 목록 조회
- [ ] 방장 위임 기능
