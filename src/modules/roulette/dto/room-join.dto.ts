import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoomJoinDto {
  @ApiProperty({
    description: '입장할 방의 고유 ID',
    example: 'room-123',
  })
  roomId: string;

  @ApiPropertyOptional({
    description: '사용자 닉네임 (선택 사항)',
    example: '플레이어1',
  })
  nickname?: string;
}
