/**
 * 방 생성 API 관련 에러 코드
 * 모든 에러 코드는 대문자 스네이크 케이스(UPPER_SNAKE_CASE) 사용
 */
export enum RoomErrorCode {
  // Validation errors (400)
  /** 일반 유효성 검증 실패 */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** 방 제목 길이 초과 (max: 50자) */
  INVALID_TITLE_LENGTH = 'INVALID_TITLE_LENGTH',
  /** 닉네임 길이 초과 (max: 20자) */
  INVALID_NICKNAME_LENGTH = 'INVALID_NICKNAME_LENGTH',
  /** 당첨자 수 범위 오류 (1-100) */
  INVALID_WINNERS_COUNT = 'INVALID_WINNERS_COUNT',
  /** 승리 감정 값 오류 (POSITIVE 또는 NEGATIVE만 허용) */
  INVALID_WIN_SENTIMENT = 'INVALID_WIN_SENTIMENT',

  // Rate limiting (429)
  /** 요청 빈도 제한 초과 (10회/분) */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Server errors (500)
  /** 방 생성 실패 */
  ROOM_CREATION_FAILED = 'ROOM_CREATION_FAILED',
  /** 데이터베이스 오류 */
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * HTTP 상태 코드별 기본 에러 코드
 * AllExceptionsFilter에서 사용
 */
export const DEFAULT_ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
} as const;
