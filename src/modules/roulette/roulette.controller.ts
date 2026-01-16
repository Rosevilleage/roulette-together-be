import { Controller, Logger, Post, Body, Res, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { randomBytes } from 'crypto';
import { RedisService, SocketInfo } from '../../common/redis/redis.service';
import { CreateRoomDto } from './dto/create-room.dto';
import type { CreateRoomResponseDto } from './dto/create-room-response.dto';
import {
  GetRoomsResponseDto,
  type RoomSummary,
} from './dto/get-rooms-response.dto';
import { parseOwnerToken } from './roulette.utils';

@ApiTags('Roulette')
@Controller({
  path: 'rooms',
  version: '1',
})
export class RouletteController {
  private readonly logger = new Logger(RouletteController.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.isProduction = this.configService.get('NODE_ENV') === 'production';
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // IP당 분당 10개 방 생성 제한
  @ApiOperation({ summary: '새로운 룰렛 방 생성' })
  @ApiResponse({
    status: 201,
    description: '방이 성공적으로 생성되었습니다.',
  })
  async createRoom(
    @Body() createRoomDto: CreateRoomDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateRoomResponseDto> {
    // Generate unique room ID
    const roomId = `room-${randomBytes(8).toString('hex')}`;

    // Generate owner token for verification
    const ownerToken = randomBytes(32).toString('hex');

    // Generate owner rid for reconnection verification
    const ownerRid = randomBytes(16).toString('hex');

    // Store owner token in Redis
    await this.redisService.setRoomOwnerToken(roomId, ownerToken);

    // Store room title (기본값: '룰렛 방')
    const roomTitle = createRoomDto.title?.trim() || '룰렛 방';
    try {
      await this.redisService.setRoomTitle(roomId, roomTitle);
    } catch (error: unknown) {
      this.logger.error('Error setting room title', error);
    }

    // Store initial owner nickname (기본값: '생성자')
    const ownerNickname = createRoomDto.nickname?.trim() || '생성자';
    try {
      await this.redisService.setInitialOwnerNickname(roomId, ownerNickname);
    } catch (error: unknown) {
      this.logger.error('Error setting initial owner nickname', error);
    }

    this.logger.log(`Room created: ${roomId}`);

    // Initialize room config with values from DTO or defaults
    const config = {
      winnersCount: createRoomDto.winnersCount ?? 1,
      winSentiment: (createRoomDto.winSentiment ?? 'POSITIVE') as
        | 'POSITIVE'
        | 'NEGATIVE',
      updatedAt: Date.now(),
    };
    await this.redisService.setRoomConfig(roomId, config);

    // Set owner token in secure HTTP-only cookie with roomId
    // Cookie expires in 2 hours (same as Redis TTL)
    const cookieValue = JSON.stringify({ roomId, token: ownerToken });
    res.cookie(`owner_token_${roomId}`, cookieValue, {
      httpOnly: true, // Prevents XSS attacks
      secure: this.isProduction, // HTTPS only in production
      sameSite: 'lax', // CSRF protection
      maxAge: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
      path: '/', // Cookie available for all paths
    });

    // Set owner rid cookie for reconnection verification
    // This ensures only the same browser can reconnect as owner
    res.cookie(`rid_${roomId}`, ownerRid, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: 2 * 60 * 60 * 1000,
      path: '/',
    });

    // Store owner rid in Redis (방장의 rid를 미리 설정)
    await this.redisService.setRoomOwner(roomId, ownerRid);

    // Initialize room activity timestamp
    await this.redisService.setRoomLastActivity(roomId);

    return {
      roomId,
      title: roomTitle,
      createdAt: Date.now(),
    };
  }

  @Get()
  @ApiOperation({ summary: '사용자가 생성한 활성 방 목록 조회' })
  @ApiResponse({
    status: 200,
    description: '활성 방 목록이 성공적으로 조회되었습니다.',
    type: GetRoomsResponseDto,
  })
  async getRooms(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GetRoomsResponseDto> {
    const ownerTokens = this.parseOwnerTokens(
      req.cookies as Record<string, string>,
    );

    if (Object.keys(ownerTokens).length === 0) {
      return { rooms: [], queriedAt: Date.now() };
    }

    const rooms = await this.fetchRoomsWithInfo(ownerTokens, res);
    rooms.sort((a, b) => b.lastActivity - a.lastActivity);

    return { rooms, queriedAt: Date.now() };
  }

  private parseOwnerTokens(
    cookies: Record<string, string>,
  ): Record<string, string> {
    const ownerTokens: Record<string, string> = {};

    for (const [cookieName, cookieValue] of Object.entries(cookies)) {
      if (!cookieName.startsWith('owner_token_')) {
        continue;
      }

      const roomId = cookieName.replace('owner_token_', '');
      const token = parseOwnerToken(cookieValue);
      if (token) {
        ownerTokens[roomId] = token;
      }
    }

    return ownerTokens;
  }

  private async fetchRoomsWithInfo(
    ownerTokens: Record<string, string>,
    res: Response,
  ): Promise<RoomSummary[]> {
    const roomIds = Object.keys(ownerTokens);

    // 배치로 토큰과 config 조회
    const [storedTokens, configs] = await Promise.all([
      this.redisService.getRoomOwnerTokenBatch(roomIds),
      this.redisService.getRoomConfigBatch(roomIds),
    ]);

    // 유효한 방만 필터링
    const validRoomIds = roomIds.filter((roomId) => {
      const storedToken = storedTokens.get(roomId);
      const config = configs.get(roomId);

      if (!storedToken || storedToken !== ownerTokens[roomId] || !config) {
        res.clearCookie(`owner_token_${roomId}`, { path: '/' });
        return false;
      }
      return true;
    });

    if (validRoomIds.length === 0) {
      return [];
    }

    // 배치로 메타데이터 조회
    const metadata = await this.redisService.getRoomMetadataBatch(validRoomIds);

    // 모든 멤버의 소켓 정보를 배치로 조회
    const allSocketIds = new Set<string>();
    for (const roomId of validRoomIds) {
      const roomMeta = metadata.get(roomId);
      roomMeta?.members.forEach((socketId) => allSocketIds.add(socketId));
    }
    const socketInfoMap = await this.redisService.getSocketInfoBatch(
      Array.from(allSocketIds),
    );

    // 방 정보 구성
    return validRoomIds.map((roomId) => {
      const config = configs.get(roomId)!;
      const roomMeta = metadata.get(roomId)!;

      const { ownerNickname, participantCount } = this.extractRoomStats(
        roomMeta.members,
        roomMeta.ownerRid,
        socketInfoMap,
      );

      return {
        roomId,
        title: roomMeta.title || '룰렛 방',
        participantCount,
        winnersCount: config.winnersCount,
        winSentiment: config.winSentiment,
        lastActivity: roomMeta.lastActivity || Date.now(),
        ownerNickname,
      };
    });
  }

  private extractRoomStats(
    members: string[],
    ownerRid: string | null,
    socketInfoMap: Map<string, SocketInfo | null>,
  ): { ownerNickname: string; participantCount: number } {
    let ownerNickname = '생성자';
    let participantCount = 0;

    for (const socketId of members) {
      const socketInfo = socketInfoMap.get(socketId);
      if (!socketInfo) continue;

      if (ownerRid && socketInfo.rid === ownerRid) {
        ownerNickname = socketInfo.nickname;
      }
      if (socketInfo.role === 'participant') {
        participantCount++;
      }
    }

    return { ownerNickname, participantCount };
  }
}
