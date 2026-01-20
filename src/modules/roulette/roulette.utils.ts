import { randomBytes } from 'crypto';

/**
 * Generate a unique room-scoped ID
 */
export function generateRid(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/**
 * Generate default nickname based on role
 */
export function generateDefaultNickname(
  role: 'owner' | 'participant',
  participantNumber?: number,
): string {
  return role === 'owner' ? '생성자' : `참가자 ${participantNumber}`;
}

/**
 * Parse cookies from cookie header string
 */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      cookies[key] = decodeURIComponent(value);
    }
  });
  return cookies;
}

// 토큰 형식: 64자리 hex 문자열 (randomBytes(32) = 32바이트 = 64자리 hex)
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Parse owner token from cookie value
 * Supports both new format ({roomId, token}) and old format (plain token)
 */
export function parseOwnerToken(cookieValue: string): string | undefined {
  if (!cookieValue) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(cookieValue);
    // 명시적 구조 검증
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'token' in parsed &&
      typeof (parsed as { token: unknown }).token === 'string'
    ) {
      const token = (parsed as { token: string }).token;
      return TOKEN_PATTERN.test(token) ? token : undefined;
    }
    return undefined;
  } catch {
    // 레거시 호환: 일반 문자열 토큰
    return TOKEN_PATTERN.test(cookieValue) ? cookieValue : undefined;
  }
}

/**
 * Fisher-Yates shuffle to select random items
 */
export function selectRandom<T>(array: T[], count: number): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
