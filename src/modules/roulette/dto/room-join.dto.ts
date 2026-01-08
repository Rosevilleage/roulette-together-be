import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class RoomJoinDto {
  @ApiProperty({
    description: '입장할 방의 고유 ID',
    example: 'room-123',
  })
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @ApiPropertyOptional({
    description: '사용자 닉네임 (선택 사항)',
    example: '플레이어1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;
}
