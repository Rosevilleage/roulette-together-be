import { ApiProperty } from '@nestjs/swagger';

export interface RoomSummary {
  roomId: string;
  title: string;
  participantCount: number;
  winnersCount: number;
  winSentiment: 'POSITIVE' | 'NEGATIVE';
  lastActivity: number;
  ownerNickname: string;
}

export class GetRoomsResponseDto {
  @ApiProperty({
    description: '사용자가 생성한 활성 방 목록',
    type: [Object],
  })
  rooms: RoomSummary[];

  @ApiProperty({
    description: '조회 시각',
    example: 1673456789000,
  })
  queriedAt: number;
}
