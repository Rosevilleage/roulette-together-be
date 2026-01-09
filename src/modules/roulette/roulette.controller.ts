import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { RedisService } from '../../common/redis/redis.service';
import { CreateRoomDto } from './dto/create-room.dto';
import type { CreateRoomResponseDto } from './dto/create-room-response.dto';

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
  ): Promise<CreateRoomResponseDto> {
    // Generate unique room ID
    const roomId = `room-${randomBytes(8).toString('hex')}`;

    // Generate owner token for verification
    const ownerToken = randomBytes(32).toString('hex');

    // Store owner token in Redis
    await this.redisService.setRoomOwnerToken(roomId, ownerToken);

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

    // Generate URLs (프론트엔드 URL은 환경변수로 관리)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const ownerUrl = `${frontendUrl}/room/${roomId}?role=owner&token=${ownerToken}`;
    const participantUrl = `${frontendUrl}/room/${roomId}?role=participant`;

    return {
      roomId,
      ownerToken,
      ownerUrl,
      participantUrl,
      createdAt: Date.now(),
    };
  }
}
