import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from './session.service';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get()
  getSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): { ok: boolean } {
    const existingRid = this.sessionService.getRidFromCookie(req);
    if (existingRid) {
      return { ok: true };
    }

    const rid = this.sessionService.generateRid();
    this.sessionService.setRidCookie(res, rid);
    return { ok: true };
  }
}
