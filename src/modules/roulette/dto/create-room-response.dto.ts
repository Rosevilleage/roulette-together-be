import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomResponseDto {
  @ApiProperty({
    description: '생성된 방의 고유 ID',
    example: 'room_abc123def456',
  })
  roomId: string;

  @ApiProperty({
    description: '방 제목',
    example: '오늘의 점심 당첨자',
  })
  title: string;

  @ApiProperty({
    description: '방 생성 시간 (Unix timestamp)',
    example: 1705312800000,
  })
  createdAt: number;
}
