import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsAllExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsAllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    const data: unknown = host.switchToWs().getData();

    let errorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof WsException) {
      const error = exception.getError();
      if (typeof error === 'object' && error !== null) {
        const errorObj = error as Record<string, unknown>;
        errorCode =
          typeof errorObj.errorCode === 'string'
            ? errorObj.errorCode
            : errorCode;
        message =
          typeof errorObj.message === 'string' ? errorObj.message : message;
      } else if (typeof error === 'string') {
        message = error;
      }
    }

    const logContext: Record<string, unknown> = {
      clientId: client.id,
      data,
    };
    this.logger.error(`WebSocket error: ${errorCode} - ${message}`, logContext);

    // Emit error event to client
    client.emit('error', {
      reason: errorCode,
      message,
    });
  }
}
