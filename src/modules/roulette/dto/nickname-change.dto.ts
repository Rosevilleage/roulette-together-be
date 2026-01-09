import { IsString, MinLength, MaxLength } from 'class-validator';

export class NicknameChangeDto {
  @IsString()
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  nickname!: string;
}
