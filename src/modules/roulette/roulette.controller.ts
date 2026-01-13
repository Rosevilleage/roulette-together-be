import { Controller, Post, Body, Res, Get, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { randomBytes } from 'crypto';
import { RedisService } from '../../common/redis/redis.service';
import { CreateRoomDto } from './dto/create-room.dto';
import type { CreateRoomResponseDto } from './dto/create-room-response.dto';
import {
  GetRoomsResponseDto,
  type RoomSummary,
} from './dto/get-rooms-response.dto';

@ApiTags('Roulette')
@Controller('rooms')
export class RouletteController {
  constructor(private readonly redisService: RedisService) {}

  @Post()
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

    // Store owner token in Redis
    await this.redisService.setRoomOwnerToken(roomId, ownerToken);

    // Store room title (기본값: '룰렛 방')
    const roomTitle = createRoomDto.title?.trim() || '룰렛 방';
    try {
      await this.redisService.setRoomTitle(roomId, roomTitle);
    } catch (error: unknown) {
      console.error('Error setting room title:', error);
    }

    // Store initial owner nickname (기본값: '생성자')
    const ownerNickname = createRoomDto.nickname?.trim() || '생성자';
    try {
      await this.redisService.setInitialOwnerNickname(roomId, ownerNickname);
    } catch (error: unknown) {
      console.error('Error setting initial owner nickname:', error);
    }

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
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax', // CSRF protection
      maxAge: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
      path: '/', // Cookie available for all paths
    });

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
    const cookies = req.cookies as Record<string, string>;
    const rooms: RoomSummary[] = [];

    // Parse all owner_token_* cookies
    for (const [cookieName, cookieValue] of Object.entries(cookies)) {
      if (!cookieName.startsWith('owner_token_')) {
        continue;
      }

      const roomId = cookieName.replace('owner_token_', '');

      // Parse cookie value (now contains {roomId, token})
      let token: string;
      try {
        const parsed = JSON.parse(cookieValue);
        token = parsed.token;
      } catch {
        // Old format (plain token) - still support for backward compatibility
        token = cookieValue;
      }

      // Verify token matches Redis
      const storedToken = await this.redisService.getRoomOwnerToken(roomId);
      if (!storedToken || storedToken !== token) {
        // Delete invalid/expired cookie
        res.clearCookie(`owner_token_${roomId}`, { path: '/' });
        continue; // Token mismatch or expired, skip
      }

      // Check if room still exists (config is primary indicator)
      const config = await this.redisService.getRoomConfig(roomId);
      if (!config) {
        // Delete cookie for expired room
        res.clearCookie(`owner_token_${roomId}`, { path: '/' });
        continue; // Room expired, skip
      }

      // Get additional room info
      const lastActivity = await this.redisService.getRoomLastActivity(roomId);
      const members = await this.redisService.getRoomMembers(roomId);
      const ownerRid = await this.redisService.getRoomOwner(roomId);
      const roomTitle = await this.redisService.getRoomTitle(roomId);

      // Get owner nickname from active socket or fallback to default
      let ownerNickname = '생성자';
      if (ownerRid) {
        for (const socketId of members) {
          const socketInfo = await this.redisService.getSocketInfo(socketId);
          if (socketInfo?.rid === ownerRid) {
            ownerNickname = socketInfo.nickname;
            break;
          }
        }
      }

      // Count participants (exclude owner)
      let participantCount = 0;
      for (const socketId of members) {
        const socketInfo = await this.redisService.getSocketInfo(socketId);
        if (socketInfo?.role === 'participant') {
          participantCount++;
        }
      }

      rooms.push({
        roomId,
        title: roomTitle || '룰렛 방',
        participantCount,
        winnersCount: config.winnersCount,
        winSentiment: config.winSentiment,
        lastActivity: lastActivity || Date.now(),
        ownerNickname,
      });
    }

    // Sort by lastActivity descending (most recent first)
    rooms.sort((a, b) => b.lastActivity - a.lastActivity);

    return {
      rooms,
      queriedAt: Date.now(),
    };
  }
}
