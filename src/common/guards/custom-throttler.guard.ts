import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Custom ThrottlerGuard that completely skips health check and metrics endpoints
 *
 * This prevents any Redis interaction on health check paths, avoiding hangs
 * when Redis is unavailable.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // Get the request object
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path || request.url;

    // Skip throttling entirely for health check and metrics endpoints
    // This prevents ANY Redis interaction that could cause hangs
    if (
      path === '/health' ||
      path.startsWith('/health/') ||
      path === '/metrics' ||
      path.startsWith('/metrics/')
    ) {
      return true; // Skip throttling completely
    }

    // For other paths, use the default @SkipThrottle() decorator behavior
    return super.shouldSkip(context);
  }
}
