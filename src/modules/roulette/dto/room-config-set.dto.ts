import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum WinSentiment {
  POSITIVE = 'POSITIVE',
  NEGATIVE = 'NEGATIVE',
}

export class RoomConfigSetDto {
  @ApiProperty({
    description: '설정을 변경할 방의 고유 ID',
    example: 'room-123',
  })
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @ApiProperty({
    description: '승자 수 (1명 이상)',
    example: 3,
    minimum: 1,
  })
  @Type(() => Number)
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  winnersCount: number;

  @ApiProperty({
    description: '승리 감정 (긍정 또는 부정)',
    enum: ['POSITIVE', 'NEGATIVE'],
    example: 'POSITIVE',
  })
  @IsEnum(WinSentiment)
  winSentiment: 'POSITIVE' | 'NEGATIVE';
}
