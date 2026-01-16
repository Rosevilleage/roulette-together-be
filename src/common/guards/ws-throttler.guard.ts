import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class WsThrottlerGuard implements CanActivate {
  private readonly requestCounts = new Map<string, number[]>();
  private readonly limit = 30; // 10초당 30 이벤트
  private readonly ttl = 10000;

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const clientId = client.id;
    const now = Date.now();

    const requests = this.requestCounts.get(clientId) || [];
    const recentRequests = requests.filter((time) => now - time < this.ttl);

    if (recentRequests.length >= this.limit) {
      client.emit('error:rate_limit', {
        message: 'Too many requests',
        retryAfter: Math.ceil((recentRequests[0] + this.ttl - now) / 1000),
      });
      return false;
    }

    recentRequests.push(now);
    this.requestCounts.set(clientId, recentRequests);

    // 주기적으로 오래된 데이터 정리
    if (Math.random() < 0.01) {
      this.cleanup();
    }

    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [clientId, requests] of this.requestCounts.entries()) {
      const recent = requests.filter((time) => now - time < this.ttl);
      if (recent.length === 0) {
        this.requestCounts.delete(clientId);
      } else {
        this.requestCounts.set(clientId, recent);
      }
    }
  }
}
