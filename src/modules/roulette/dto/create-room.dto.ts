import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({
    description: '방장의 닉네임 (미입력 시 "생성자"로 설정됨)',
    example: '플레이어1',
    required: false,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nickname?: string;
}
