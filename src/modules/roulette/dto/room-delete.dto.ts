import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RoomDeleteDto {
  @ApiProperty({
    description: '삭제할 방 ID',
    example: 'room_abc123',
  })
  @IsString()
  @IsNotEmpty()
  roomId: string;
}
