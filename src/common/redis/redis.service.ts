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

/**
 * Redis 서비스
 *
 * 룰렛 게임의 모든 상태를 Redis에 저장하고 관리합니다.
 * - 방 설정 및 멤버 관리
 * - 소켓 정보 추적
 * - 분산 락 및 멱등성 키 관리
 *
 * @remarks
 * 모든 키는 기본 2시간 TTL을 가지며, 방장 퇴장 시 30분으로 단축됩니다.
 * 멀티 인스턴스 환경을 위해 별도의 subscriber/publisher 클라이언트를 제공합니다.
 */
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

  /**
   * 분산 락 획득
   *
   * @param roomId - 방 ID
   * @param spinId - 락 소유자 식별값 (해제 시 검증용)
   * @param ttlMs - 락 만료 시간 (밀리초)
   * @returns 락 획득 성공 여부
   *
   * @example
   * const acquired = await this.redisService.acquireSpinLock('room123', 'spin_abc', 10000);
   * if (!acquired) {
   *   throw new AlreadySpinningException();
   * }
   */
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

  /**
   * 분산 락 해제
   *
   * @param roomId - 방 ID
   * @param spinId - 락 소유자 식별값
   *
   * @remarks
   * Lua 스크립트를 사용하여 원자적으로 락을 해제합니다.
   * 본인이 소유한 락만 해제할 수 있습니다.
   */
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

  /**
   * 멱등성 키 확인
   *
   * @param roomId - 방 ID
   * @param requestId - 클라이언트가 제공한 요청 ID
   * @returns 이미 처리된 요청이면 spinId, 아니면 null
   *
   * @remarks
   * 30초 TTL로 중복 요청을 방지합니다.
   */
  async checkIdempotency(
    roomId: string,
    requestId: string,
  ): Promise<string | null> {
    return this.client.get(`idem:spin:${roomId}:${requestId}`);
  }

  /**
   * 멱등성 키 설정
   *
   * @param roomId - 방 ID
   * @param requestId - 클라이언트가 제공한 요청 ID
   * @param spinId - 생성된 스핀 ID
   */
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

    // First, get all members to sync their socket TTL
    const members = await this.getRoomMembers(roomId);

    const pipeline = this.client.pipeline();

    // Extend TTL for all room-related keys (must be synchronized)
    pipeline.expire(`room:config:${roomId}`, ttlSeconds);
    pipeline.expire(`room:owner:${roomId}`, ttlSeconds);
    pipeline.expire(`room:owner:token:${roomId}`, ttlSeconds);
    pipeline.expire(`room:owner:initial-nickname:${roomId}`, ttlSeconds);
    pipeline.expire(`room:title:${roomId}`, ttlSeconds);
    pipeline.expire(`room:participant:counter:${roomId}`, ttlSeconds);
    pipeline.expire(`room:state:${roomId}`, ttlSeconds);
    pipeline.expire(`room:lastActivity:${roomId}`, ttlSeconds);
    pipeline.expire(`room:members:${roomId}`, ttlSeconds);
    pipeline.expire(`room:ready:${roomId}`, ttlSeconds);

    // Sync socket TTL with room TTL
    for (const socketId of members) {
      pipeline.expire(`room:socket:${socketId}`, ttlSeconds);
    }

    await pipeline.exec();
  }

  // Check if owner has an active socket connection
  async hasActiveOwnerConnection(roomId: string): Promise<boolean> {
    const socketId = await this.getActiveOwnerSocketId(roomId);
    return socketId !== null;
  }

  // Get the active owner's socket ID (if connected)
  async getActiveOwnerSocketId(roomId: string): Promise<string | null> {
    const ownerRid = await this.getRoomOwner(roomId);
    if (!ownerRid) {
      return null;
    }

    // Get all members and check if any of them is the owner
    const members = await this.getRoomMembers(roomId);
    if (members.length === 0) {
      return null;
    }

    // Use batch query to avoid N+1 problem
    const socketInfoMap = await this.getSocketInfoBatch(members);
    for (const socketId of members) {
      const socketInfo = socketInfoMap.get(socketId);
      if (socketInfo && socketInfo.rid === ownerRid) {
        return socketId;
      }
    }

    return null;
  }

  /**
   * 여러 소켓 정보를 한 번에 조회 (배치)
   */
  async getSocketInfoBatch(
    socketIds: string[],
  ): Promise<Map<string, SocketInfo | null>> {
    if (socketIds.length === 0) {
      return new Map();
    }

    const pipeline = this.client.pipeline();
    socketIds.forEach((socketId) => {
      pipeline.get(`room:socket:${socketId}`);
    });

    const results = await pipeline.exec();
    const map = new Map<string, SocketInfo | null>();

    socketIds.forEach((socketId, index) => {
      const result = results?.[index];
      if (!result) {
        map.set(socketId, null);
        return;
      }
      const [err, data] = result;
      if (err || !data) {
        map.set(socketId, null);
      } else {
        map.set(socketId, JSON.parse(data as string) as SocketInfo);
      }
    });

    return map;
  }

  /**
   * 방 멤버와 정보를 한 번에 조회
   */
  async getRoomMembersWithInfo(roomId: string): Promise<SocketInfo[]> {
    const members = await this.getRoomMembers(roomId);
    if (members.length === 0) {
      return [];
    }

    const infoMap = await this.getSocketInfoBatch(members);
    return Array.from(infoMap.values()).filter(
      (info): info is SocketInfo => info !== null,
    );
  }

  /**
   * 여러 방의 config를 한 번에 조회 (배치)
   */
  async getRoomConfigBatch(
    roomIds: string[],
  ): Promise<Map<string, RoomConfig | null>> {
    if (roomIds.length === 0) {
      return new Map();
    }

    const pipeline = this.client.pipeline();
    roomIds.forEach((roomId) => {
      pipeline.get(`room:config:${roomId}`);
    });

    const results = await pipeline.exec();
    const map = new Map<string, RoomConfig | null>();

    roomIds.forEach((roomId, index) => {
      const result = results?.[index];
      if (!result) {
        map.set(roomId, null);
        return;
      }
      const [err, data] = result;
      if (err || !data) {
        map.set(roomId, null);
      } else {
        map.set(roomId, JSON.parse(data as string) as RoomConfig);
      }
    });

    return map;
  }

  /**
   * 여러 방의 owner token을 한 번에 조회 (배치)
   */
  async getRoomOwnerTokenBatch(
    roomIds: string[],
  ): Promise<Map<string, string | null>> {
    if (roomIds.length === 0) {
      return new Map();
    }

    const pipeline = this.client.pipeline();
    roomIds.forEach((roomId) => {
      pipeline.get(`room:owner:token:${roomId}`);
    });

    const results = await pipeline.exec();
    const map = new Map<string, string | null>();

    roomIds.forEach((roomId, index) => {
      const result = results?.[index];
      if (!result) {
        map.set(roomId, null);
        return;
      }
      const [err, data] = result;
      if (err || !data) {
        map.set(roomId, null);
      } else {
        map.set(roomId, data as string);
      }
    });

    return map;
  }

  /**
   * 여러 방의 메타데이터를 한 번에 조회 (배치)
   */
  async getRoomMetadataBatch(roomIds: string[]): Promise<
    Map<
      string,
      {
        title: string | null;
        lastActivity: number | null;
        ownerRid: string | null;
        members: string[];
      }
    >
  > {
    if (roomIds.length === 0) {
      return new Map();
    }

    const pipeline = this.client.pipeline();
    roomIds.forEach((roomId) => {
      pipeline.get(`room:title:${roomId}`);
      pipeline.get(`room:lastActivity:${roomId}`);
      pipeline.get(`room:owner:${roomId}`);
      pipeline.smembers(`room:members:${roomId}`);
    });

    const results = await pipeline.exec();
    const map = new Map<
      string,
      {
        title: string | null;
        lastActivity: number | null;
        ownerRid: string | null;
        members: string[];
      }
    >();

    roomIds.forEach((roomId, index) => {
      const baseIndex = index * 4;
      const titleResult = results?.[baseIndex];
      const activityResult = results?.[baseIndex + 1];
      const ownerResult = results?.[baseIndex + 2];
      const membersResult = results?.[baseIndex + 3];

      map.set(roomId, {
        title: titleResult?.[1] as string | null,
        lastActivity: activityResult?.[1]
          ? parseInt(activityResult[1] as string, 10)
          : null,
        ownerRid: ownerResult?.[1] as string | null,
        members: (membersResult?.[1] as string[]) || [],
      });
    });

    return map;
  }
}
