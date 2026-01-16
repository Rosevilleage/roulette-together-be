import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  nickname: string;
  role: 'owner' | 'participant';
  lastSeen: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  // TTL constants
  private readonly ROOM_DATA_TTL = 1000 * 60 * 30; // 30 minutes (for room data when owner disconnects)
  private readonly SOCKET_DATA_TTL = 1000 * 60 * 60 * 2; // 2 hours (for active socket connections)
  private readonly ttl = this.SOCKET_DATA_TTL; // backward compatibility

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Connecting to Redis...');

    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
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

    this.logger.log('Redis connection established');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Redis connections...');
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

  async clearRoomOwner(roomId: string): Promise<void> {
    await this.client.del(`room:owner:${roomId}`);
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

  // Room tokens (owner verification)
  async setRoomOwnerToken(roomId: string, token: string): Promise<void> {
    await this.client.set(
      `room:owner:token:${roomId}`,
      token,
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }

  async getRoomOwnerToken(roomId: string): Promise<string | null> {
    return await this.client.get(`room:owner:token:${roomId}`);
  }

  async verifyRoomOwnerToken(roomId: string, token: string): Promise<boolean> {
    const storedToken = await this.client.get(`room:owner:token:${roomId}`);
    return storedToken === token;
  }

  // Room participant counter for auto-nickname
  async getNextParticipantNumber(roomId: string): Promise<number> {
    const count = await this.client.incr(`room:participant:counter:${roomId}`);
    await this.client.expire(
      `room:participant:counter:${roomId}`,
      Math.floor(this.ttl / 1000),
    );
    return count;
  }

  // Participant ready status
  async setParticipantReady(roomId: string, socketId: string): Promise<void> {
    await this.client.sadd(`room:ready:${roomId}`, socketId);
  }

  async removeParticipantReady(
    roomId: string,
    socketId: string,
  ): Promise<void> {
    await this.client.srem(`room:ready:${roomId}`, socketId);
  }

  async getReadyParticipants(roomId: string): Promise<string[]> {
    const members = await this.client.smembers(`room:ready:${roomId}`);
    return members;
  }

  // Update socket nickname
  async updateSocketNickname(
    socketId: string,
    nickname: string,
  ): Promise<void> {
    const socketInfo = await this.getSocketInfo(socketId);
    if (socketInfo) {
      socketInfo.nickname = nickname;
      await this.setSocketInfo(socketId, socketInfo);
    }
  }

  // Initial owner nickname (set during room creation)
  async setInitialOwnerNickname(
    roomId: string,
    nickname: string,
  ): Promise<void> {
    await this.client.set(
      `room:owner:initial-nickname:${roomId}`,
      nickname,
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }

  async getInitialOwnerNickname(roomId: string): Promise<string | null> {
    return this.client.get(`room:owner:initial-nickname:${roomId}`);
  }

  async removeInitialOwnerNickname(roomId: string): Promise<void> {
    await this.client.del(`room:owner:initial-nickname:${roomId}`);
  }

  // Room title
  async setRoomTitle(roomId: string, title: string): Promise<void> {
    await this.client.set(
      `room:title:${roomId}`,
      title,
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }

  async getRoomTitle(roomId: string): Promise<string | null> {
    return this.client.get(`room:title:${roomId}`);
  }

  async removeRoomTitle(roomId: string): Promise<void> {
    await this.client.del(`room:title:${roomId}`);
  }

  // Room last activity tracking
  async setRoomLastActivity(roomId: string): Promise<void> {
    const timestamp = Date.now();
    await this.client.set(
      `room:lastActivity:${roomId}`,
      timestamp.toString(),
      'EX',
      Math.floor(this.ttl / 1000),
    );
  }

  async getRoomLastActivity(roomId: string): Promise<number | null> {
    const timestamp = await this.client.get(`room:lastActivity:${roomId}`);
    return timestamp ? parseInt(timestamp, 10) : null;
  }

  // Full room deletion (owner exit)
  async deleteRoom(roomId: string): Promise<void> {
    const pipeline = this.client.pipeline();

    // Delete all room-related keys
    pipeline.del(`room:config:${roomId}`);
    pipeline.del(`room:owner:${roomId}`);
    pipeline.del(`room:owner:token:${roomId}`);
    pipeline.del(`room:owner:initial-nickname:${roomId}`);
    pipeline.del(`room:title:${roomId}`);
    pipeline.del(`room:participant:counter:${roomId}`);
    pipeline.del(`room:members:${roomId}`);
    pipeline.del(`room:ready:${roomId}`);
    pipeline.del(`room:state:${roomId}`);
    pipeline.del(`room:lastActivity:${roomId}`);
    pipeline.del(`lock:spin:${roomId}`);

    await pipeline.exec();
  }

  // Extend room TTL to 30 minutes (when owner disconnects)
  async extendRoomTTL(roomId: string): Promise<void> {
    const ttlSeconds = Math.floor(this.ROOM_DATA_TTL / 1000);
    const pipeline = this.client.pipeline();

    // Extend TTL for all room-related keys
    pipeline.expire(`room:config:${roomId}`, ttlSeconds);
    pipeline.expire(`room:owner:${roomId}`, ttlSeconds);
    pipeline.expire(`room:owner:token:${roomId}`, ttlSeconds);
    pipeline.expire(`room:title:${roomId}`, ttlSeconds);
    pipeline.expire(`room:participant:counter:${roomId}`, ttlSeconds);
    pipeline.expire(`room:state:${roomId}`, ttlSeconds);
    pipeline.expire(`room:lastActivity:${roomId}`, ttlSeconds);

    await pipeline.exec();
  }

  // Check if owner has an active socket connection
  async hasActiveOwnerConnection(roomId: string): Promise<boolean> {
    const ownerRid = await this.getRoomOwner(roomId);
    if (!ownerRid) {
      return false;
    }

    // Get all members and check if any of them is the owner
    const members = await this.getRoomMembers(roomId);
    for (const socketId of members) {
      const socketInfo = await this.getSocketInfo(socketId);
      if (socketInfo && socketInfo.rid === ownerRid) {
        return true;
      }
    }

    return false;
  }
}
