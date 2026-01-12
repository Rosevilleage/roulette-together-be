import { IsString, IsNotEmpty } from 'class-validator';

export class RoomLeaveDto {
  @IsString()
  @IsNotEmpty()
  roomId: string;
}
