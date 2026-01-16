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

/**
 * Parse owner token from cookie value
 * Supports both new format ({roomId, token}) and old format (plain token)
 */
export function parseOwnerToken(cookieValue: string): string | undefined {
  if (!cookieValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(cookieValue) as { token: string };
    return parsed.token;
  } catch {
    // Old format (plain token) - backward compatibility
    return cookieValue;
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
