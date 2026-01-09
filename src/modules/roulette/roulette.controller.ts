import { Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { RedisService } from '../../common/redis/redis.service';
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
  async createRoom(): Promise<CreateRoomResponseDto> {
    // Generate unique room ID
    const roomId = `room-${randomBytes(8).toString('hex')}`;

    // Generate owner token for verification
    const ownerToken = randomBytes(32).toString('hex');

    // Store owner token in Redis
    await this.redisService.setRoomOwnerToken(roomId, ownerToken);

    // Initialize room config
    const config = {
      winnersCount: 1,
      winSentiment: 'POSITIVE' as const,
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
