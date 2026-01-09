# 🎰 Rullette Together

실시간 다중 사용자 룰렛 게임 백엔드 서버

## 📋 프로젝트 소개

Rullette Together는 여러 사용자가 함께 참여할 수 있는 실시간 룰렛 게임 시스템입니다. WebSocket을 통한 실시간 통신과 Redis를 활용한 분산 아키텍처로 확장 가능한 멀티플레이 환경을 제공합니다.

### 주요 기능

- 🎯 **실시간 룰렛 게임**: Socket.IO를 통한 실시간 양방향 통신
- 🏠 **방 기반 시스템**: HTTP API로 방 생성, WebSocket으로 실시간 참여
- 👥 **멀티플레이 지원**: Redis Pub/Sub을 활용한 다중 서버 환경 지원
- 👤 **닉네임 관리**: 자동 생성 또는 커스텀 닉네임 지원
- 🔐 **권한 관리**: Role 기반 (방장/참가자) 권한 제어
- ⚡ **분산 락**: Redis를 통한 동시성 제어 및 중복 요청 방지
- 🎲 **커스터마이징**: 승자 수, 승리/패배 감정 설정 가능

### 기술 스택

- **프레임워크**: NestJS 11
- **실시간 통신**: Socket.IO 4.8 with Redis Adapter
- **데이터베이스**: Redis (IORedis 5.9)
- **언어**: TypeScript 5.7
- **런타임**: Node.js 22
- **패키지 매니저**: pnpm

## 🚀 시작하기

### 사전 요구사항

- Node.js 22.x 이상
- pnpm 8.x 이상
- Docker & Docker Compose (Redis 실행용)

### 설치

```bash
# 의존성 설치
pnpm install
```

### 환경 설정

프로젝트 루트에 `.env` 파일을 생성하고 아래 내용을 입력하세요:

```bash
# 서버 설정
PORT=3000
NODE_ENV=development

# CORS 설정
CORS_ORIGIN=http://localhost:5173

# Redis 설정
REDIS_URL=redis://localhost:6379

# 프론트엔드 URL (방 생성 시 사용)
FRONTEND_URL=http://localhost:3000
```

### Redis 실행

Docker Compose를 사용하여 Redis를 실행합니다:

```bash
# Redis 컨테이너 시작
pnpm run docker:up

# Redis 상태 확인
docker compose ps

# Redis 로그 확인
pnpm run docker:logs

# Redis 컨테이너 중지
pnpm run docker:down
```

### 애플리케이션 실행

```bash
# 개발 모드 (일반)
pnpm run start

# 개발 모드 (watch - 파일 변경 시 자동 재시작)
pnpm run start:dev

# 디버그 모드
pnpm run start:debug

# 프로덕션 빌드
pnpm run build

# 프로덕션 실행
pnpm run start:prod
```

## 📡 API 명세

### Swagger API 문서

애플리케이션 실행 후 다음 URL에서 대화형 API 문서를 확인할 수 있습니다:

**Swagger UI**: `http://localhost:3000/api`

Swagger UI에서 다음을 할 수 있습니다:

- 모든 REST API 엔드포인트 확인
- API 요청/응답 스키마 확인
- 직접 API 테스트 실행
- 쿠키 인증 테스트

> **참고**: WebSocket 이벤트는 Swagger에서 문서화되지 않습니다. WebSocket API는 아래 섹션을 참고하세요.

### REST API

#### 방 생성

```http
POST /rooms
```

응답:

```json
{
  "roomId": "room-abc123def456",
  "ownerToken": "token-xyz...",
  "ownerUrl": "http://localhost:3000/room/room-abc123def456?role=owner&token=token-xyz...",
  "participantUrl": "http://localhost:3000/room/room-abc123def456?role=participant",
  "createdAt": 1704729600000
}
```

- `ownerUrl`: 방장용 입장 링크 (토큰 포함)
- `participantUrl`: 참가자용 입장 링크 (공유용)

### WebSocket Events

서버 주소: `ws://localhost:3000` (기본값)

#### 인증

- 연결 시 자동으로 rid 생성 (방 내에서만 유효한 유저 ID)
- 쿠키 인증 불필요

#### 이벤트

##### 1. 방 입장

```typescript
// Client -> Server
socket.emit('room:join', {
  roomId: string,
  role: 'owner' | 'participant',  // 역할
  nickname?: string               // 선택 (없으면 "참가자 N" 자동 생성)
});

// Server -> Client (성공)
socket.on('room:joined', (data) => {
  roomId: string,
  serverTime: number,
  you: {
    isOwner: boolean,
    nickname: string,
    rid: string
  }
});

// Server -> Client (실패)
socket.on('room:join:rejected', (data) => {
  reason: 'INVALID_REQUEST' | 'INVALID_RID' | 'OWNER_ALREADY_EXISTS'
});
```

##### 2. 방 설정 변경 (방장만 가능)

```typescript
// Client -> Server
socket.emit('room:config:set', {
  roomId: string,
  winnersCount: number,              // 승자 수
  winSentiment: 'POSITIVE' | 'NEGATIVE', // 승리 감정
});

// Server -> All Clients in Room
socket.on('room:config', (config) => {
  roomId: string,
  winnersCount: number,
  winSentiment: 'POSITIVE' | 'NEGATIVE',
  updatedAt: number
});
```

##### 3. 룰렛 스핀 요청 (방장만 가능)

```typescript
// Client -> Server
socket.emit('spin:request', {
  roomId: string,
  requestId: string  // 중복 요청 방지용 고유 ID (UUID 권장)
});

// Server -> All Clients in Room
socket.on('spin:resolved', (data) => {
  roomId: string,
  requestId: string,
  spinId: string,
  winnersCount: number,
  winSentiment: 'POSITIVE' | 'NEGATIVE',
  decidedAt: number,
  animation: {
    revealAt: number,    // 결과 공개 시각
    durationMs: number   // 애니메이션 길이
  }
});

// Server -> Each Client (개별 결과)
socket.on('spin:outcome', (data) => {
  roomId: string,
  spinId: string,
  outcome: 'WIN' | 'LOSE',
  winSentiment: 'POSITIVE' | 'NEGATIVE'
});

// Server -> All Clients in Room (전체 결과, 닉네임 포함)
socket.on('spin:result', (data) => {
  roomId: string,
  spinId: string,
  outcomes: [
    { nickname: string, outcome: 'WIN' | 'LOSE' },
    ...
  ]
});
```

## 🏗️ 프로젝트 구조

```
src/
├── main.ts                 # 애플리케이션 진입점
├── app.module.ts          # 루트 모듈
├── common/                # 공통 모듈
│   └── redis/            # Redis 서비스
│       ├── redis.module.ts
│       ├── redis.service.ts
│       └── redis-spec.md          # Redis 명세
└── modules/              # 기능 모듈
    └── roulette/        # 룰렛 게임
        ├── roulette.controller.ts # HTTP API (방 생성)
        ├── roulette.gateway.ts    # WebSocket 게이트웨이
        ├── roulette.service.ts    # 비즈니스 로직
        ├── roulette.module.ts
        ├── roulette-spec.md       # 룰렛 명세
        └── dto/                   # 데이터 전송 객체
            ├── create-room-response.dto.ts
            ├── room-join.dto.ts
            ├── room-config-set.dto.ts
            └── spin-request.dto.ts
```

## 🔧 개발 도구

### 코드 포맷팅

```bash
pnpm run format
```

### 린팅

```bash
pnpm run lint
```

### 테스트

```bash
# 단위 테스트
pnpm run test

# 단위 테스트 (watch 모드)
pnpm run test:watch

# e2e 테스트
pnpm run test:e2e

# 테스트 커버리지
pnpm run test:cov
```

## 🔒 보안 고려사항

- **방장 인증**: 토큰 기반 방장 권한 검증
- **CORS 설정**: 프로덕션에서는 `CORS_ORIGIN`을 특정 도메인으로 제한
- **토큰 관리**: 방장 토큰은 URL 쿼리 파라미터로 전달 (프론트엔드에서 관리)
- **rid 관리**: WebSocket 연결마다 고유 rid 생성 (방 내에서만 유효)

## 🐳 Docker

### 사용 중인 컨테이너

- **Redis**: `redis:7-alpine`
- **포트**: 6379
- **볼륨**: `redis_data` (데이터 영속성)
- **설정**: AOF (Append Only File) 활성화
- **헬스체크**: `redis-cli ping` (5초 간격)

### Docker 명령어

```bash
# 컨테이너 시작
docker compose up -d

# 컨테이너 중지 및 제거
docker compose down

# 컨테이너 및 볼륨 모두 제거
docker compose down -v

# 실시간 로그 확인
docker compose logs -f redis

# 컨테이너 상태 확인
docker compose ps
```

## 📦 배포

프로덕션 배포 시 고려사항:

1. **환경 변수 설정**
   - `NODE_ENV=production`
   - `SESSION_SECRET`을 강력한 랜덤 값으로 설정
   - `CORS_ORIGIN`을 실제 프론트엔드 도메인으로 설정
   - `REDIS_URL`을 프로덕션 Redis 인스턴스로 설정

2. **Redis 설정**
   - 프로덕션용 Redis 서버 구성 (AWS ElastiCache, Redis Cloud 등)
   - Redis 비밀번호 설정
   - 적절한 메모리 제한 및 eviction 정책 설정

3. **애플리케이션 실행**

   ```bash
   pnpm run build
   pnpm run start:prod
   ```

4. **프로세스 관리**
   - PM2 또는 Docker를 사용한 프로세스 관리 권장
   - 무중단 배포를 위한 로드 밸런서 구성

## 📚 문서

프로젝트의 상세한 명세는 다음 문서를 참고하세요:

- [Roulette 모듈 명세](src/modules/roulette/roulette-spec.md) - 룰렛 게임 로직 및 API 명세
- [Redis 모듈 명세](src/common/redis/redis-spec.md) - Redis 데이터 구조 및 메서드
- [프론트엔드 개발 계획](front-dev-plan.md) - 프론트엔드 개발 가이드

## 🤝 기여하기

이슈와 풀 리퀘스트를 환영합니다!

## 📄 라이선스

UNLICENSED

---

## 📚 부록: Docker 이미지 안전성 검증

### 사용 중인 Docker 이미지

#### Redis 7 Alpine

```yaml
image: redis:7-alpine
```

**이미지 정보:**

- **공식 이미지**: Docker Hub의 공식(Official) Redis 이미지
- **버전**: Redis 7.x (최신 안정 버전)
- **베이스 이미지**: Alpine Linux (경량화된 보안 강화 리눅스 배포판)

**안전성 검증:**

1. **공식 이미지 보증**
   - Redis 공식 팀에서 관리하는 인증된 이미지
   - Docker Hub Official Images 프로그램을 통해 검증됨
   - 정기적인 보안 업데이트 및 패치 제공

2. **Alpine Linux 기반의 보안 장점**
   - 최소한의 패키지만 포함 (공격 표면 최소화)
   - musl libc 사용으로 메모리 안정성 향상
   - 이미지 크기 약 30MB (일반 Debian 기반 대비 1/10 수준)
   - 취약점 노출 가능성 최소화

3. **버전 고정의 중요성**
   - `redis:7-alpine` 사용으로 메이저 버전 고정
   - 예기치 않은 breaking changes 방지
   - 재현 가능한 빌드 환경 보장

4. **보안 검증 방법**

   ```bash
   # Docker Hub에서 이미지 정보 확인
   docker pull redis:7-alpine

   # 취약점 스캔 (Docker Scout)
   docker scout cves redis:7-alpine

   # 이미지 레이어 및 히스토리 확인
   docker history redis:7-alpine
   ```

5. **대안 고려사항**
   - **특정 버전 고정**: `redis:7.4.7-alpine` (더 엄격한 버전 관리)
   - **SHA256 해시**: `redis@sha256:...` (불변성 보장)
   - **프라이빗 레지스트리**: 조직 내부 이미지 저장소 사용

**권장 사항:**

✅ **현재 설정 (개발 환경)**

- `redis:7-alpine`은 개발 및 테스트 환경에 적합
- 최신 보안 패치가 자동으로 적용되는 장점

✅ **프로덕션 환경 권장**

```yaml
# 프로덕션용 docker-compose.yml
services:
  redis:
    image: redis:7.4.7-alpine  # 특정 버전 고정
    # 또는
    image: redis:7-alpine@sha256:specific-hash  # SHA 고정
```

**참고 링크:**

- [Redis 공식 Docker Hub](https://hub.docker.com/_/redis)
- [Alpine Linux 공식 사이트](https://alpinelinux.org/)
- [Docker Official Images 프로그램](https://docs.docker.com/trusted-content/official-images/)

**마지막 확인 날짜**: 2026년 1월 8일
