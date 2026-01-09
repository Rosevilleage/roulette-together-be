export interface CreateRoomResponseDto {
  roomId: string;
  ownerToken: string;
  ownerUrl: string;
  participantUrl: string;
  createdAt: number;
}
