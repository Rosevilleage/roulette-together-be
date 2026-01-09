import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  IsEnum,
} from 'class-validator';

export type RoomRole = 'owner' | 'participant';

export class RoomJoinDto {
  @ApiProperty({
    description: '입장할 방의 고유 ID',
    example: 'room-123',
  })
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @ApiProperty({
    description: '방 입장 역할 (owner: 방장, participant: 참가자)',
    example: 'participant',
    enum: ['owner', 'participant'],
  })
  @IsEnum(['owner', 'participant'])
  role: RoomRole;

  @ApiPropertyOptional({
    description: '사용자 닉네임 (선택 사항, 없으면 자동 생성)',
    example: '플레이어1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;
}
