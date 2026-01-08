# Session 모듈 명세서

## 개요
익명 사용자 식별을 위한 세션 관리 모듈입니다.
HMAC 기반의 서명된 세션 ID(`rid`)를 쿠키로 발급하고 검증합니다.

## 모듈 구조

### 파일 구성
```
session/
├── session.module.ts       # 모듈 정의
├── session.controller.ts   # REST API 컨트롤러
└── session.service.ts      # 세션 로직
```

### 의존성
- **없음** (독립적인 모듈)

### Export
- `SessionService`: 다른 모듈에서 `rid` 검증 시 사용

---

## 주요 컴포넌트

### 1. SessionController
세션 생성 및 확인을 위한 REST API 엔드포인트를 제공합니다.

#### API 엔드포인트

##### `GET /session`
**설명**: 세션 생성 또는 확인

**요청 헤더**:
```
Cookie: rid=<rid_value>  // 선택
```

**응답**:
```json
{
  "ok": true
}
```

**동작**:
1. 기존 쿠키에 유효한 `rid`가 있는 경우: 검증 후 성공 응답
2. `rid`가 없거나 유효하지 않은 경우: 새 `rid` 생성 및 쿠키 설정

**쿠키 설정** (새 세션 생성 시):
- `httpOnly`: true (XSS 방지)
- `secure`: production 환경에서만 true (HTTPS)
- `sameSite`: production에서 'none', 개발 환경에서 'lax'
- `maxAge`: 7일 (604,800,000ms)

**Swagger 문서화**:
- 태그: `Session`
- 요약: "세션 생성 또는 확인"
- 쿠키 인증: `@ApiCookieAuth('rid')`

---

### 2. SessionService
세션 ID 생성, 검증, 쿠키 관리 로직을 담당합니다.

#### 주요 메서드

##### `generateRid(): string`
**기능**: 새로운 세션 ID 생성

**구조**:
```
{random}:{timestamp}:{signature}
```

**구성 요소**:
- `random`: 16바이트 무작위 값 (hex, 32자)
- `timestamp`: 현재 Unix 타임스탬프 (밀리초)
- `signature`: HMAC-SHA256 서명 (hex, 64자)

**서명 생성**:
```typescript
payload = `${random}:${timestamp}`
signature = HMAC-SHA256(secretKey, payload)
```

**예시**:
```
abc123def456...789:1704729600000:0a1b2c3d4e5f...
```

**보안**:
- 암호학적으로 안전한 무작위 값 (crypto.randomBytes)
- HMAC-SHA256 서명으로 위변조 방지
- 타임스탬프 포함으로 유니크성 보장

---

##### `verifyRid(rid: string): boolean`
**기능**: 세션 ID 검증

**검증 절차**:
1. 형식 검증: 콜론(`:`)으로 구분된 3개 파트
2. 서명 재계산: `HMAC-SHA256(secretKey, random:timestamp)`
3. 서명 비교: 재계산한 서명과 수신한 서명 일치 확인

**반환**:
- `true`: 유효한 rid
- `false`: 유효하지 않은 rid (형식 오류, 서명 불일치, 예외 발생)

**보안**:
- 타이밍 공격 방지 (암호학적 해시 비교)
- 예외 처리로 안전한 실패

---

##### `getRidFromCookie(req: Request): string | null`
**기능**: Express 요청에서 `rid` 쿠키 추출

**반환**:
- `string`: rid 값
- `null`: 쿠키 없음

**사용 예시**:
```typescript
const rid = this.sessionService.getRidFromCookie(req);
if (!rid || !this.sessionService.verifyRid(rid)) {
  // 세션 없음 또는 유효하지 않음
}
```

---

##### `setRidCookie(res: Response, rid: string): void`
**기능**: 응답에 `rid` 쿠키 설정

**쿠키 옵션**:
- `httpOnly: true` - JavaScript 접근 불가 (XSS 방지)
- `secure` - production 환경에서만 HTTPS 강제
- `sameSite` - CSRF 방지
  - production: `'none'` (크로스 도메인 허용, secure 필수)
  - development: `'lax'` (크로스 사이트 GET 허용)
- `maxAge: 604800000` - 7일 (밀리초)

**환경별 설정**:
```typescript
const isProduction = process.env.NODE_ENV === 'production';
```

---

## 데이터 구조

### rid (세션 ID)
**형식**: `{random}:{timestamp}:{signature}`

**예시**:
```
f3e2d1c0b9a8796857463542312fde:1704729600000:a1b2c3d4e5f60708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80
```

**특징**:
- 길이: 약 120자
- 인코딩: Hexadecimal
- 유니크성: 무작위 값 + 타임스탬프
- 무결성: HMAC 서명

---

## API 명세

### REST API

#### `GET /session`
세션 생성 또는 확인

**요청**:
```http
GET /session HTTP/1.1
Host: api.example.com
Cookie: rid=abc123...  // 선택
```

**응답 1**: 기존 세션 확인 성공
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "ok": true
}
```

**응답 2**: 새 세션 생성
```http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: rid=f3e2d1c0...; HttpOnly; Max-Age=604800; ...

{
  "ok": true
}
```

---

## 보안

### HMAC 서명
- **알고리즘**: HMAC-SHA256
- **키**: 환경변수 `SESSION_SECRET` (기본값: 'default-secret-key-change-in-production')
- **목적**: rid 위변조 방지

### 쿠키 보안
- **HttpOnly**: JavaScript 접근 차단 (XSS 방지)
- **Secure** (production): HTTPS 전송만 허용 (중간자 공격 방지)
- **SameSite**: CSRF 공격 방지
  - production: `none` (크로스 도메인 지원)
  - development: `lax` (개발 편의성)

### 무작위성
- `crypto.randomBytes(16)` 사용
- 암호학적으로 안전한 의사난수 생성기 (CSPRNG)

---

## 설정 가능한 환경 변수

| 변수 명 | 설명 | 기본값 | 필수 |
|---------|------|--------|------|
| `SESSION_SECRET` | HMAC 서명 비밀 키 | `'default-secret-key-change-in-production'` | 강력 권장 |
| `NODE_ENV` | 실행 환경 (쿠키 보안 설정에 영향) | - | 권장 |

**중요**: production 환경에서는 반드시 `SESSION_SECRET`를 안전한 값으로 설정하세요.

**권장 방법**:
```bash
# 안전한 무작위 비밀 키 생성
openssl rand -hex 32

# 환경변수 설정
export SESSION_SECRET="생성된_비밀_키"
```

---

## 사용 예시

### 1. 클라이언트 초기 접속
```http
GET /session HTTP/1.1
Host: api.example.com

# 응답
HTTP/1.1 200 OK
Set-Cookie: rid=f3e2d1c0b9a8...; HttpOnly; Max-Age=604800
Content-Type: application/json

{"ok": true}
```

### 2. 세션이 있는 클라이언트 재접속
```http
GET /session HTTP/1.1
Host: api.example.com
Cookie: rid=f3e2d1c0b9a8...

# 응답 (쿠키 재설정 없음)
HTTP/1.1 200 OK
Content-Type: application/json

{"ok": true}
```

### 3. WebSocket 연결 시 rid 검증 (다른 모듈에서)
```typescript
// RouletteGateway에서
constructor(private readonly sessionService: SessionService) {}

handleConnection(socket: Socket): void {
  const cookies = socket.handshake.headers.cookie;
  const rid = parseCookie(cookies, 'rid');
  
  if (!this.sessionService.verifyRid(rid)) {
    socket.disconnect();
    return;
  }
  
  socket.data.rid = rid;
}
```

---

## 제한 사항

### 타임스탬프 검증 없음
- 현재 구현은 rid의 타임스탬프를 검증하지 않음
- rid는 만료되지 않음 (쿠키 maxAge만 적용)
- 필요 시 타임스탬프 기반 만료 로직 추가 가능

### 서버 측 세션 저장소 없음
- Stateless 방식 (서버에 세션 데이터 저장 안 함)
- 장점: 확장성, 단순성
- 단점: 서버 측 세션 무효화 불가 (로그아웃 구현 제한)

### 단일 비밀 키
- 비밀 키 교체 시 기존 rid 무효화
- 키 로테이션 구현 필요 시 다중 키 검증 로직 추가 필요

---

## 향후 개선 사항
- [ ] rid 타임스탬프 기반 만료 검증
- [ ] 비밀 키 로테이션 지원
- [ ] Redis 기반 세션 블랙리스트 (로그아웃 구현)
- [ ] 세션 갱신 (refresh) 로직
- [ ] IP 기반 추가 검증
- [ ] 세션 통계 및 모니터링

---

## 테스트 가이드

### 단위 테스트 예시
```typescript
describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService();
  });

  it('generateRid() should return valid format', () => {
    const rid = service.generateRid();
    expect(rid.split(':').length).toBe(3);
  });

  it('verifyRid() should accept valid rid', () => {
    const rid = service.generateRid();
    expect(service.verifyRid(rid)).toBe(true);
  });

  it('verifyRid() should reject tampered rid', () => {
    const rid = service.generateRid();
    const tampered = rid.replace(/.$/, 'x');
    expect(service.verifyRid(tampered)).toBe(false);
  });

  it('verifyRid() should reject invalid format', () => {
    expect(service.verifyRid('invalid')).toBe(false);
    expect(service.verifyRid('a:b')).toBe(false);
  });
});
```

### 통합 테스트 예시
```typescript
describe('SessionController (e2e)', () => {
  it('GET /session should set rid cookie', async () => {
    const response = await request(app.getHttpServer())
      .get('/session')
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.headers['set-cookie']).toBeDefined();
    expect(response.headers['set-cookie'][0]).toContain('rid=');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('GET /session with valid rid should not set new cookie', async () => {
    const firstResponse = await request(app.getHttpServer())
      .get('/session')
      .expect(200);

    const cookie = firstResponse.headers['set-cookie'][0];

    const secondResponse = await request(app.getHttpServer())
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);

    expect(secondResponse.body.ok).toBe(true);
    expect(secondResponse.headers['set-cookie']).toBeUndefined();
  });
});
```
