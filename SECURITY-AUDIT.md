# 보안 취약점 분석 보고서

## 프로젝트: Rullette Together
## 분석일: 2026-01-20
## 분석 범위: HTTP/WebSocket 입력값 검증 및 Redis 보안

---

## 목차

1. [개요](#개요)
2. [HIGH 위험 취약점](#high-위험-취약점)
3. [MEDIUM 위험 취약점](#medium-위험-취약점)
4. [LOW 위험 취약점](#low-위험-취약점)
5. [취약점 요약 테이블](#취약점-요약-테이블)
6. [권장 조치 우선순위](#권장-조치-우선순위)

---

## 개요

이 보고서는 Rullette Together 백엔드 서버의 입력값 검증 및 데이터 조작 관련 보안 취약점을 분석한 결과입니다.

### 분석 대상 파일
- `src/modules/roulette/roulette.controller.ts` - HTTP API 컨트롤러
- `src/modules/roulette/roulette.gateway.ts` - WebSocket 게이트웨이
- `src/modules/roulette/roulette.service.ts` - 비즈니스 로직
- `src/common/redis/redis.service.ts` - Redis 연산
- `src/modules/roulette/dto/*.ts` - 데이터 전송 객체
- `src/main.ts` - 전역 설정

### 현재 보안 구현 상태
- ✅ ValidationPipe 전역 설정 (`whitelist`, `forbidNonWhitelisted`)
- ✅ HTTP-only 쿠키 기반 Owner 인증
- ✅ class-validator를 통한 DTO 검증
- ✅ Redis 분산 락을 통한 동시성 제어
- ⚠️ 일부 DTO 검증 누락
- ⚠️ 입력값 범위 제한 미흡

---

## HIGH 위험 취약점

### 1. NicknameChangeDto의 roomId 필드 @IsNotEmpty 검증 누락

**위치:** [dto/nickname-change.dto.ts:4-5](src/modules/roulette/dto/nickname-change.dto.ts#L4-L5)

**위험도:** 🔴 HIGH

**설명:** `NicknameChangeDto`의 `roomId` 필드에 `@IsString()` 데코레이터만 적용되어 있고 `@IsNotEmpty()` 검증이 누락되어 있습니다. 빈 문자열이 검증을 통과하여 예상치 못한 동작을 유발할 수 있습니다.

**취약한 코드:**
```typescript
export class NicknameChangeDto {
  @IsString()
  roomId!: string;  // @IsNotEmpty() 누락!

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  nickname!: string;
}
```

**공격 벡터:**
```json
// WebSocket 이벤트 전송
{ "roomId": "", "nickname": "attacker" }
```
빈 roomId로 요청 시 검증을 통과하며, Redis 키가 `room:socket:` 형태로 생성될 수 있습니다.

**권장 수정:**
```typescript
@IsString()
@IsNotEmpty()
roomId!: string;
```

---

### 2. winnersCount 매개변수 최대값 제한 없음 (DoS 가능)

**위치:**
- [dto/create-room.dto.ts:46](src/modules/roulette/dto/create-room.dto.ts#L46)
- [dto/room-config-set.dto.ts:32](src/modules/roulette/dto/room-config-set.dto.ts#L32)

**위험도:** 🔴 HIGH

**설명:** `winnersCount` 필드에 최솟값(1)만 검증하고 최댓값 제한이 없습니다. 공격자가 극단적으로 큰 값을 설정하여 서버 리소스를 고갈시킬 수 있습니다.

**취약한 코드:**
```typescript
@IsNumber()
@IsInt()
@Min(1)
// @Max() 데코레이터 없음 - 무제한!
winnersCount?: number;
```

**공격 벡터:**
```bash
# HTTP 요청
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"winnersCount": 2147483647}'
```

**영향:**
- 메모리 과다 사용으로 서버 다운
- 스핀 처리 시 CPU 과부하
- 잠재적 정수 오버플로우

**권장 수정:**
```typescript
@IsNumber()
@IsInt()
@Min(1)
@Max(100)  // 합리적인 상한값 설정
winnersCount?: number;
```

---

### 3. enableImplicitConversion으로 인한 타입 강제 변환 위험

**위치:** [main.ts:36-38](src/main.ts#L36-L38)

**위험도:** 🔴 HIGH

**설명:** ValidationPipe에서 `enableImplicitConversion: true`가 설정되어 있어 예상치 못한 타입 변환이 발생할 수 있습니다.

**취약한 설정:**
```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,  // 위험!
    },
  }),
);
```

**공격 벡터:**
```json
// 과학적 표기법으로 검증 우회
{ "winnersCount": "1e10" }  // → 10000000000으로 변환

// 소수점 정수 변환
{ "winnersCount": "999.9" }  // → 999로 변환 (@IsInt 우회 가능성)
```

**권장 수정:**
```typescript
transformOptions: {
  enableImplicitConversion: false,  // 명시적 타입 변환만 허용
},
```
또는 각 DTO 필드에 `@Type(() => Number)` 데코레이터를 명시적으로 추가

---

## MEDIUM 위험 취약점

### 4. parseOwnerToken의 안전하지 않은 JSON 파싱 및 폴백 처리

**위치:** [roulette.utils.ts:38-50](src/modules/roulette/roulette.utils.ts#L38-L50)

**위험도:** 🟡 MEDIUM

**설명:** `parseOwnerToken` 함수가 JSON 파싱 실패 시 원본 쿠키 값을 그대로 반환합니다. 이중 모드 파싱으로 인해 토큰 검증이 우회될 가능성이 있습니다.

**취약한 코드:**
```typescript
export function parseOwnerToken(cookieValue: string): string | undefined {
  if (!cookieValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(cookieValue) as { token: string };
    return parsed.token;  // .token이 없으면 undefined 반환
  } catch {
    return cookieValue;  // 파싱 실패 시 원본 반환 - 모호함
  }
}
```

**공격 벡터:**
- `{"token":"valid-token"}` → `valid-token` 반환
- `"plain-token-string"` → `plain-token-string` 반환
- `{"other":"value"}` → `undefined` 반환 (예상치 못한 동작)

**권장 수정:**
```typescript
export function parseOwnerToken(cookieValue: string): string | undefined {
  if (!cookieValue) return undefined;

  try {
    const parsed = JSON.parse(cookieValue);
    // 명시적 구조 검증
    if (typeof parsed === 'object' && typeof parsed.token === 'string') {
      return parsed.token;
    }
    return undefined;  // 유효하지 않은 JSON 구조
  } catch {
    // 레거시 호환: 일반 문자열 토큰
    if (/^[a-f0-9]{32}$/.test(cookieValue)) {
      return cookieValue;
    }
    return undefined;
  }
}
```

---

### 5. 쿠키 파싱 시 roomId 형식 검증 누락

**위치:** [roulette.controller.ts:152](src/modules/roulette/roulette.controller.ts#L152)

**위험도:** 🟡 MEDIUM

**설명:** `parseOwnerTokens` 메서드에서 쿠키 이름으로부터 roomId를 추출할 때 형식 검증 없이 단순 문자열 치환만 수행합니다.

**취약한 코드:**
```typescript
private parseOwnerTokens(cookies: Record<string, string>): Record<string, string> {
  for (const [cookieName, cookieValue] of Object.entries(cookies)) {
    if (!cookieName.startsWith('owner_token_')) continue;

    const roomId = cookieName.replace('owner_token_', '');  // 검증 없음!
    // ...
  }
}
```

**공격 벡터:**
```
Cookie: owner_token_../../etc/passwd=malicious_token
// roomId가 "../../etc/passwd"가 됨
```

Redis 키는 네임스페이스로 보호되지만, 로깅이나 다른 컨텍스트에서 문제가 될 수 있습니다.

**권장 수정:**
```typescript
const ROOM_ID_PATTERN = /^room-[a-f0-9]{16}$/;

const roomId = cookieName.replace('owner_token_', '');
if (!ROOM_ID_PATTERN.test(roomId)) {
  continue;  // 유효하지 않은 roomId 무시
}
```

---

### 6. 쿠키에서 추출한 rid 형식 검증 누락

**위치:** [roulette.service.ts:183-196](src/modules/roulette/roulette.service.ts#L183-L196)

**위험도:** 🟡 MEDIUM

**설명:** `rid_roomId` 쿠키 값을 형식 검증 없이 직접 사용합니다. rid는 `randomBytes(16).toString('hex')`로 생성되지만, 쿠키 값은 검증되지 않습니다.

**취약한 코드:**
```typescript
const ridFromCookie = cookieObj[`rid_${roomId}`];  // 형식 검증 없음
const storedOwnerRid = await this.redisService.getRoomOwner(roomId);

if (storedOwnerRid && ridFromCookie && ridFromCookie !== storedOwnerRid) {
  return { valid: false, reason: 'INVALID_OWNER_RID' };
}
```

**공격 벡터:**
```
Cookie: rid_room-abc123=INJECTED_VALUE
// 형식이 맞지 않아도 문자열 비교에 사용됨
```

**권장 수정:**
```typescript
const RID_PATTERN = /^[a-f0-9]{32}$/;

const ridFromCookie = cookieObj[`rid_${roomId}`];
if (ridFromCookie && !RID_PATTERN.test(ridFromCookie)) {
  return { valid: false, reason: 'INVALID_RID_FORMAT' };
}
```

---

### 7. Socket 데이터의 암시적 role 타입 캐스팅

**위치:** [roulette.service.ts:54-57](src/modules/roulette/roulette.service.ts#L54-L57)

**위험도:** 🟡 MEDIUM

**설명:** `getRole` 메서드에서 `as SocketWithData` 타입 캐스팅으로 TypeScript의 타입 검사를 우회합니다.

**취약한 코드:**
```typescript
private getRole(socket: Socket): 'owner' | 'participant' | null {
  const role = (socket as SocketWithData).data.role;
  return role === 'owner' || role === 'participant' ? role : null;
}
```

**권장 수정:**
```typescript
private getRole(socket: Socket): 'owner' | 'participant' | null {
  const data = (socket as SocketWithData).data;
  if (!data || typeof data.role !== 'string') return null;
  return data.role === 'owner' || data.role === 'participant' ? data.role : null;
}
```

---

## LOW 위험 취약점

### 8. 타임스탬프 파싱 시 정수 오버플로우 가능성

**위치:** [redis.service.ts:400-402](src/common/redis/redis.service.ts#L400-L402)

**위험도:** 🟢 LOW

**설명:** `parseInt(timestamp, 10)` 사용 시 매우 큰 값에서 예상치 못한 동작이 발생할 수 있습니다.

**취약한 코드:**
```typescript
async getRoomLastActivity(roomId: string): Promise<number | null> {
  const timestamp = await this.client.get(`room:lastActivity:${roomId}`);
  return timestamp ? parseInt(timestamp, 10) : null;
}
```

**권장 수정:**
```typescript
const num = Number(timestamp);
return Number.isSafeInteger(num) ? num : null;
```

---

### 9. 멱등성 검사에서 느슨한 동등 비교

**위치:** [roulette.service.ts:424](src/modules/roulette/roulette.service.ts#L424)

**위험도:** 🟢 LOW

**설명:** 멱등성 검사에서 truthiness 테스트를 사용하여 빈 문자열이나 "0" 같은 값이 falsy로 처리될 수 있습니다.

**취약한 코드:**
```typescript
const existingSpinId = await this.redisService.checkIdempotency(roomId, requestId);
if (existingSpinId) {  // "" 또는 "0"은 falsy
  // ...
}
```

**권장 수정:**
```typescript
if (existingSpinId !== null && existingSpinId !== undefined) {
```

---

## 취약점 요약 테이블

| # | 취약점 | 위치 | 위험도 | 유형 | 영향 |
|---|--------|------|--------|------|------|
| 1 | NicknameChangeDto roomId 검증 누락 | dto/nickname-change.dto.ts:4-5 | 🔴 HIGH | 입력값 검증 | 권한 우회 가능성 |
| 2 | winnersCount 최대값 제한 없음 | dto/*.dto.ts | 🔴 HIGH | 리소스 고갈 | DoS, 메모리 오버플로우 |
| 3 | enableImplicitConversion 타입 강제 변환 | main.ts:36-38 | 🔴 HIGH | 타입 안전성 | 검증 우회 |
| 4 | 안전하지 않은 JSON 파싱 폴백 | roulette.utils.ts:38-50 | 🟡 MEDIUM | 로직 오류 | 토큰 검증 우회 |
| 5 | roomId 형식 검증 누락 (쿠키) | roulette.controller.ts:152 | 🟡 MEDIUM | 입력값 검증 | 경로 순회 가능성 |
| 6 | rid 형식 검증 누락 | roulette.service.ts:183-196 | 🟡 MEDIUM | 입력값 검증 | 신원 스푸핑 |
| 7 | 암시적 role 타입 캐스팅 | roulette.service.ts:54-57 | 🟡 MEDIUM | 타입 안전성 | 권한 상승 |
| 8 | 타임스탬프 정수 오버플로우 | redis.service.ts:400-402 | 🟢 LOW | 데이터 무결성 | 드문 엣지 케이스 |
| 9 | 느슨한 멱등성 비교 | roulette.service.ts:424 | 🟢 LOW | 로직 오류 | 최소 영향 |

---

## 권장 조치 우선순위

### 🔴 즉시 조치 (P0) - HIGH 위험
1. **NicknameChangeDto에 @IsNotEmpty() 추가**
2. **winnersCount에 @Max() 데코레이터 추가** (예: `@Max(100)`)
3. **enableImplicitConversion 비활성화** 또는 명시적 타입 검증 강화

### 🟡 조속한 조치 (P1) - MEDIUM 위험
4. **parseOwnerToken JSON 파싱 안전성 개선**
5. **roomId/rid 형식 검증을 위한 정규식 패턴 적용**
6. **런타임 타입 가드 함수 추가**

### 🟢 후속 조치 (P2) - LOW 위험
7. 타임스탬프 파싱 개선
8. 명시적 null 검사 적용
9. 방어적 프로그래밍 패턴 강화

---

## 추가 보안 권장사항

### Redis 키 인젝션 방지
현재 Redis 키 생성은 템플릿 리터럴을 사용하여 안전하지만, 모든 동적 값에 대해 화이트리스트 검증을 권장합니다:

```typescript
// 안전한 Redis 키 생성 유틸리티
function safeRedisKey(prefix: string, id: string): string {
  if (!/^[a-z0-9-]+$/i.test(id)) {
    throw new Error('Invalid key component');
  }
  return `${prefix}:${id}`;
}
```

### Rate Limiting 강화
현재 Throttler가 구현되어 있으나, WebSocket 이벤트에 대한 추가 rate limiting을 권장합니다:
- `room:join`: 분당 10회 제한
- `spin:request`: 분당 30회 제한
- `participant:nickname:change`: 분당 5회 제한

### 입력값 크기 제한
모든 문자열 입력에 최대 길이 제한을 명시적으로 적용:
```typescript
@IsString()
@MaxLength(100)
roomId!: string;
```

---

## 결론

이 프로젝트는 기본적인 보안 구조(ValidationPipe, HTTP-only 쿠키, class-validator)가 잘 구현되어 있으나, 일부 입력값 검증 누락과 타입 안전성 문제가 발견되었습니다. HIGH 위험 항목 3개를 즉시 수정하고, MEDIUM 위험 항목들을 조속히 해결하는 것을 권장합니다.
