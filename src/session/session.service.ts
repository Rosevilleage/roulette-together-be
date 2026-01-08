import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHmac, randomBytes } from 'crypto';

@Injectable()
export class SessionService {
  private readonly secretKey: string;

  constructor() {
    this.secretKey =
      process.env.SESSION_SECRET || 'default-secret-key-change-in-production';
  }

  generateRid(): string {
    const random = randomBytes(16).toString('hex');
    const timestamp = Date.now().toString();
    const payload = `${random}:${timestamp}`;
    const signature = createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
    return `${payload}:${signature}`;
  }

  verifyRid(rid: string): boolean {
    try {
      const parts = rid.split(':');
      if (parts.length !== 3) {
        return false;
      }
      const [random, timestamp, receivedSignature] = parts;
      const payload = `${random}:${timestamp}`;
      const expectedSignature = createHmac('sha256', this.secretKey)
        .update(payload)
        .digest('hex');
      return receivedSignature === expectedSignature;
    } catch {
      return false;
    }
  }

  getRidFromCookie(req: Request): string | null {
    return req.cookies?.rid as unknown as string | null;
  }

  setRidCookie(res: Response, rid: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('rid', rid, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
  }
}
