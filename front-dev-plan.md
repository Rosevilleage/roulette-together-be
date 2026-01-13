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
(선택) 방 제목 입력
(선택) 닉네임 입력
(선택) 룰렛 설정 입력
  - winnersCount: 당첨자 수 (기본값: 1)
  - winSentiment: 당첨 감정 (POSITIVE/NEGATIVE, 기본값: POSITIVE)
  ↓
[방 만들기] 버튼 클릭
  ↓
POST /rooms API 호출
  - {
      title?: string,
      nickname?: string,
      winnersCount?: number,
      winSentiment?: 'POSITIVE' | 'NEGATIVE'
    }
  ↓
응답 수신:
  - roomId
  - title (방 제목, 기본값: "룰렛 방")
  - createdAt
  - ownerToken은 HTTP-only 쿠키로 자동 저장됨 (owner_token_{roomId}, JSON 형식: {roomId, token})
  ↓
방 입장 화면으로 이동
  - 쿼리 파라미터: roomId, role=owner
  - 쿠키가 자동으로 포함되어 방장 인증
  ↓
WebSocket 연결 (credentials: true) + room:join 이벤트 전송
  - { roomId, role: 'owner' }
  - nickname 생략 시 방 생성 시 지정한 닉네임 사용
  - 서버가 쿠키를 통해 방장 권한 자동 검증
  ↓
room:joined 이벤트 수신
  - isOwner: true
  - nickname (방 생성 시 지정한 닉네임 또는 "생성자")
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
  ↓
방 대기 화면
  - 닉네임 변경 가능
  - [준비 완료] 버튼 표시
```

### 3. 참가자 준비 플로우 (v2.1 신규)

```
참가자가 [준비 완료] 버튼 클릭
  ↓
participant:ready:toggle 이벤트 전송
  - { roomId, ready: true }
  ↓
방장에게 room:participants 이벤트 수신
  - 준비 완료한 참가자 수 업데이트
  ↓
모든 참가자가 준비 완료되면
  - 방장의 [룰렛 돌리기] 버튼 활성화
```

### 4. 룰렛 스핀 플로우

```
방장이 [룰렛 돌리기] 버튼 클릭
  - 조건: 모든 참가자가 준비 완료 상태
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
- 내가 만든 활성 방 목록 (v2.2)

**UI 요소:**

- 타이틀: "룰렛 투게더"
- 버튼: "방 만들기"
- (선택) 방 제목 입력 필드 (최대 50자, 기본값: "룰렛 방")
- (선택) 닉네임 입력 필드 (최대 20자)
- (선택) 룰렛 설정 입력
  - 당첨자 수 (winnersCount): 숫자 입력, 기본값 1
  - 당첨 감정 (winSentiment): POSITIVE(당첨=좋음) / NEGATIVE(당첨=나쁨) 선택, 기본값 POSITIVE
- 내가 만든 방 목록 (v2.2)
  - 방 제목, 참가자 수, 당첨자 수, 감정, 마지막 활동 시간
  - 클릭 시 해당 방으로 입장

**API 호출:**

- `POST /rooms` - 방 생성
  - Request body:
    ```json
    {
      "title": "점심 메뉴 정하기", // 선택, 미입력 시 "룰렛 방", 최대 50자
      "nickname": "방장닉네임", // 선택, 미입력 시 "생성자", 최대 20자
      "winnersCount": 3, // 선택, 기본값 1
      "winSentiment": "POSITIVE" // 선택, 기본값 "POSITIVE"
    }
    ```
  - Response: `{ roomId, title, createdAt }`
  - ownerToken은 HTTP-only 쿠키로 자동 설정됨 (보안 강화, JSON 형식: {roomId, token})
  - 프론트엔드에서 URL 조합: `/room/${roomId}?role=owner` (방장), `/room/${roomId}?role=participant` (참가자)

- `GET /rooms` - 내가 만든 활성 방 목록 조회 (v2.2)
  - Request: 쿠키 (`owner_token_*`)를 자동으로 포함
  - Response:
    ```json
    {
      "rooms": [
        {
          "roomId": "room-abc123",
          "title": "점심 메뉴 정하기",
          "participantCount": 3,
          "winnersCount": 2,
          "winSentiment": "POSITIVE",
          "lastActivity": 1673456789000,
          "ownerNickname": "방장닉네임"
        }
      ],
      "queriedAt": 1673456789000
    }
    ```
  - **자동 쿠키 정리**: 비활성 방(Redis에서 만료됨)이나 토큰이 일치하지 않는 쿠키는 서버에서 자동으로 삭제됨

**라우팅:**

- 방 생성 성공 시 → `/room/:roomId?role=owner`
- 쿠키가 자동으로 포함되어 방장 인증 처리
- 방 목록에서 방 클릭 시 → `/room/:roomId?role=owner` (v2.2)

---

### 2. 방 입장 화면 (`/room/:roomId`)

**쿼리 파라미터:**

- `role`: 'owner' | 'participant' (필수)
- `nickname`: 초기 닉네임 (선택)

**참고**: 방장 인증 토큰은 쿠키로 자동 전송됩니다 (쿼리 파라미터로 전달 불필요)

**기능:**

- WebSocket 연결 및 방 입장
- 현재 참가자 목록 표시 (방장만)
- 방장 전용: 룰렛 설정, 스핀 버튼, 참가자 준비 상태 확인
- 참가자: 닉네임 변경, 준비 완료 버튼
- 링크 공유 기능 (방장만)
- 방 나가기 버튼 (v2.2)
  - 참가자: 방 나가기 (연결 종료)
  - 방장: 방 삭제 (모든 참가자 강제 퇴장)

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

- `participant:ready:toggle` - 준비 상태 토글 (참가자만)

  ```json
  {
    "roomId": "room-abc123",
    "ready": true
  }
  ```

- `participant:nickname:change` - 닉네임 변경

  ```json
  {
    "roomId": "room-abc123",
    "nickname": "새로운닉네임"
  }
  ```

- `room:leave` - 방 나가기 (v2.2)
  ```json
  {
    "roomId": "room-abc123"
  }
  ```

**수신:**

- `room:joined` - 입장 완료

  ```json
  {
    "roomId": "room-abc123",
    "title": "점심 메뉴 정하기",
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
    "reason": "OWNER_ALREADY_EXISTS" | "INVALID_REQUEST" | "INVALID_RID" | "MISSING_OWNER_TOKEN" | "INVALID_OWNER_TOKEN"
  }
  ```

  **Rejection Reasons:**
  - `MISSING_OWNER_TOKEN`: 방장 역할인데 쿠키가 없음 (WebSocket 연결 시 `withCredentials: true` 필요)
  - `INVALID_OWNER_TOKEN`: 쿠키의 토큰이 Redis에 저장된 토큰과 불일치
  - `OWNER_ALREADY_EXISTS`: 이미 다른 방장이 존재함
  - `INVALID_REQUEST`: 필수 파라미터 누락
  - `INVALID_RID`: 서버에서 생성한 rid가 없음

- `room:participants` - 참가자 리스트 (방장에게만 전송)

  ```json
  {
    "roomId": "room-abc123",
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

  **전송 시점:**
  - 참가자가 방에 입장할 때
  - 참가자가 준비 상태를 변경할 때
  - 참가자가 닉네임을 변경할 때
  - 참가자가 방을 나갈 때

- `nickname:changed` - 닉네임 변경 확인 (개인)

  ```json
  {
    "roomId": "room-abc123",
    "nickname": "새로운닉네임"
  }
  ```

- `nickname:change:rejected` - 닉네임 변경 거부

  ```json
  {
    "roomId": "room-abc123",
    "reason": "INVALID_NICKNAME"
  }
  ```

- `ready:toggled` - 준비 상태 변경 확인 (본인에게 전송)

  ```json
  {
    "roomId": "room-abc123",
    "ready": true
  }
  ```

- `ready:toggle:rejected` - 준비 상태 변경 거부

  ```json
  {
    "roomId": "room-abc123",
    "reason": "ONLY_PARTICIPANTS_CAN_READY"
  }
  ```

- `room:left` - 방 나가기 성공 (v2.2)

  ```json
  {
    "roomId": "room-abc123",
    "leftAt": 1673456789000
  }
  ```

- `room:leave:rejected` - 방 나가기 거부 (v2.2)

  ```json
  {
    "roomId": "room-abc123",
    "reason": "INVALID_REQUEST" | "NOT_IN_ROOM" | "INTERNAL_ERROR"
  }
  ```

- `room:owner:left` - 방장이 나감 (v2.6, 참가자 연결 유지)

  ```json
  {
    "roomId": "room-abc123",
    "leftAt": 1673456789000
  }
  ```

  **설명:**
  - 방장이 `room:leave`를 요청하면 모든 참가자에게 이 이벤트가 브로드캐스트됨
  - **참가자의 연결은 유지됨** (강제 퇴장 없음)
  - 참가자는 방장이 돌아올 때까지 대기하거나 직접 나갈 수 있음
  - 방장은 30분 이내에 동일한 토큰으로 재입장 가능

- `room:closed` - 방 삭제됨 (TTL 만료 또는 명시적 삭제 시)

  ```json
  {
    "roomId": "room-abc123",
    "reason": "EXPIRED" | "DELETED",
    "closedAt": 1673456789000
  }
  ```

  **설명:**
  - 방이 완전히 삭제될 때만 전송됨 (TTL 만료 등)
  - 참가자는 이 이벤트를 받으면 자동으로 메인 화면으로 이동

---

### 3. 방장 전용 기능

**룰렛 설정:**

- 방 생성 시 초기 설정 가능 (winnersCount, winSentiment)
- 입장 후에도 실시간으로 설정 변경 가능
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

### 4. 참가자 관리 화면 (방장 전용, v2.1 신규)

**표시 정보:**

- 참가자 목록 (닉네임, 준비 상태)
- 준비 완료한 참가자 수 / 전체 참가자 수
- 모든 참가자 준비 완료 여부

**UI:**

- 각 참가자 항목에 준비 상태 표시 (✓ 또는 ⏳)
- 하단에 준비 현황 요약 (예: "2/3명 준비 완료")

### 5. 룰렛 스핀 화면

**방장:**

- [룰렛 돌리기] 버튼
  - 활성화 조건: 모든 참가자가 준비 완료 상태
  - 비활성화 시: "모든 참가자가 준비해야 합니다" 툴팁 표시

**참가자:**

- [준비 완료] / [준비 취소] 토글 버튼
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
    "reason": "NOT_OWNER" | "ALREADY_SPINNING" | "NO_MEMBERS" | "NOT_ALL_READY"
  }
  ```

  **reason 설명:**
  - `NOT_OWNER`: 방장이 아님
  - `ALREADY_SPINNING`: 이미 스핀 진행 중
  - `NO_MEMBERS`: 참가자 없음
  - `NOT_ALL_READY`: 모든 참가자가 준비 완료하지 않음

---

### 6. 결과 화면

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
  - 참가자 목록 (방장만, v2.1)
  - 참가자 준비 상태 (v2.1)
  - 본인 준비 상태 (참가자만, v2.1)
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
        withCredentials: true, // IMPORTANT: 쿠키 전송을 위해 필수
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
  // ownerToken은 HTTP-only 쿠키로 관리되므로 상태에서 제거됨

  // 사용자 정보
  myNickname: string | null;
  myRid: string | null;

  // 방 설정
  config: {
    winnersCount: number;
    winSentiment: 'POSITIVE' | 'NEGATIVE';
    updatedAt: number;
  } | null;

  // 참가자 목록 (v2.1, 방장에게만 제공)
  participants: Array<{
    nickname: string;
    rid: string;
    ready: boolean;
  }>;
  readyCount: number;
  allReady: boolean;

  // 본인 준비 상태 (v2.1, 참가자만)
  myReady: boolean;

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
  setParticipants: (participants: any[]) => void; // v2.1
  setMyReady: (ready: boolean) => void; // v2.1
  updateMyNickname: (nickname: string) => void; // v2.1
  startSpin: (spinId: string) => void;
  setMyOutcome: (outcome: 'WIN' | 'LOSE') => void;
  setAllOutcomes: (outcomes: any[]) => void;
  reset: () => void;
}
```

---

## UI/UX 고려사항

### 1. 닉네임 처리 (v2.1 업데이트)

- **방장**: 방 생성 시 닉네임 지정 가능 (미입력 시 '생성자')
- **참가자**: 방 입장 시 닉네임을 입력하지 않으면 서버에서 자동으로 '참가자 N' 부여
- 방 입장 후 닉네임 변경 가능 (1-20자)
- 닉네임 변경 시 방장에게 실시간으로 업데이트됨
- 변경된 닉네임은 룰렛 결과에도 반영됨

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

### 7. 준비 상태 표시 (v2.1 신규)

**방장 화면:**

- 참가자 목록에 각 참가자의 준비 상태 표시
- 준비 완료: ✓ 아이콘 (초록색)
- 준비 안됨: ⏳ 아이콘 (회색)
- 하단에 "2/3명 준비 완료" 형태로 요약 표시
- 모든 참가자 준비 시 [룰렛 돌리기] 버튼 활성화

**참가자 화면:**

- [준비 완료] 토글 버튼
- 준비 완료 상태에서는 [준비 취소] 버튼으로 변경
- 준비 상태는 룰렛을 돌린 후에도 유지됨

### 8. 방 나가기 처리 (v2.6 업데이트)

**방 나가기 버튼:**

- 모든 화면에 [방 나가기] 버튼 표시 (상단 헤더 또는 설정 메뉴)
- 클릭 시 확인 다이얼로그 표시
  - 참가자: "방을 나가시겠습니까?"
  - 방장: "방을 나가시겠습니까? 참가자들은 대기 상태로 유지됩니다."

**참가자 나가기:**

1. `room:leave` 이벤트 전송
2. `room:left` 이벤트 수신 시 메인 화면으로 이동
3. WebSocket 연결 종료

**방장 나가기 (v2.6 변경):**

1. `room:leave` 이벤트 전송
2. `room:left` 이벤트 수신 시 메인 화면으로 이동
3. **참가자들의 연결은 유지됨** (강제 퇴장 없음)
4. 방장은 30분 이내에 동일한 토큰으로 재입장 가능

**참가자의 방장 나감 알림 처리 (v2.6 변경):**

1. `room:owner:left` 이벤트 수신
2. 토스트로 "방장이 나갔습니다. 방장이 돌아올 때까지 대기하거나 나갈 수 있습니다." 알림 표시
3. **연결 유지** - 참가자는 계속 방에 머물 수 있음
4. UI에 "방장 부재중" 상태 표시
5. 참가자가 직접 나가거나 방 TTL 만료 시까지 대기

**방장 재입장 시:**

1. 방장이 다시 `room:join`으로 입장
2. 참가자들에게 `room:participants` 이벤트로 방장 입장 알림
3. 정상적인 룰렛 진행 가능

**에러 처리:**

- `room:leave:rejected` 수신 시 에러 메시지 표시
- 네트워크 오류 시 재시도 옵션 제공

---

## API 엔드포인트

### HTTP API

| Method | Endpoint | Description              | Request Body                                                                                                                      | Response                                                                                                        | Notes                                                                  |
| ------ | -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/rooms` | 방 생성                  | `{ title?, nickname?, winnersCount?, winSentiment? }` | `{ roomId, title, createdAt }`                                                               | ownerToken은 HTTP-only 쿠키로 자동 설정. URL은 프론트에서 조합 |
| GET    | `/rooms` | 내가 만든 방 목록 (v2.2) | 없음 (쿠키 자동 포함)                                                                                                             | `{ rooms: [{ roomId, title, participantCount, winnersCount, winSentiment, lastActivity, ownerNickname }], queriedAt }` | 쿠키의 모든 `owner_token_*`를 파싱하여 활성 방 목록 반환               |

### WebSocket 이벤트

#### Client → Server

| Event                         | Payload                                  | Description             |
| ----------------------------- | ---------------------------------------- | ----------------------- |
| `room:join`                   | `{ roomId, role, nickname? }`            | 방 입장 요청            |
| `room:config:set`             | `{ roomId, winnersCount, winSentiment }` | 방 설정 변경 (방장만)   |
| `spin:request`                | `{ roomId, requestId }`                  | 룰렛 스핀 요청 (방장만) |
| `participant:ready:toggle`    | `{ roomId, ready }`                      | 준비 상태 토글 (v2.1)   |
| `participant:nickname:change` | `{ roomId, nickname }`                   | 닉네임 변경 (v2.1)      |
| `room:leave`                  | `{ roomId }`                             | 방 나가기 (v2.2)        |

#### Server → Client

| Event                      | Payload                                                                           | Description                | 수신 대상 |
| -------------------------- | --------------------------------------------------------------------------------- | -------------------------- | --------- |
| `room:joined`              | `{ roomId, title, serverTime, you: { isOwner, nickname, rid } }`                  | 방 입장 완료               | 본인      |
| `room:join:rejected`       | `{ reason }`                                                                      | 방 입장 거부               | 본인      |
| `room:config`              | `{ roomId, winnersCount, winSentiment, updatedAt }`                               | 방 설정 정보               | 방 전체   |
| `room:config:rejected`     | `{ roomId, reason }`                                                              | 설정 변경 거부             | 본인      |
| `room:state`               | `{ roomId, ownerRid, lastSpin? }`                                                 | 방 상태 정보 (입장 시)     | 본인      |
| `room:participants`        | `{ roomId, participants, readyCount, totalCount, allReady }`                      | 참가자 리스트 (v2.1)       | 방장만    |
| `nickname:changed`         | `{ roomId, nickname }`                                                            | 닉네임 변경 확인 (v2.1)    | 본인      |
| `nickname:change:rejected` | `{ roomId, reason }`                                                              | 닉네임 변경 거부 (v2.1)    | 본인      |
| `ready:toggled`            | `{ roomId, ready }`                                                               | 준비 상태 변경 확인 (v2.7) | 본인      |
| `ready:toggle:rejected`    | `{ roomId, reason }`                                                              | 준비 상태 변경 거부 (v2.1) | 본인      |
| `room:left`                | `{ roomId, leftAt }`                                                              | 방 나가기 성공 (v2.2)      | 본인      |
| `room:leave:rejected`      | `{ roomId, reason }`                                                              | 방 나가기 거부 (v2.2)      | 본인      |
| `room:owner:left`          | `{ roomId, leftAt }`                                                              | 방장 나감 (v2.6)           | 방 전체   |
| `room:closed`              | `{ roomId, reason, closedAt }`                                                    | 방 삭제됨 (TTL 만료 등)    | 방 전체   |
| `spin:resolved`            | `{ roomId, requestId, spinId, winnersCount, winSentiment, decidedAt, animation }` | 스핀 시작                  | 방 전체   |
| `spin:outcome`             | `{ roomId, spinId, outcome, winSentiment }`                                       | 개인 결과                  | 본인      |
| `spin:result`              | `{ roomId, spinId, outcomes }`                                                    | 전체 결과                  | 방 전체   |
| `spin:rejected`            | `{ roomId, requestId, reason }`                                                   | 스핀 거부                  | 본인      |

---

## 환경 변수

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
```

---

## 보안 고려사항

### 쿠키 기반 인증

백엔드가 HTTP-only 쿠키로 방장 인증을 처리하므로, 프론트엔드에서는 다음 사항을 준수해야 합니다:

1. **HTTP API 호출 시 쿠키 전송**

   ```typescript
   // fetch 사용 시
   fetch('http://localhost:3001/rooms', {
     method: 'POST',
     credentials: 'include', // 쿠키 전송 필수
     headers: {
       'Content-Type': 'application/json',
     },
     body: JSON.stringify({ title, nickname, winnersCount, winSentiment }),
   });

   // axios 사용 시
   axios.post(
     'http://localhost:3001/rooms',
     { title, nickname, winnersCount, winSentiment },
     { withCredentials: true }, // 쿠키 전송 필수
   );
   ```

2. **Socket.IO 연결 시 쿠키 전송**

   ```typescript
   const socket = io('http://localhost:3001', {
     transports: ['websocket'],
     withCredentials: true, // 쿠키 전송 필수 (방장 인증용)
   });
   ```

3. **보안 이점**
   - **XSS 방지**: HTTP-only 쿠키는 JavaScript에서 접근 불가능하여 XSS 공격으로부터 보호
   - **자동 관리**: 브라우저가 쿠키를 자동으로 관리하여 개발자 실수 방지
   - **CSRF 보호**: SameSite=Lax 설정으로 CSRF 공격 완화
   - **자동 정리**: `GET /rooms` 호출 시 비활성 방의 쿠키가 서버에서 자동으로 삭제되어 불필요한 쿠키 누적 방지
   - **쿠키 구조**: v2.3부터 쿠키 값이 JSON 형식 `{roomId, token}`으로 저장되어 방 ID와 토큰을 함께 관리 (하위 호환성 유지)

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

1. 방장 전용 설정 UI (당첨자 수, 감정)
2. room:config:set 이벤트 처리
3. 링크 공유 기능
4. 참가자 목록 표시 (방장만, v2.1)
5. 참가자 준비 상태 실시간 표시 (v2.1)
6. 참가자 준비 완료 버튼 (v2.1)
7. 닉네임 변경 기능 (v2.1)

### Phase 4: 룰렛 스핀

1. 룰렛 UI 구현
2. 준비 완료 상태 확인 후 스핀 버튼 활성화 (v2.1)
3. spin:request 이벤트 송신
4. spin:resolved 수신 및 애니메이션 시작
5. spin:outcome 수신 및 개인 결과 저장
6. spin:result 수신 및 결과 화면 표시
7. NOT_ALL_READY 에러 처리 (v2.1)

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
- [ ] 참가자 목록 실시간 조회 (v2.1)
- [ ] 참가자 준비 상태 실시간 업데이트 (v2.1)
- [ ] 모든 참가자 준비 시에만 룰렛 돌리기 버튼 활성화 (v2.1)

### 4. 참가자 기능 테스트 (v2.1)

- [ ] 준비 완료 버튼 클릭
- [ ] 준비 상태 토글 (완료 ↔ 취소)
- [ ] 닉네임 변경 기능
- [ ] 변경된 닉네임이 방장에게 실시간 반영
- [ ] 방장은 준비 상태 변경 불가

### 5. 룰렛 스핀 테스트

- [ ] 방장이 스핀 요청
- [ ] 모든 참가자 준비 안됐을 때 스핀 거부 (v2.1)
- [ ] 모든 참가자가 spin:resolved 수신
- [ ] 애니메이션 동기화
- [ ] 각 참가자가 개인 결과 수신
- [ ] 전체 결과 표시 (변경된 닉네임 포함, v2.1)

### 6. 에러 처리 테스트

- [ ] 이미 방장이 있는 방에 owner로 입장 시도
- [ ] 참가자가 스핀 요청 시 거부
- [ ] 모든 참가자 준비 안됐을 때 스핀 거부 (v2.1)
- [ ] 닉네임 길이 초과 시 거부 (v2.1)
- [ ] 방장의 준비 상태 변경 시도 시 거부 (v2.1)
- [ ] WebSocket 연결 끊김 시 재연결

---

## 추가 개발 아이디어

### 필수는 아니지만 고려할 만한 기능

1. **방 비밀번호**
   - 방 생성 시 비밀번호 설정
   - 참가자 입장 시 비밀번호 요구

2. **참가자 목록 실시간 업데이트** (✅ v2.1에서 구현됨)
   - 참가자 입장/퇴장 시 알림
   - 현재 참가자 수 표시
   - 각 참가자의 준비 상태 표시

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

1. **방 생성**: HTTP API로 방 생성 (제목 포함), URL은 프론트에서 조합
2. **방 목록 조회**: 사용자가 만든 활성 방 목록 조회 (제목 포함, v2.2)
3. **방 입장**: WebSocket 연결 및 역할(방장/참가자) 구분
4. **닉네임 관리**: 입력하지 않으면 자동 생성 ('참가자 N'), 입장 후 변경 가능 (v2.1)
5. **준비 상태 시스템**: 모든 참가자가 준비 완료해야 룰렛 시작 (v2.1)
6. **참가자 관리**: 방장에게 실시간 참가자 목록 및 준비 상태 표시 (v2.1)
7. **룰렛 스핀**: 방장이 스핀 요청, 모든 참가자에게 결과 전달
8. **결과 표시**: 변경된 닉네임과 함께 당첨/낙첨 결과 표시
9. **방 나가기**: 참가자는 방 나가기, 방장은 일시 퇴장 (참가자 연결 유지, v2.6)

**백엔드는 이미 구현 완료**되었으므로 (v2.8 기준), 프론트엔드는 이 문서를 참고하여 개발하시면 됩니다.

### v2.8 주요 업데이트 (2026-01-13)

- ✅ 방 제목을 room:joined 이벤트에 추가
  - `room:joined` 응답에 `title` 필드 추가
  - 참가자도 방 입장 시 방 제목을 확인 가능
  - 기본값: "룰렛 방"

### v2.7 주요 업데이트 (2026-01-13)

- ✅ 준비 상태 확인 이벤트 추가
  - `ready:toggled` 이벤트로 참가자에게 준비 상태 변경 확인 전송
  - ready: true (준비 완료) 또는 ready: false (준비 취소) 포함
  - 참가자가 자신의 준비 상태를 UI에 정확히 반영 가능

### v2.6 주요 업데이트 (2026-01-13)

- ✅ 방장 나가기 시 참가자 연결 유지
  - 방장이 `room:leave` 해도 참가자들의 WebSocket 연결은 유지됨
  - `room:owner:left` 이벤트로 참가자들에게 방장 나감 알림
  - 참가자들은 방장이 돌아올 때까지 대기하거나 직접 나갈 수 있음
  - 방장은 30분 이내에 동일한 토큰으로 재입장 가능
- ✅ 사용자 경험 개선
  - 방장이 일시적으로 나가도 참가자들의 닉네임, 준비 상태 유지
  - 방 삭제는 TTL 만료 시에만 발생 (또는 별도 삭제 API 호출 시)

### v2.5 주요 업데이트 (2026-01-13)

- ✅ 방 생성 응답 간소화
  - `ownerUrl`, `participantUrl` 필드 제거
  - 응답: `{ roomId, title, createdAt }`만 반환
  - URL은 프론트엔드에서 조합: `/room/${roomId}?role=owner` 또는 `/room/${roomId}?role=participant`
  - `FRONTEND_URL` 환경변수 의존성 제거

### v2.4 주요 업데이트 (2026-01-12)

- ✅ 방장 재연결 지원
  - 방장이 탭을 닫았다가 다시 방에 입장 가능 (30분 이내)
  - 토큰 검증으로 같은 방장인지 확인
  - 활성 소켓 연결이 없으면 재입장 허용
  - 방장 연결 끊김 시 방 데이터 TTL을 30분으로 단축
- ✅ TTL 최적화
  - 방 데이터 TTL: 30분 (방장 재연결 허용 시간)
  - 소켓 활성 TTL: 2시간 (활성 연결 유지 시간)

### v2.3 주요 업데이트 (2026-01-12)

- ✅ 방 제목 기능 추가
  - 방 생성 시 제목 입력 가능 (최대 50자, 기본값: "룰렛 방")
  - Redis에 `room:title:{roomId}` 키로 저장
  - `GET /rooms` 응답에 제목 포함
  - `POST /rooms` 응답에 제목 포함
- ✅ 쿠키 구조 변경
  - 쿠키 값이 JSON 형식 `{roomId, token}`으로 저장
  - roomId와 토큰을 함께 관리하여 방 정보 추적 용이
  - 하위 호환성 유지 (이전 평문 토큰 형식도 지원)

### v2.2 주요 업데이트 (2026-01-12)

- ✅ 방 목록 조회 API 추가 (`GET /rooms`)
- ✅ 내가 만든 활성 방 목록 조회 기능
- ✅ 방 마지막 활동 시간 추적 (`lastActivity`)
- ✅ 방 나가기 기능 (`room:leave` 이벤트)
- ✅ 참가자 나가기: 깔끔한 연결 종료
- ✅ 방장 나가기: ~~방 완전 삭제 + 모든 참가자 강제 퇴장~~ → v2.6에서 참가자 연결 유지로 변경
- ✅ `room:closed` 이벤트로 참가자에게 방 삭제 알림 → v2.6에서 `room:owner:left`로 변경
- ✅ 비활성 방 쿠키 자동 삭제: `GET /rooms` 호출 시 만료된 방의 쿠키 자동 정리

### v2.1 주요 업데이트 (2025-01-09)

- ✅ 참가자 준비 상태 시스템 추가
- ✅ 닉네임 변경 기능 추가
- ✅ 방장에게 참가자 리스트 실시간 전송
- ✅ 모든 참가자 준비 완료 시에만 룰렛 시작 가능
- ✅ 준비 상태는 룰렛 회전 후에도 유지
