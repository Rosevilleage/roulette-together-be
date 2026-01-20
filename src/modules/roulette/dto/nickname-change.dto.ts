import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class NicknameChangeDto {
  @IsString()
  @IsNotEmpty()
  roomId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  nickname!: string;
}
