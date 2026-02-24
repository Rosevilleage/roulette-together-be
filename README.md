# Rullette Together

실시간 멀티플레이 룰렛 게임 백엔드 서버

WebSocket 기반 실시간 동기화, Redis 분산 상태 관리, 동시성 제어를 다루는 NestJS 백엔드 프로젝트입니다.

---

## 목차

- [프로젝트 소개](#프로젝트-소개)
- [기술 스택](#기술-스택)
- [핵심 설계 결정](#핵심-설계-결정)
- [배포 아키텍처](#배포-아키텍처)
- [시스템 구조](#시스템-구조)
- [API 명세](#api-명세)
- [로컬 개발 환경](#로컬-개발-환경)
- [프로덕션 배포](#프로덕션-배포)
- [모니터링](#모니터링)

---

## 프로젝트 소개

여러 사용자가 URL 하나로 같은 방에 입장해 실시간으로 룰렛을 돌리는 웹 게임 백엔드입니다.

**핵심 플로우**:
1. 방장이 HTTP API로 방 생성 → `ownerToken`이 HTTP-only 쿠키로 발급
2. 방장·참가자 모두 WebSocket으로 방 입장 → 실시간 참가자 목록 동기화
3. 모든 참가자가 준비 완료 → 방장이 스핀 요청
4. 서버가 Fisher-Yates 셔플로 승패 결정 → 전원에게 동시 브로드캐스트

**주요 기능**:
- WebSocket 기반 실시간 양방향 통신 (Socket.IO)
- Role 기반 권한 제어 (방장 / 참가자)
- 분산 락을 통한 중복 스핀 방지
- 멱등성 키로 재시도 안전성 보장
- 수평 확장을 위한 Redis Pub/Sub 구조

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | NestJS 11 |
| 런타임 | Node.js 22 |
| 언어 | TypeScript 5.7 |
| 실시간 통신 | Socket.IO 4.8 + Redis Adapter |
| 상태 저장소 | Redis (IORedis 5.9) |
| 컨테이너 | Docker + Docker Compose |
| 리버스 프록시 | Nginx |
| 패키지 매니저 | pnpm |

---

## 핵심 설계 결정

### 1. Redis를 단일 상태 저장소로 사용

별도 DB 없이 Redis 하나로 모든 게임 상태를 관리합니다. 세션 데이터 특성상 영속성보다 TTL 기반 자동 만료와 빠른 읽기·쓰기가 더 중요했기 때문입니다. 방 데이터에 2시간 TTL을 걸어 만료된 게임 상태를 자동으로 정리합니다.

```
room:config:{roomId}          # 방 설정 (TTL 2h)
room:members:{roomId}         # 소켓 ID Set
room:ready:{roomId}           # 준비 완료 참가자 Set
room:socket:{socketId}        # 소켓 메타데이터 (roomId, rid, nickname, role)
lock:spin:{roomId}            # 스핀 분산 락 (TTL 10s)
idem:spin:{roomId}:{requestId} # 멱등성 키 (TTL 30s)
```

### 2. 분산 락으로 동시 스핀 방지

여러 클라이언트가 동시에 스핀을 요청하거나 네트워크 지연으로 같은 요청이 재전송될 때를 대비해 두 가지 안전장치를 적용했습니다.

- **분산 락**: `SET NX PX`로 락 획득, Lua 스크립트로 atomic 해제 → 동시 스핀 원천 차단
- **멱등성 키**: `requestId` 기반 Redis 캐시 → 클라이언트 재시도 시 중복 처리 방지

### 3. HTTP-only 쿠키로 방장 인증

방 생성 시 발급한 `ownerToken`을 HTTP-only 쿠키에 저장해 XSS로 인한 토큰 탈취를 방지합니다. WebSocket 연결 시 쿠키를 자동으로 전달받아 방장 권한을 검증합니다.

### 4. rid (Room-scoped User ID)

WebSocket 연결마다 해당 방 안에서만 유효한 식별자 `rid`를 생성합니다. 전역 사용자 계정 없이도 방 내 사용자를 식별하고 권한을 제어할 수 있습니다.

### 5. Socket.IO Redis Adapter로 수평 확장 지원

단일 인스턴스에서도 코드 변경 없이 다중 인스턴스로 확장 가능하도록 Socket.IO Redis Adapter를 처음부터 적용했습니다. 인스턴스 간 WebSocket 이벤트 브로드캐스트를 Redis Pub/Sub으로 처리합니다.

---

## 배포 아키텍처

### 초기 구성: ALB + ECS Fargate + ElastiCache

프로젝트 초기에는 AWS 관리형 서비스로 수평 확장을 고려한 아키텍처로 배포했습니다.

```
                          Internet
                              │
                              ▼
                 ┌─────────────────────┐
                 │  AWS ALB            │  SSL 종료, 고가용성 로드밸런싱
                 │  (sticky session)   │  Socket.IO를 위한 Sticky Session 필수
                 └──────────┬──────────┘
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
   ┌───────────────────┐     ┌───────────────────┐
   │  ECS Fargate      │     │  ECS Fargate      │   ... N tasks
   │  NestJS App       │     │  NestJS App       │
   └─────────┬─────────┘     └─────────┬─────────┘
             │                         │
             └────────────┬────────────┘
                          │
                          ▼
             ┌─────────────────────────┐
             │  AWS ElastiCache        │  관리형 Redis
             │  (Redis OSS)            │  자동 장애조치, 백업 내장
             └─────────────────────────┘
```

**운영 비용 (월 기준)**:
- ECS Fargate: ~$30
- ElastiCache (cache.t3.micro): ~$41
- ALB: ~$20
- 기타 (NAT Gateway, ECR 등): ~$30–60
- **합계: 약 $120–150/월**

### 현재 구성: 단일 EC2 인스턴스 (비용 최적화)

서비스 초기 단계에서 관리형 서비스의 고정 비용이 과했습니다. 트래픽 규모 대비 가용성 요구사항을 재검토한 결과, 단일 EC2에 App + Redis를 함께 올리는 구성으로 전환했습니다.

```
                          Internet
                              │
                              ▼
              ┌───────────────────────────┐
              │  EC2 (t4g.small, ~$12/월) │
              │                           │
              │  ┌─────────────────────┐  │
              │  │  Nginx (80/443)     │  │  SSL 종료, 리버스 프록시
              │  └──────────┬──────────┘  │
              │             │             │
              │  ┌──────────▼──────────┐  │
              │  │  NestJS App (:8080) │  │  외부 직접 접근 불가
              │  └──────────┬──────────┘  │
              │             │             │
              │  ┌──────────▼──────────┐  │
              │  │  Redis (:6379)      │  │  Docker 내부 네트워크만 접근 가능
              │  │  (Docker, 127.0.0.1)│  │  포트 외부 노출 없음
              │  └─────────────────────┘  │
              └───────────────────────────┘
```

**운영 비용 (월 기준)**:
- EC2 t4g.small: ~$12
- EBS (20GB): ~$2
- **합계: 약 $14/월**

**트레이드오프**:

| 항목 | ALB + ECS + ElastiCache | EC2 단일 인스턴스 |
|------|-------------------------|-------------------|
| 월 비용 | ~$120–150 | ~$14 |
| 가용성 | 고가용성 (다중 AZ) | 단일 장애점 |
| 확장성 | 자동 수평 확장 | 수동 스케일업만 가능 |
| Redis 안정성 | 관리형 (자동 백업, 장애조치) | 직접 관리 (EBS 스냅샷) |
| 운영 부담 | 낮음 | 높음 (패치, 백업 직접 관리) |

> 트래픽이 증가하거나 SLA 요구사항이 생기면 기존 ECS 아키텍처로 복귀가 가능합니다.
> 코드 수준에서 Redis Adapter 등 수평 확장 구조는 그대로 유지하고 있습니다.

---

## 시스템 구조

```
src/
├── main.ts                          # 진입점, ValidationPipe, CORS, Swagger 설정
├── app.module.ts                    # 루트 모듈
├── common/
│   ├── config/env.validation.ts     # 환경변수 유효성 검증 (class-validator)
│   ├── filters/                     # 전역 예외 필터 (HTTP, Throttler)
│   ├── guards/                      # 인증 가드
│   ├── health/                      # /health, /health/live, /health/ready
│   ├── metrics/                     # /metrics (Prometheus)
│   ├── middleware/                  # HTTP 로깅 미들웨어
│   └── redis/
│       ├── redis.service.ts         # Redis 연산 추상화
│       └── redis-spec.md            # Redis 키·TTL·메서드 명세
└── modules/
    └── roulette/
        ├── roulette.controller.ts   # POST /rooms
        ├── roulette.gateway.ts      # Socket.IO 이벤트 핸들러
        ├── roulette.service.ts      # 게임 비즈니스 로직
        ├── roulette-spec.md         # WebSocket 이벤트 명세
        └── dto/                     # 요청·응답 DTO (class-validator)
```

### WebSocket 이벤트 흐름

**Client → Server**:

| 이벤트 | 설명 | 권한 |
|--------|------|------|
| `room:join` | 방 입장 (role 지정) | 모두 |
| `room:config:set` | 방 설정 변경 | 방장만 |
| `participant:ready:toggle` | 준비 상태 토글 | 참가자만 |
| `participant:nickname:change` | 닉네임 변경 | 모두 |
| `spin:request` | 스핀 요청 | 방장만, 전원 준비 시 |

**Server → Client**:

| 이벤트 | 설명 | 대상 |
|--------|------|------|
| `room:joined` | 입장 확인 (isOwner, rid, nickname) | 입장한 클라이언트 |
| `room:config` | 방 설정 동기화 | 방 전체 브로드캐스트 |
| `room:participants` | 참가자 목록·준비 상태 | 방장만 |
| `spin:resolved` | 스핀 시작, 애니메이션 타이밍 | 방 전체 브로드캐스트 |
| `spin:outcome` | 개인 WIN/LOSE 결과 | 각 클라이언트 개별 전송 |
| `spin:result` | 전체 결과 (닉네임 포함) | 방 전체 브로드캐스트 |
| `{event}:rejected` | 요청 거절 (reason 코드 포함) | 요청한 클라이언트 |

---

## API 명세

### REST API

#### 방 생성

```http
POST /v1/rooms
Content-Type: application/json

{
  "title": "팀 회식 룰렛",       // 필수, 최대 50자
  "nickname": "주최자",          // 선택, 최대 20자
  "winnersCount": 3,             // 선택, 1~100 (기본: 1)
  "winSentiment": "POSITIVE"     // 선택, POSITIVE | NEGATIVE (기본: POSITIVE)
}
```

```json
// 응답 201
{
  "roomId": "room-abc123",
  "ownerUrl": "https://your-frontend.com/room/room-abc123?role=owner",
  "participantUrl": "https://your-frontend.com/room/room-abc123",
  "createdAt": 1704729600000
}
```

`ownerToken`은 HTTP-only 쿠키(`owner_token_{roomId}`)로 발급됩니다. 응답 본문에 포함되지 않습니다.

#### 헬스체크

```http
GET /health         # 전체 상태 (Redis + 메모리)
GET /health/live    # Liveness: 프로세스 생존 여부
GET /health/ready   # Readiness: Redis 연결 가능 여부
```

### WebSocket

```typescript
// 방 입장
socket.emit('room:join', {
  roomId: string,
  role: 'owner' | 'participant',
  nickname?: string,
});

// 스핀 요청 (방장, 전원 준비 후)
socket.emit('spin:request', {
  roomId: string,
  requestId: string,  // UUID 권장 (멱등성 보장)
});

// 스핀 결과 수신
socket.on('spin:outcome', ({ outcome }) => {
  // outcome: 'WIN' | 'LOSE'
});
```

전체 이벤트 페이로드: [`src/modules/roulette/roulette-spec.md`](src/modules/roulette/roulette-spec.md)

Swagger UI: `http://localhost:8080/api` (로컬 실행 시)

---

## 로컬 개발 환경

### 사전 요구사항

- Node.js 22+
- pnpm 9+
- Docker

### 설치 및 실행

```bash
# 의존성 설치
pnpm install

# Redis 실행 (Docker)
pnpm run docker:up

# 개발 서버 (watch 모드)
pnpm run dev
```

### 환경 변수

```bash
# .env
PORT=8080
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3000   # Swagger WebSocket URL 표시용
```

### 테스트

```bash
pnpm run test        # 단위 테스트
pnpm run test:watch  # watch 모드
pnpm run test:cov    # 커버리지
pnpm run test:e2e    # e2e 테스트
```

---

## 프로덕션 배포

Docker Compose로 App + Redis + Nginx를 단일 EC2에서 운영합니다.

### 배포 파일 구조

```
docker-compose.prod.yml    # 프로덕션 서비스 정의
nginx/
  nginx.conf               # Nginx 메인 설정 (WebSocket upgrade map 포함)
  conf.d/app.conf          # HTTP→HTTPS 리다이렉트, 리버스 프록시
scripts/
  setup-ec2.sh             # EC2 초기 환경 셋업 (Docker, certbot, ufw)
  deploy.sh                # 배포 (pull → build → up → healthcheck)
  init-ssl.sh              # Let's Encrypt 인증서 발급 + Nginx SSL 설정
```

### EC2 최초 셋업

**Step 1 — EC2 접속 후 환경 구성 (레포 클론 전, 최초 1회)**

`setup-ec2.sh`는 레포 없이 curl로 바로 실행할 수 있습니다.

```bash
# YOUR_REPO를 실제 GitHub 경로로 교체
curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/deploy-low-cost/scripts/setup-ec2.sh | bash

# Docker 그룹 적용을 위해 새 세션으로 재접속
exec su - $USER
```

**Step 2 — 레포 클론**

```bash
git clone https://github.com/YOUR_REPO/rullette-together.git
cd rullette-together
git checkout deploy-low-cost
```

**Step 3 — 환경 변수 설정**

```bash
cp .env.example .env.prod
vim .env.prod    # CORS_ORIGIN, REDIS_PASSWORD, FRONTEND_URL 입력

# Redis 비밀번호 생성 참고
openssl rand -base64 32
```

**Step 4 — 서비스 배포**

```bash
bash scripts/deploy.sh
```

**Step 5 — SSL 발급 (도메인 A레코드가 EC2 IP를 가리켜야 함)**

```bash
bash scripts/init-ssl.sh api.your-domain.com admin@your-domain.com
```

### 이후 배포

```bash
bash scripts/deploy.sh
# 또는
pnpm run prod:build
```

### 환경 변수 (.env.prod)

```bash
PORT=8080
NODE_ENV=production
CORS_ORIGIN=https://your-frontend.com
REDIS_PASSWORD=생성한_랜덤_비밀번호   # openssl rand -base64 32
REDIS_URL=redis://redis:6379         # 서비스명 고정, 비밀번호는 REDIS_PASSWORD 로 별도 주입
FRONTEND_URL=https://your-frontend.com
NODE_MAX_OLD_SPACE=1200              # t4g.small 기준 (MB)
```

### 보안 설정

- Redis는 Docker 내부 네트워크에서만 접근 가능 (`--bind 127.0.0.1`, 포트 미노출)
- Nginx만 80/443 포트 개방, 앱 포트(8080) 외부 차단
- 방장 토큰은 HTTP-only + Secure + SameSite=Lax 쿠키

### 프로덕션 체크리스트

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` 실제 프론트엔드 도메인
- [ ] `REDIS_URL` 확인 (Compose 내부: `redis://redis:6379`)
- [ ] SSL 인증서 발급 완료 (`bash scripts/init-ssl.sh`)
- [ ] Redis AOF 영속성 활성화 확인 (`--appendonly yes`)
- [ ] EBS 스냅샷 자동화 설정 (AWS 콘솔 Data Lifecycle Manager)
- [ ] `/health/ready` 헬스체크 응답 확인

---

## 모니터링

### 헬스체크 엔드포인트

| 엔드포인트 | 확인 항목 |
|-----------|-----------|
| `GET /health` | Redis 연결 + 메모리 힙 (150MB 임계값) |
| `GET /health/live` | 프로세스 생존 여부 |
| `GET /health/ready` | Redis 연결 가능 여부 |

### Prometheus 메트릭 (`GET /metrics`)

| 메트릭 | 설명 |
|--------|------|
| `http_requests_total` | HTTP 요청 수 (method, route, status) |
| `http_request_duration_seconds` | 요청 처리 시간 히스토그램 |
| `websocket_connections_active` | 활성 WebSocket 연결 수 |
| `websocket_events_total` | WebSocket 이벤트 처리 수 |
| `active_rooms_total` | 활성 방 수 |
| `spins_total` | 총 스핀 횟수 |

---

## 문서

- [Roulette 모듈 명세](src/modules/roulette/roulette-spec.md)
- [Redis 키·TTL 명세](src/common/redis/redis-spec.md)
- [에러 코드 목록](docs/api/ERROR_RESPONSES.md)
