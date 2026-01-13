# Roulette 모듈 명세서

## 개요

룰렛 게임의 핵심 기능을 제공하는 HTTP API 및 WebSocket 기반 실시간 멀티플레이어 모듈입니다.
방(Room) 생성, 참가, 설정, 룰렛 회전 및 결과 처리를 담당합니다.

## 모듈 구조

### 파일 구성

```
roulette/
├── roulette.module.ts             # 모듈 정의
├── roulette.controller.ts         # HTTP API 컨트롤러 (방 생성)
├── roulette.gateway.ts            # WebSocket 게이트웨이
├── roulette.service.ts            # 비즈니스 로직
└── dto/
    ├── create-room-response.dto.ts    # 방 생성 응답
    ├── room-join.dto.ts               # 방 입장 요청
    ├── room-config-set.dto.ts         # 방 설정 변경 요청
    ├── spin-request.dto.ts            # 룰렛 회전 요청
    ├── ready-toggle.dto.ts            # 준비 상태 토글 요청
    └── nickname-change.dto.ts         # 닉네임 변경 요청
```

### 의존성

- **RedisModule**: 분산 상태 관리 및 pub/sub

---

## 주요 컴포넌트

### 1. RouletteController

HTTP API를 통한 방 생성을 담당하는 컨트롤러입니다.

#### 엔드포인트

##### `POST /rooms`

**기능**: 새로운 룰렛 방 생성

**요청 Body**:

```json
{
  "nickname": "플레이어1" // 선택 사항, 미입력 시 "생성자"로 설정됨
}
```

**응답**:

```json
{
  "roomId": "room-abc123def456",
  "title": "룰렛 방",
  "createdAt": 1704729600000
}
```

**참고**: `ownerToken`은 HTTP-only 쿠키(`owner_token_{roomId}`)로 자동 설정됩니다.

**처리 흐름**:

1. 고유한 roomId 생성 (16자 hex)
2. 방장 인증용 ownerToken 생성 (64자 hex)
3. Redis에 토큰 저장 (2시간 TTL)
4. 방장 초기 닉네임 저장 (미입력 시 "생성자", 2시간 TTL)
5. 기본 방 설정 초기화
6. HTTP-only 쿠키에 ownerToken 저장

---

### 2. RouletteGateway

WebSocket 연결 및 메시지 처리를 담당하는 게이트웨이입니다.

#### 연결 관리

- **CORS 설정**: 환경변수 `CORS_ORIGIN` 또는 전체 허용
- **Redis Adapter**: Socket.io의 멀티 인스턴스 지원을 위한 Redis 어댑터 설정
- **rid 생성**: 연결 시 자동으로 고유한 rid 생성 (방 내 유저 구분 용도)

#### 라이프사이클 훅

- `afterInit()`: Redis pub/sub 클라이언트 초기화 및 어댑터 설정 (최대 50회 재시도, 100ms 간격)
- `handleConnection()`: 연결 시 임의의 rid 생성 및 소켓 데이터에 저장
- `handleDisconnect()`: 연결 종료 시 방 멤버 제거 및 소켓 정보 삭제

#### WebSocket 이벤트 핸들러

| 이벤트 명                     | 설명                         | DTO                 |
| ----------------------------- | ---------------------------- | ------------------- |
| `room:join`                   | 방 입장 요청                 | `RoomJoinDto`       |
| `room:config:set`             | 방 설정 변경 (방장만 가능)   | `RoomConfigSetDto`  |
| `spin:request`                | 룰렛 회전 요청 (방장만 가능) | `SpinRequestDto`    |
| `participant:ready:toggle`    | 참가자 준비 상태 토글        | `ReadyToggleDto`    |
| `participant:nickname:change` | 참가자 닉네임 변경           | `NicknameChangeDto` |

---

### 3. RouletteService

룰렛 게임의 핵심 비즈니스 로직을 처리합니다.

#### 주요 메서드

##### `handleRoomJoin(socket, data)`

**기능**: 사용자가 방에 입장할 때 처리

**처리 흐름**:

1. `roomId`, `role`, `rid` 유효성 검증
2. 닉네임 처리:
   - 방장: 닉네임 미입력 시 방 생성 시 설정한 닉네임 사용 (기본값: '생성자')
   - 참가자: 닉네임 미입력 시 자동 생성 ('참가자 N')
   - Redis 참가자 카운터를 사용하여 번호 할당
3. 방장(owner) 역할인 경우:
   - 기존 방장 확인
   - 이미 방장이 있으면 입장 거부 (`room:join:rejected`)
   - 방장이 없으면 현재 사용자를 방장으로 설정
4. Socket.io 방에 소켓 추가
5. Redis에 방 멤버 추가 (`room:members:{roomId}`)
6. Redis에 소켓 정보 저장 (nickname, role 포함)
7. 기본 방 설정 초기화 (없는 경우)
8. 클라이언트에 응답 전송:
   - `room:joined`: 입장 완료 (isOwner, nickname, rid 포함)
   - `room:config`: 현재 방 설정
   - `room:state`: 마지막 스핀 정보 (있는 경우)

**기본 방 설정**:

- `winnersCount`: 1
- `winSentiment`: 'POSITIVE'

**실패 시 응답**: `room:join:rejected`

- `INVALID_REQUEST`: roomId 또는 role 누락
- `INVALID_RID`: rid 없음
- `OWNER_ALREADY_EXISTS`: 이미 방장이 존재

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
5. **준비 상태 검증**: 모든 참가자(방장 제외)가 준비 완료 상태인지 확인
6. 승자 선택 (Fisher-Yates 셔플 알고리즘)
7. 이벤트 브로드캐스트:
   - `spin:resolved`: 전체 방에 룰렛 시작 알림 (애니메이션 정보 포함)
   - `spin:outcome`: 각 참가자에게 개별 결과 (WIN/LOSE)
   - `spin:result`: 전체 방에 결과 요약 (닉네임 포함)
8. 방 상태 업데이트 (마지막 스핀 정보)
9. 분산 락 해제

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
- `NOT_ALL_READY`: 모든 참가자가 준비 완료 상태가 아님

**분산 락**: Lua 스크립트로 안전한 락 해제 (spinId 일치 시에만)

---

##### `handleReadyToggle(socket, data, server)`

**기능**: 참가자의 준비 상태 토글

**처리 흐름**:

1. `rid` 검증
2. 소켓 정보 조회 및 역할 확인
3. 참가자만 가능 (방장은 준비 상태 변경 불가)
4. Redis에 준비 상태 저장/삭제
5. 방장에게 참가자 리스트 브로드캐스트 (`room:participants`)

**실패 시 응답**: `ready:toggle:rejected`

- `ONLY_PARTICIPANTS_CAN_READY`: 방장은 준비 상태를 변경할 수 없음

---

##### `handleNicknameChange(socket, data, server)`

**기능**: 참가자의 닉네임 변경

**처리 흐름**:

1. `rid` 검증
2. 닉네임 유효성 검증 (1-20자)
3. Redis 소켓 정보 업데이트
4. 사용자에게 확인 응답 (`nickname:changed`)
5. 방장에게 참가자 리스트 브로드캐스트 (`room:participants`)

**실패 시 응답**: `nickname:change:rejected`

- `INVALID_NICKNAME`: 닉네임이 비어있거나 너무 김

---

##### `broadcastParticipantsToOwner(roomId, server)` (private)

**기능**: 방장에게 참가자 리스트 전송

**처리 흐름**:

1. 방장 rid 조회
2. 방의 모든 멤버 및 준비 상태 조회
3. 참가자 정보 수집 (방장 제외)
4. 방장 소켓에게만 `room:participants` 이벤트 전송

**전송 시점**:

- 참가자가 방에 입장할 때
- 참가자가 준비 상태를 변경할 때
- 참가자가 닉네임을 변경할 때
- 참가자가 방을 나갈 때

---

##### `handleDisconnect(socket, server)`

**기능**: 연결 종료 시 정리 작업

**처리 흐름**:

1. 소켓 정보 조회
2. 준비 상태 목록에서 제거
3. 방 멤버에서 제거
4. 소켓 정보 삭제
5. 참가자가 나간 경우 방장에게 참가자 리스트 브로드캐스트

---

##### `selectRandom<T>(array, count)` (private)

**기능**: Fisher-Yates 셔플 알고리즘으로 무작위 승자 선택

**반환**: 배열에서 무작위로 선택된 `count`개의 요소

---

## 데이터 구조

### DTO

#### CreateRoomDto (Request)

```typescript
{
  title?: string;        // 방 제목 (선택, 기본값: "룰렛 방")
  nickname?: string;     // 방장 닉네임 (선택, 기본값: "생성자")
  winnersCount?: number; // 당첨자 수 (선택, 기본값: 1)
  winSentiment?: 'POSITIVE' | 'NEGATIVE'; // 당첨 감정 (선택, 기본값: "POSITIVE")
}
```

#### CreateRoomResponseDto (Response)

```typescript
{
  roomId: string;        // 생성된 방 ID
  title: string;         // 방 제목
  createdAt: number;     // 생성 시각 (Unix ms)
}
```

**참고**: `ownerToken`은 HTTP-only 쿠키(`owner_token_{roomId}`)로 자동 설정됩니다.

#### RoomJoinDto

```typescript
{
  roomId: string;              // 방 ID
  role: 'owner' | 'participant'; // 입장 역할
  nickname?: string;           // 닉네임 (선택, 없으면 자동 생성)
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

#### ReadyToggleDto

```typescript
{
  roomId: string; // 방 ID
  ready: boolean; // true = 준비 완료, false = 준비 해제
}
```

#### NicknameChangeDto

```typescript
{
  roomId: string; // 방 ID
  nickname: string; // 새로운 닉네임 (1-20자)
}
```

---

### Redis 데이터 구조

| 키 패턴                                | 타입          | 설명                            | TTL    |
| -------------------------------------- | ------------- | ------------------------------- | ------ |
| `room:config:{roomId}`                 | String (JSON) | 방 설정                         | 2시간  |
| `room:owner:{roomId}`                  | String        | 방장 rid                        | 2시간  |
| `room:owner:token:{roomId}`            | String        | 방장 인증 토큰                  | 2시간  |
| `room:owner:initial-nickname:{roomId}` | String        | 방장 초기 닉네임 (방 생성 시)   | 2시간  |
| `room:participant:counter:{roomId}`    | Number        | 참가자 번호 카운터              | 2시간  |
| `room:members:{roomId}`                | Set           | 방 멤버 소켓 ID 목록            | 무제한 |
| `room:socket:{socketId}`               | String (JSON) | 소켓 정보 (nickname, role 포함) | 2시간  |
| `room:state:{roomId}`                  | String (JSON) | 방 상태 (마지막 스핀)           | 2시간  |
| `room:ready:{roomId}`                  | Set           | 준비 완료한 참가자 소켓 ID 목록 | 무제한 |
| `lock:spin:{roomId}`                   | String        | 스핀 분산 락                    | 10초   |
| `idem:spin:{roomId}:{requestId}`       | String        | 멱등성 키                       | 30초   |

---

## API 명세

### HTTP API

#### `POST /rooms`

방 생성 API

**요청**:

```json
{
  "title": "점심 메뉴 정하기",  // 선택, 기본값: "룰렛 방"
  "nickname": "플레이어1",       // 선택, 기본값: "생성자"
  "winnersCount": 1,            // 선택, 기본값: 1
  "winSentiment": "POSITIVE"    // 선택, 기본값: "POSITIVE"
}
```

**응답**:

```json
{
  "roomId": "room-abc123def456",
  "title": "점심 메뉴 정하기",
  "createdAt": 1704729600000
}
```

**참고**: `ownerToken`은 HTTP-only 쿠키(`owner_token_{roomId}`)로 자동 설정됩니다.

---

## WebSocket 이벤트 명세

### 클라이언트 → 서버

#### `room:join`

**요청**:

```json
{
  "roomId": "room-123",
  "role": "owner", // 또는 "participant"
  "nickname": "플레이어1" // 선택, 방장: "생성자" (또는 방 생성 시 지정한 닉네임), 참가자: "참가자 N"
}
```

**성공 응답**: `room:joined`, `room:config`, `room:state` (아래 참조)

**실패 응답**: `room:join:rejected`

```json
{
  "reason": "OWNER_ALREADY_EXISTS" // 또는 다른 실패 사유
}
```

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

#### `participant:ready:toggle`

**요청**:

```json
{
  "roomId": "room-123",
  "ready": true
}
```

**성공 응답**: 방장에게 `room:participants` 이벤트 전송

**실패 응답**: `ready:toggle:rejected`

```json
{
  "roomId": "room-123",
  "reason": "ONLY_PARTICIPANTS_CAN_READY"
}
```

---

#### `participant:nickname:change`

**요청**:

```json
{
  "roomId": "room-123",
  "nickname": "새로운닉네임"
}
```

**성공 응답**:

- 개인에게 `nickname:changed` 이벤트
- 방장에게 `room:participants` 이벤트 전송

**실패 응답**: `nickname:change:rejected`

```json
{
  "roomId": "room-123",
  "reason": "INVALID_NICKNAME"
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
    "isOwner": true,
    "nickname": "플레이어1",
    "rid": "abc123def456..."
  }
}
```

---

#### `room:join:rejected`

방 입장 거부 알림 (개별)

```json
{
  "reason": "OWNER_ALREADY_EXISTS"
  // 가능한 사유: "INVALID_REQUEST", "INVALID_RID", "OWNER_ALREADY_EXISTS"
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

#### `spin:result`

전체 참가자 결과 요약 (전체 방에 브로드캐스트)

```json
{
  "roomId": "room-123",
  "spinId": "3f5a8b9c2d1e4f6a8b7c9d0e1f2a3b4c",
  "outcomes": [
    { "nickname": "플레이어1", "outcome": "WIN" },
    { "nickname": "참가자 1", "outcome": "LOSE" },
    { "nickname": "참가자 2", "outcome": "LOSE" }
  ]
}
```

---

#### `room:participants`

참가자 리스트 (방장에게만 전송)

```json
{
  "roomId": "room-123",
  "participants": [
    {
      "rid": "abc123def456...",
      "nickname": "플레이어1",
      "ready": true
    },
    {
      "rid": "xyz789uvw012...",
      "nickname": "참가자 2",
      "ready": false
    }
  ],
  "readyCount": 1,
  "totalCount": 2,
  "allReady": false
}
```

**전송 시점**:

- 참가자가 방에 입장할 때
- 참가자가 준비 상태를 변경할 때
- 참가자가 닉네임을 변경할 때
- 참가자가 방을 나갈 때

---

#### `nickname:changed`

닉네임 변경 확인 (개인에게만 전송)

```json
{
  "roomId": "room-123",
  "nickname": "새로운닉네임"
}
```

---

## 에러 처리

### 요청 거부 사유

- **방 입장**: roomId/role 누락, rid 없음, 이미 방장 존재
- **설정 변경**: 방장 아님, winnersCount < 1
- **스핀 요청**: 방장 아님, 중복 요청, 이미 스핀 중, 참가자 없음, 방 없음, 모든 참가자가 준비되지 않음
- **준비 상태 토글**: 방장은 준비 상태 변경 불가
- **닉네임 변경**: 닉네임이 비어있거나 너무 김 (1-20자)

---

## 보안 및 동시성 제어

### 인증

- WebSocket 연결 시 자동으로 rid 생성 (방 내 유저 구분 용도)
- 방장 권한은 Redis 기반으로 검증
- 방장 토큰은 HTTP API 응답으로만 제공 (URL에 포함)

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
- `FRONTEND_URL`: 프론트엔드 URL (기본: `http://localhost:3000`)
- Redis 관련 설정은 RedisModule 참조

---

## 주요 변경사항 (v2.0)

### ✅ 완료된 기능

- [x] HTTP API를 통한 방 생성 (`POST /rooms`)
- [x] role 기반 권한 관리 (owner/participant)
- [x] 닉네임 자동 생성 기능 ('참가자 N')
- [x] 결과에 닉네임 포함 (`spin:result` 이벤트)
- [x] Session 모듈 제거 (rid는 방 내에서만 유저 구분)
- [x] 방장 토큰 기반 인증

### 플로우 변경

**이전 (v1.0)**:

```
쿠키에서 rid 추출 → rid 검증 → 방 입장
```

**현재 (v2.0)**:

```
HTTP API로 방 생성 → 토큰 발급 → WebSocket 연결 시 rid 자동 생성 → role 기반 방 입장
```

---

## 주요 변경사항 (v2.1)

### ✅ 완료된 기능

- [x] 참가자 준비 상태 시스템 (`participant:ready:toggle`)
- [x] 닉네임 변경 기능 (`participant:nickname:change`)
- [x] 방장에게 참가자 리스트 실시간 전송 (`room:participants`)
- [x] 모든 참가자가 준비 완료되어야 룰렛 시작 가능
- [x] 준비 상태는 룰렛 회전 후에도 유지

### 플로우 변경

**이전 (v2.0)**:

```
방 입장 → 룰렛 회전 가능
```

**현재 (v2.1)**:

```
방 입장 → 참가자 준비 완료 → 모든 참가자 준비 시 룰렛 회전 가능
         ↓
      닉네임 변경 가능
```

---

## 향후 개선 사항

- [ ] 방 목록 조회 API
- [ ] 방 삭제/종료 기능
- [ ] 재연결 시 상태 복구
- [ ] 스핀 히스토리 저장 및 조회
- [ ] 방장 위임 기능
