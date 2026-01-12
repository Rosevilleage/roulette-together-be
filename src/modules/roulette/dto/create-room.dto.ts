import {
  IsString,
  IsOptional,
  MaxLength,
  IsNumber,
  IsInt,
  Min,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WinSentiment } from './room-config-set.dto';

export class CreateRoomDto {
  @ApiProperty({
    description: '방 제목 (미입력 시 "룰렛 방"으로 설정됨)',
    example: '점심 메뉴 정하기',
    required: false,
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  title?: string;

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

  @ApiProperty({
    description: '승자 수 (1명 이상, 미입력 시 1명)',
    example: 3,
    minimum: 1,
    required: false,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  winnersCount?: number;

  @ApiProperty({
    description: '승리 감정 (긍정 또는 부정, 미입력 시 POSITIVE)',
    enum: WinSentiment,
    example: WinSentiment.POSITIVE,
    required: false,
    default: WinSentiment.POSITIVE,
  })
  @IsOptional()
  @IsEnum(WinSentiment)
  winSentiment?: WinSentiment;
}
