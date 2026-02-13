import { ValidationError } from 'class-validator';
import { RoomErrorCode } from '../constants/error-codes';

/**
 * Validation 제약 조건에 대한 한글 메시지 매핑
 * CreateRoomDto 필드별로 사용자 친화적인 메시지 제공
 */

interface FieldMessageMap {
  [constraint: string]: string;
}

const FIELD_MESSAGES: Record<string, FieldMessageMap> = {
  title: {
    isString: '방 제목은 문자열이어야 합니다.',
    maxLength: '방 제목은 50자를 초과할 수 없습니다.',
    isNotEmpty: '방 제목을 입력해주세요.',
  },
  nickname: {
    isString: '닉네임은 문자열이어야 합니다.',
    maxLength: '닉네임은 20자를 초과할 수 없습니다.',
    isNotEmpty: '닉네임을 입력해주세요.',
  },
  winnersCount: {
    isNumber: '당첨자 수는 숫자여야 합니다.',
    isInt: '당첨자 수는 정수여야 합니다.',
    min: '당첨자 수는 1명 이상이어야 합니다.',
    max: '당첨자 수는 100명 이하여야 합니다.',
  },
  winSentiment: {
    isEnum: '승리 감정은 POSITIVE 또는 NEGATIVE여야 합니다.',
  },
};

/**
 * Validation 에러로부터 사용자 친화적인 한글 메시지를 생성
 * @param field - 에러가 발생한 필드명
 * @param constraints - 위반된 제약 조건들
 * @returns 사용자에게 표시할 한글 메시지
 */
export function getValidationMessage(
  field: string,
  constraints: Record<string, string>,
): string {
  const fieldMessages = FIELD_MESSAGES[field];

  if (!fieldMessages) {
    // 알 수 없는 필드인 경우 기본 메시지
    return '잘못된 요청입니다. 입력 정보를 확인해주세요.';
  }

  // 첫 번째 제약 조건에 대한 메시지 반환
  const constraintKey = Object.keys(constraints)[0];
  const message = fieldMessages[constraintKey];

  return message || '잘못된 요청입니다. 입력 정보를 확인해주세요.';
}

/**
 * Validation 에러로부터 적절한 에러 코드를 생성
 * @param field - 에러가 발생한 필드명
 * @param constraints - 위반된 제약 조건들
 * @returns 에러 코드
 */
export function getValidationErrorCode(
  field: string,
  constraints: Record<string, string>,
): string {
  const constraintKey = Object.keys(constraints)[0];

  // 필드와 제약 조건 조합으로 에러 코드 매핑
  const errorCodeMap: Record<string, string> = {
    'title-maxLength': RoomErrorCode.INVALID_TITLE_LENGTH,
    'nickname-maxLength': RoomErrorCode.INVALID_NICKNAME_LENGTH,
    'winnersCount-min': RoomErrorCode.INVALID_WINNERS_COUNT,
    'winnersCount-max': RoomErrorCode.INVALID_WINNERS_COUNT,
    'winnersCount-isInt': RoomErrorCode.INVALID_WINNERS_COUNT,
    'winnersCount-isNumber': RoomErrorCode.INVALID_WINNERS_COUNT,
    'winSentiment-isEnum': RoomErrorCode.INVALID_WIN_SENTIMENT,
  };

  const key = `${field}-${constraintKey}`;
  return errorCodeMap[key] || RoomErrorCode.VALIDATION_ERROR;
}

/**
 * ValidationError 배열을 받아 첫 번째 에러의 정보를 추출
 * @param errors - class-validator의 ValidationError 배열
 * @returns 필드명, 제약 조건, 값을 포함하는 객체
 */
export function extractFirstValidationError(errors: ValidationError[]): {
  field: string;
  constraints: Record<string, string>;
  value: unknown;
} | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const firstError = errors[0];
  return {
    field: firstError.property,
    constraints: firstError.constraints || {},
    value: firstError.value,
  };
}
