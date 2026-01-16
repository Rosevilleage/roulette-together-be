import { NotFoundException, BadRequestException } from '@nestjs/common';

export class RoomNotFoundException extends NotFoundException {
  constructor(roomId: string) {
    super({
      errorCode: 'ROOM_NOT_FOUND',
      message: `Room with ID '${roomId}' does not exist`,
    });
  }
}

export class RoomFullException extends BadRequestException {
  constructor(roomId: string) {
    super({
      errorCode: 'ROOM_FULL',
      message: `Room '${roomId}' has reached maximum capacity`,
    });
  }
}

export class InvalidOwnerTokenException extends BadRequestException {
  constructor() {
    super({
      errorCode: 'INVALID_OWNER_TOKEN',
      message: 'Invalid or missing owner token',
    });
  }
}

export class NotAllReadyException extends BadRequestException {
  constructor() {
    super({
      errorCode: 'NOT_ALL_READY',
      message: 'Not all participants are ready',
    });
  }
}

export class AlreadySpinningException extends BadRequestException {
  constructor() {
    super({
      errorCode: 'ALREADY_SPINNING',
      message: 'A spin is already in progress',
    });
  }
}
