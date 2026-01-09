import { IsString, IsBoolean } from 'class-validator';

export class ReadyToggleDto {
  @IsString()
  roomId!: string;

  @IsBoolean()
  ready!: boolean;
}
