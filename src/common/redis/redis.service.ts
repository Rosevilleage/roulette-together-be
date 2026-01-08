import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export interface RoomConfig {
  winnersCount: number;
  winSentiment: 'POSITIVE' | 'NEGATIVE';
  updatedAt: number;
}

export interface RoomState {
  lastSpin?: {
    spinId: string;
    resultSummary?: string;
    decidedAt: number;
  };
}

export interface SocketInfo {
  roomId: string;
  rid: string;
  lastSeen: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private readonly ttl = 1000 * 60 * 60 * 2; // 2 hours

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
    this.subscriber = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
    this.publisher = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    // Wait for all Redis clients to be ready
    await Promise.all([
      new Promise<void>((resolve) => {
        if (this.client.status === 'ready') {
          resolve();
        } else {
          this.client.once('ready', () => resolve());
        }
      }),
      new Promise<void>((resolve) => {
        if (this.subscriber.status === 'ready') {
          resolve();
        } else {
          this.subscriber.once('ready', () => resolve());
        }
      }),
      new Promise<void>((resolve) => {
        if (this.publisher.status === 'ready') {
          resolve();
        } else {
          this.publisher.once('ready', () => resolve());
        }
      }),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  getPublisher(): Redis {
    return this.publisher;
  }

  // Room config
  async getRoomConfig(roomId: string): Promise<RoomConfig | null> {
    const data = await this.client.get(`room:config:${roomId}`);
    return data ? (JSON.parse(data) as RoomConfig) : null;
  }

  async setRoomConfig(roomId: string, config: RoomConfig): Promise<void> {
    await this.client.set(
      `room:config:${roomId}`,
      JSON.stringify(config),
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }

  // Room owner
  async getRoomOwner(roomId: string): Promise<string | null> {
    return this.client.get(`room:owner:${roomId}`);
  }

  async setRoomOwner(roomId: string, rid: string): Promise<boolean> {
    const result = await this.client.set(
      `room:owner:${roomId}`,
      rid,
      'EX',
      Math.floor(this.ttl / 1000),
      'NX',
    );
    return result === 'OK';
  }

  // Room members
  async addRoomMember(roomId: string, socketId: string): Promise<void> {
    await this.client.sadd(`room:members:${roomId}`, socketId);
  }

  async removeRoomMember(roomId: string, socketId: string): Promise<void> {
    await this.client.srem(`room:members:${roomId}`, socketId);
  }

  async getRoomMembers(roomId: string): Promise<string[]> {
    return this.client.smembers(`room:members:${roomId}`);
  }

  // Socket info
  async setSocketInfo(socketId: string, info: SocketInfo): Promise<void> {
    await this.client.set(
      `room:socket:${socketId}`,
      JSON.stringify(info),
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }

  async getSocketInfo(socketId: string): Promise<SocketInfo | null> {
    const data = await this.client.get(`room:socket:${socketId}`);
    return data ? (JSON.parse(data) as SocketInfo) : null;
  }

  async removeSocketInfo(socketId: string): Promise<void> {
    await this.client.del(`room:socket:${socketId}`);
  }

  // Distributed lock for spin
  async acquireSpinLock(
    roomId: string,
    spinId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.client.set(
      `lock:spin:${roomId}`,
      spinId,
      'PX',
      ttlMs,
      'NX',
    );
    return result === 'OK';
  }

  async releaseSpinLock(roomId: string, spinId: string): Promise<void> {
    const lua = `
			if redis.call("get", KEYS[1]) == ARGV[1] then
				return redis.call("del", KEYS[1])
			else
				return 0
			end
		`;
    await this.client.eval(lua, 1, `lock:spin:${roomId}`, spinId);
  }

  // Idempotency
  async checkIdempotency(
    roomId: string,
    requestId: string,
  ): Promise<string | null> {
    return this.client.get(`idem:spin:${roomId}:${requestId}`);
  }

  async setIdempotency(
    roomId: string,
    requestId: string,
    spinId: string,
  ): Promise<void> {
    await this.client.set(`idem:spin:${roomId}:${requestId}`, spinId, 'EX', 30);
  }

  // Room state (optional)
  async getRoomState(roomId: string): Promise<RoomState | null> {
    const data = await this.client.get(`room:state:${roomId}`);
    return data ? (JSON.parse(data) as RoomState) : null;
  }

  async setRoomState(roomId: string, state: RoomState): Promise<void> {
    await this.client.set(
      `room:state:${roomId}`,
      JSON.stringify(state),
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }
}
