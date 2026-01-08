export interface RoomConfigSetDto {
  roomId: string;
  winnersCount: number;
  winSentiment: 'POSITIVE' | 'NEGATIVE';
}
