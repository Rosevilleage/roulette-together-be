import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsNotEmpty } from 'class-validator';

export class ReadyToggleDto {
  @ApiProperty({
    description: '방 ID',
    example: 'room_abc123',
  })
  @IsString()
  @IsNotEmpty()
  roomId!: string;

  @ApiProperty({
    description: '준비 상태 (true: 준비 완료, false: 준비 취소)',
    example: true,
  })
  @IsBoolean()
  ready!: boolean;
}
