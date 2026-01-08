import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class SpinRequestDto {
  @ApiProperty({
    description: '룰렛을 돌릴 방의 고유 ID',
    example: 'room-123',
  })
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @ApiProperty({
    description: '중복 요청 방지를 위한 고유 요청 ID (UUID v4)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  requestId: string;
}
