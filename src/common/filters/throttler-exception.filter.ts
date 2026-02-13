import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RoomErrorCode } from '../constants/error-codes';
import { ErrorResponse } from '../interfaces/error-response.interface';

/**
 * Throttler Exception Filter
 * Rate limit 초과 시 사용자 친화적인 한글 메시지 제공
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ThrottlerExceptionFilter.name);

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse: ErrorResponse = {
      statusCode: 429,
      errorCode: RoomErrorCode.RATE_LIMIT_EXCEEDED,
      message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.',
      timestamp: new Date().toISOString(),
      path: request.url,
      details: {
        limit: 10,
        window: '1분',
      },
    };

    this.logger.warn(
      `${request.method} ${request.url} - Rate limit exceeded for IP: ${request.ip}`,
    );

    response.status(429).json(errorResponse);
  }
}
