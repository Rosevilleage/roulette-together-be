import { Controller, Get, Req, Res } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SessionService } from './session.service';

@ApiTags('Session')
@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get()
  @ApiOperation({
    summary: '세션 생성 또는 확인',
    description:
      '기존 세션이 있으면 확인하고, 없으면 새로운 세션을 생성하여 rid 쿠키를 설정합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세션 생성 또는 확인 성공',
    schema: {
      type: 'object',
      properties: {
        ok: {
          type: 'boolean',
          example: true,
          description: '성공 여부',
        },
      },
    },
  })
  @ApiCookieAuth('rid')
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
