import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RoomErrorCode } from '../constants/error-codes';

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

/**
 * 방 생성 실패 예외
 * 방 생성 중 예기치 않은 오류 발생 시 사용
 */
export class RoomCreationFailedException extends InternalServerErrorException {
  constructor(reason?: string) {
    const response: {
      errorCode: string;
      message: string;
      details?: { reason: string };
    } = {
      errorCode: RoomErrorCode.ROOM_CREATION_FAILED,
      message: '방 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    };

    // 개발 환경에서만 details 포함
    if (reason && process.env.NODE_ENV !== 'production') {
      response.details = { reason };
    }

    super(response);
  }
}

/**
 * 데이터베이스 오류 예외
 * Redis 등 데이터베이스 작업 실패 시 사용
 */
export class DatabaseErrorException extends InternalServerErrorException {
  constructor(operation: string) {
    const response: {
      errorCode: string;
      message: string;
      details?: { operation: string };
    } = {
      errorCode: RoomErrorCode.DATABASE_ERROR,
      message: '데이터베이스 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    };

    // 개발 환경에서만 details 포함
    if (process.env.NODE_ENV !== 'production') {
      response.details = { operation };
    }

    super(response);
  }
}
