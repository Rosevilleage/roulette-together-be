# 룰렛 투게더 프론트엔드 개발 계획서

## 프로젝트 개요

실시간 다인 룰렛 애플리케이션의 프론트엔드 구현 계획입니다.
사용자는 방을 생성하거나 참가하여 함께 룰렛을 돌릴 수 있습니다.

---

## 핵심 플로우

### 1. 방 생성 플로우 (방장)

```
메인 화면
  ↓
[방 만들기] 버튼 클릭
  ↓
POST /rooms API 호출 (빈 요청)
  ↓
응답 수신:
  - roomId
  - ownerToken
  - ownerUrl (방장용 링크)
  - participantUrl (참가자용 링크)
  ↓
방 입장 화면으로 이동
  - 쿼리 파라미터: roomId, role=owner, token=ownerToken
  ↓
WebSocket 연결 + room:join 이벤트 전송
  - { roomId, role: 'owner', nickname? }
  ↓
room:joined 이벤트 수신
  - isOwner: true
  - nickname
  - rid
```

### 2. 참가자 입장 플로우

```
공유받은 참가자 링크 클릭
  ↓
방 입장 화면으로 이동
  - 쿼리 파라미터: roomId, role=participant
  ↓
(선택) 닉네임 입력 모달 표시
  ↓
WebSocket 연결 + room:join 이벤트 전송
  - { roomId, role: 'participant', nickname? }
  ↓
room:joined 이벤트 수신
  - isOwner: false
  - nickname (입력하지 않았으면 '참가자 N' 자동 생성됨)
  - rid
```

### 3. 룰렛 스핀 플로우

```
방장이 [룰렛 돌리기] 버튼 클릭
  ↓
spin:request 이벤트 전송
  - { roomId, requestId }
  ↓
spin:resolved 이벤트 수신 (방 전체)
  - winnersCount
  - winSentiment (POSITIVE/NEGATIVE)
  - animation 정보
  ↓
룰렛 애니메이션 시작 (약 3초)
  ↓
spin:outcome 이벤트 수신 (개인별)
  - outcome: 'WIN' | 'LOSE'
  - winSentiment
  ↓
spin:result 이벤트 수신 (방 전체, 모든 참가자 결과)
  - outcomes: [{ nickname, outcome }, ...]
  ↓
결과 화면 표시
  - 당첨자 닉네임 목록
  - 본인의 당첨 여부
```

---

## 화면 구성

### 1. 메인 화면 (`/`)

**기능:**

- 방 만들기 버튼
- (선택) 최근 참여한 방 목록

**UI 요소:**

- 타이틀: "룰렛 투게더"
- 버튼: "방 만들기"
- (선택) 닉네임 입력 필드

**API 호출:**

- `POST /rooms` - 방 생성
  - Request body: 없음 (빈 POST 요청)
  - Response: `{ roomId, ownerToken, ownerUrl, participantUrl, createdAt }`

**라우팅:**

- 방 생성 성공 시 → `/room/:roomId?role=owner&token=:ownerToken`

---

### 2. 방 입장 화면 (`/room/:roomId`)

**쿼리 파라미터:**

- `role`: 'owner' | 'participant' (필수)
- `token`: 방장 인증 토큰 (role=owner일 때만)
- `nickname`: 초기 닉네임 (선택)

**기능:**

- WebSocket 연결 및 방 입장
- 현재 참가자 목록 표시
- 방장 전용: 룰렛 설정, 스핀 버튼
- 참가자: 대기 화면
- 링크 공유 기능 (방장만)

**WebSocket 이벤트:**

**송신:**

- `room:join` - 방 입장
  ```json
  {
    "roomId": "room-abc123",
    "role": "owner",
    "nickname": "플레이어1"
  }
  ```

**수신:**

- `room:joined` - 입장 완료

  ```json
  {
    "roomId": "room-abc123",
    "serverTime": 1234567890,
    "you": {
      "isOwner": true,
      "nickname": "플레이어1",
      "rid": "rid-xyz"
    }
  }
  ```

- `room:config` - 방 설정 정보

  ```json
  {
    "roomId": "room-abc123",
    "winnersCount": 1,
    "winSentiment": "POSITIVE",
    "updatedAt": 1234567890
  }
  ```

- `room:join:rejected` - 입장 거부
  ```json
  {
    "reason": "OWNER_ALREADY_EXISTS" | "INVALID_REQUEST" | "INVALID_RID"
  }
  ```

---

### 3. 방장 전용 기능

**룰렛 설정:**

- 당첨자 수 선택 (1~N명)
- 당첨 감정 선택 (긍정/부정)

**WebSocket 이벤트:**

**송신:**

- `room:config:set` - 설정 변경
  ```json
  {
    "roomId": "room-abc123",
    "winnersCount": 2,
    "winSentiment": "NEGATIVE"
  }
  ```

**수신:**

- `room:config` - 변경된 설정 (브로드캐스트)
- `room:config:rejected` - 설정 변경 거부
  ```json
  {
    "roomId": "room-abc123",
    "reason": "INVALID" | "NOT_OWNER"
  }
  ```

**링크 공유:**

- 참가자 링크 복사 버튼
- QR 코드 생성 (선택)
- 카카오톡, 문자 등 공유 (선택)

---

### 4. 룰렛 스핀 화면

**방장:**

- [룰렛 돌리기] 버튼 활성화

**참가자:**

- 대기 상태 표시

**WebSocket 이벤트:**

**송신 (방장만):**

- `spin:request`
  ```json
  {
    "roomId": "room-abc123",
    "requestId": "req-unique-id"
  }
  ```

**수신:**

- `spin:resolved` - 스핀 시작 (방 전체)

  ```json
  {
    "roomId": "room-abc123",
    "requestId": "req-unique-id",
    "spinId": "spin-xyz",
    "winnersCount": 1,
    "winSentiment": "POSITIVE",
    "decidedAt": 1234567890,
    "animation": {
      "revealAt": 1234567892,
      "durationMs": 3000
    }
  }
  ```

- `spin:outcome` - 개인 결과

  ```json
  {
    "roomId": "room-abc123",
    "spinId": "spin-xyz",
    "outcome": "WIN",
    "winSentiment": "POSITIVE"
  }
  ```

- `spin:result` - 전체 결과 (방 전체)

  ```json
  {
    "roomId": "room-abc123",
    "spinId": "spin-xyz",
    "outcomes": [
      { "nickname": "플레이어1", "outcome": "WIN" },
      { "nickname": "참가자 1", "outcome": "LOSE" },
      { "nickname": "참가자 2", "outcome": "LOSE" }
    ]
  }
  ```

- `spin:rejected` - 스핀 거부
  ```json
  {
    "roomId": "room-abc123",
    "requestId": "req-unique-id",
    "reason": "NOT_OWNER" | "ALREADY_SPINNING" | "NO_MEMBERS"
  }
  ```

---

### 5. 결과 화면

**표시 정보:**

- 전체 참가자 결과 목록
  - 닉네임
  - 당첨/낙첨 표시
- 본인 결과 강조 표시
- winSentiment에 따른 UI 변경
  - POSITIVE: 당첨 = 축하 메시지, 낙첨 = 아쉬움
  - NEGATIVE: 당첨 = 걸림, 낙첨 = 안전

**액션:**

- [다시 돌리기] 버튼 (방장만)
- [메인으로] 버튼

---

## 기술 스택 권장사항

### 필수 라이브러리

- **React** (또는 Next.js)
- **Socket.IO Client**: WebSocket 연결
- **React Router**: 라우팅
- **Tailwind CSS** (또는 다른 CSS 프레임워크)

### 상태 관리

- **Zustand** 또는 **Recoil**: 전역 상태 관리
- 관리할 상태:
  - 현재 방 정보 (roomId, role, isOwner)
  - 사용자 정보 (nickname, rid)
  - 방 설정 (winnersCount, winSentiment)
  - 참가자 목록
  - 스핀 상태 (진행 중, 결과)

### WebSocket 관리

- Socket.IO 연결 관리 hook
- 자동 재연결 처리
- 이벤트 리스너 등록/해제

```typescript
// 예시: useSocket.ts
import { useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';

export const useSocket = (): Socket | null => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socketInstance = io(
      process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001',
      {
        transports: ['websocket'],
      },
    );

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return socket;
};
```

---

## 데이터 구조

### Room Store (예시)

```typescript
interface RoomStore {
  // 방 정보
  roomId: string | null;
  role: 'owner' | 'participant' | null;
  isOwner: boolean;
  ownerToken: string | null;

  // 사용자 정보
  myNickname: string | null;
  myRid: string | null;

  // 방 설정
  config: {
    winnersCount: number;
    winSentiment: 'POSITIVE' | 'NEGATIVE';
    updatedAt: number;
  } | null;

  // 참가자 목록 (선택사항, 서버에서 별도로 제공할 경우)
  participants: Array<{
    nickname: string;
    rid: string;
  }>;

  // 스핀 상태
  spin: {
    isSpinning: boolean;
    spinId: string | null;
    myOutcome: 'WIN' | 'LOSE' | null;
    allOutcomes: Array<{
      nickname: string;
      outcome: 'WIN' | 'LOSE';
    }>;
  } | null;

  // 액션
  setRoomInfo: (
    roomId: string,
    role: 'owner' | 'participant',
    token?: string,
  ) => void;
  setMyInfo: (nickname: string, rid: string, isOwner: boolean) => void;
  setConfig: (config: any) => void;
  startSpin: (spinId: string) => void;
  setMyOutcome: (outcome: 'WIN' | 'LOSE') => void;
  setAllOutcomes: (outcomes: any[]) => void;
  reset: () => void;
}
```

---

## UI/UX 고려사항

### 1. 닉네임 처리

- 방 입장 시 닉네임을 입력하지 않으면 서버에서 자동으로 '참가자 N' 부여
- (선택) 방 입장 후 닉네임 변경 기능 (추가 개발 필요)

### 2. 링크 공유

- 참가자 링크를 클립보드에 복사
- 모바일에서 네이티브 공유 기능 활용 (Web Share API)

### 3. 애니메이션

- 룰렛 돌리는 애니메이션: CSS 또는 Canvas 활용
- 결과 공개 타이밍 동기화: `animation.revealAt` 시간에 맞춰 표시
- Framer Motion, React Spring 등 애니메이션 라이브러리 권장

### 4. 에러 처리

- WebSocket 연결 실패 시 재연결 시도
- API 호출 실패 시 사용자에게 알림
- 방 입장 거부 시 사유 표시

### 5. 반응형 디자인

- 모바일, 태블릿, 데스크톱 모두 지원
- 가로/세로 모드 대응

### 6. 접근성

- 스크린 리더 지원
- 키보드 네비게이션
- 색맹 고려 (색상만으로 정보 전달하지 않기)

---

## API 엔드포인트

### HTTP API

| Method | Endpoint | Description | Request Body            | Response                                                      |
| ------ | -------- | ----------- | ----------------------- | ------------------------------------------------------------- |
| POST   | `/rooms` | 방 생성     | `{ nickname?: string }` | `{ roomId, ownerToken, ownerUrl, participantUrl, createdAt }` |

### WebSocket 이벤트

#### Client → Server

| Event             | Payload                                  | Description             |
| ----------------- | ---------------------------------------- | ----------------------- |
| `room:join`       | `{ roomId, role, nickname? }`            | 방 입장 요청            |
| `room:config:set` | `{ roomId, winnersCount, winSentiment }` | 방 설정 변경 (방장만)   |
| `spin:request`    | `{ roomId, requestId }`                  | 룰렛 스핀 요청 (방장만) |

#### Server → Client

| Event                  | Payload                                                                           | Description            | 수신 대상 |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------- | --------- |
| `room:joined`          | `{ roomId, serverTime, you: { isOwner, nickname, rid } }`                         | 방 입장 완료           | 본인      |
| `room:join:rejected`   | `{ reason }`                                                                      | 방 입장 거부           | 본인      |
| `room:config`          | `{ roomId, winnersCount, winSentiment, updatedAt }`                               | 방 설정 정보           | 방 전체   |
| `room:config:rejected` | `{ roomId, reason }`                                                              | 설정 변경 거부         | 본인      |
| `room:state`           | `{ roomId, ownerRid, lastSpin? }`                                                 | 방 상태 정보 (입장 시) | 본인      |
| `spin:resolved`        | `{ roomId, requestId, spinId, winnersCount, winSentiment, decidedAt, animation }` | 스핀 시작              | 방 전체   |
| `spin:outcome`         | `{ roomId, spinId, outcome, winSentiment }`                                       | 개인 결과              | 본인      |
| `spin:result`          | `{ roomId, spinId, outcomes }`                                                    | 전체 결과              | 방 전체   |
| `spin:rejected`        | `{ roomId, requestId, reason }`                                                   | 스핀 거부              | 본인      |

---

## 환경 변수

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
```

---

## 개발 순서 권장

### Phase 1: 기본 구조

1. 프로젝트 세팅 (React/Next.js + TypeScript)
2. 라우팅 구조 생성 (`/`, `/room/:roomId`)
3. Socket.IO Client 연결 hook 구현
4. 상태 관리 store 구현

### Phase 2: 방 생성 및 입장

1. 메인 화면 UI
2. 방 생성 API 연동
3. 방 입장 화면 UI
4. WebSocket 연결 및 room:join 이벤트 처리
5. 닉네임 입력 모달 (선택 사항)

### Phase 3: 방 관리

1. 참가자 목록 표시
2. 방장 전용 설정 UI (당첨자 수, 감정)
3. room:config:set 이벤트 처리
4. 링크 공유 기능

### Phase 4: 룰렛 스핀

1. 룰렛 UI 구현
2. spin:request 이벤트 송신
3. spin:resolved 수신 및 애니메이션 시작
4. spin:outcome 수신 및 개인 결과 저장
5. spin:result 수신 및 결과 화면 표시

### Phase 5: 완성도 향상

1. 애니메이션 개선
2. 에러 처리 강화
3. 반응형 디자인 적용
4. 접근성 개선
5. 성능 최적화

---

## 테스트 시나리오

### 1. 방 생성 테스트

- [ ] 방 생성 API 호출 성공
- [ ] 생성된 방으로 자동 입장
- [ ] 방장 권한 확인 (isOwner: true)

### 2. 참가자 입장 테스트

- [ ] 참가자 링크로 입장
- [ ] 닉네임 입력 시 반영
- [ ] 닉네임 미입력 시 자동 생성 ('참가자 N')
- [ ] 참가자 권한 확인 (isOwner: false)

### 3. 방장 전용 기능 테스트

- [ ] 룰렛 설정 변경
- [ ] 참가자는 설정 변경 불가
- [ ] 룰렛 돌리기 버튼 활성화 (방장만)

### 4. 룰렛 스핀 테스트

- [ ] 방장이 스핀 요청
- [ ] 모든 참가자가 spin:resolved 수신
- [ ] 애니메이션 동기화
- [ ] 각 참가자가 개인 결과 수신
- [ ] 전체 결과 표시 (닉네임 포함)

### 5. 에러 처리 테스트

- [ ] 이미 방장이 있는 방에 owner로 입장 시도
- [ ] 참가자가 스핀 요청 시 거부
- [ ] WebSocket 연결 끊김 시 재연결

---

## 추가 개발 아이디어

### 필수는 아니지만 고려할 만한 기능

1. **방 비밀번호**
   - 방 생성 시 비밀번호 설정
   - 참가자 입장 시 비밀번호 요구

2. **참가자 목록 실시간 업데이트**
   - 참가자 입장/퇴장 시 알림
   - 현재 참가자 수 표시

3. **방 설정 확장**
   - 최대 참가자 수 제한
   - 룰렛 테마 선택

4. **히스토리 기능**
   - 이전 스핀 결과 조회
   - 통계 (각 참가자별 당첨 횟수)

5. **사운드 효과**
   - 룰렛 돌아가는 소리
   - 결과 발표 효과음

6. **채팅 기능**
   - 참가자 간 간단한 채팅

7. **모바일 앱 (PWA)**
   - Service Worker 등록
   - 오프라인 지원
   - 홈 화면 추가

---

## 참고 사항

### requestId 생성

- 클라이언트에서 `spin:request` 전송 시 고유한 `requestId` 생성 필요
- UUID 또는 timestamp 기반 생성

```typescript
import { v4 as uuidv4 } from 'uuid';

const requestId = uuidv4();
socket.emit('spin:request', { roomId, requestId });
```

### 타임아웃 처리

- `spin:request` 후 일정 시간 내 응답이 없으면 에러 처리
- 네트워크 지연을 고려하여 타임아웃 설정 (예: 5초)

### WebSocket 연결 상태 표시

- 연결 중, 연결됨, 연결 끊김 상태를 UI에 표시
- 연결 끊김 시 자동 재연결 시도 및 알림

---

## 문의 및 지원

백엔드 API 문서는 서버 실행 후 `/api-docs`에서 Swagger UI를 통해 확인할 수 있습니다.

```bash
# 백엔드 서버 실행
npm run start:dev

# Swagger 문서 확인
http://localhost:3001/api-docs
```

---

## 요약

이 프로젝트는 다음과 같은 핵심 기능을 구현합니다:

1. **방 생성**: HTTP API로 방 생성 및 방장/참가자 링크 발급
2. **방 입장**: WebSocket 연결 및 역할(방장/참가자) 구분
3. **닉네임 관리**: 입력하지 않으면 자동 생성 ('참가자 N')
4. **룰렛 스핀**: 방장이 스핀 요청, 모든 참가자에게 결과 전달
5. **결과 표시**: 닉네임과 함께 당첨/낙첨 결과 표시

**백엔드는 이미 구현 완료**되었으므로, 프론트엔드는 이 문서를 참고하여 개발하시면 됩니다.
