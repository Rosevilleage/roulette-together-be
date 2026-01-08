import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { SessionService } from '../session/session.service';
import { RoomJoinDto } from './dto/room-join.dto';
import { RoomConfigSetDto } from './dto/room-config-set.dto';
import { SpinRequestDto } from './dto/spin-request.dto';
import { randomBytes } from 'crypto';
import { RedisService } from 'src/common/redis/redis.service';

interface SocketWithRid extends Socket {
  data: {
    rid?: string;
  };
}

@Injectable()
export class RouletteService {
  constructor(
    private readonly redisService: RedisService,
    private readonly sessionService: SessionService,
  ) {}

  private getRid(socket: Socket): string | null {
    const rid = (socket as SocketWithRid).data.rid;
    return typeof rid === 'string' ? rid : null;
  }

  async handleRoomJoin(socket: Socket, data: RoomJoinDto): Promise<void> {
    if (!data?.roomId) {
      socket.disconnect();
      return;
    }

    const { roomId } = data;
    const rid = this.getRid(socket);

    if (!rid) {
      socket.disconnect();
      return;
    }

    // Join socket room
    await socket.join(roomId);

    // Add to Redis members set
    await this.redisService.addRoomMember(roomId, socket.id);

    // Store socket info
    await this.redisService.setSocketInfo(socket.id, {
      roomId,
      rid,
      lastSeen: Date.now(),
    });

    // Try to become owner (only first one succeeds)
    const isOwner = await this.redisService.setRoomOwner(roomId, rid);

    // Ensure default config exists
    let config = await this.redisService.getRoomConfig(roomId);
    if (!config) {
      config = {
        winnersCount: 1,
        winSentiment: 'POSITIVE',
        updatedAt: Date.now(),
      };
      await this.redisService.setRoomConfig(roomId, config);
    }

    // Send room:joined
    socket.emit('room:joined', {
      roomId,
      serverTime: Date.now(),
      you: { isOwner },
    });

    // Send room:config
    socket.emit('room:config', {
      roomId,
      ...config,
    });

    // Send room:state (optional)
    const state = await this.redisService.getRoomState(roomId);
    if (state) {
      const ownerRid = await this.redisService.getRoomOwner(roomId);
      socket.emit('room:state', {
        roomId,
        ownerRid: ownerRid || '',
        lastSpin: state.lastSpin,
      });
    }
  }

  async handleRoomConfigSet(
    socket: Socket,
    data: RoomConfigSetDto,
    server: Server,
  ): Promise<void> {
    const { roomId, winnersCount, winSentiment } = data;
    const rid = this.getRid(socket);

    if (!rid) {
      return;
    }

    // Validate
    if (winnersCount < 1) {
      socket.emit('room:config:rejected', {
        roomId,
        reason: 'INVALID',
      });
      return;
    }

    // Check ownership
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    if (ownerRid !== rid) {
      socket.emit('room:config:rejected', {
        roomId,
        reason: 'NOT_OWNER',
      });
      return;
    }

    // Update config
    const config = {
      winnersCount,
      winSentiment,
      updatedAt: Date.now(),
    };
    await this.redisService.setRoomConfig(roomId, config);

    // Broadcast to room
    server.to(roomId).emit('room:config', {
      roomId,
      ...config,
    });
  }

  async handleSpinRequest(
    socket: Socket,
    data: SpinRequestDto,
    server: Server,
  ): Promise<void> {
    const { roomId, requestId } = data;
    const rid = this.getRid(socket);

    if (!rid) {
      return;
    }

    // Check ownership
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    if (ownerRid !== rid) {
      socket.emit('spin:rejected', {
        roomId,
        requestId,
        reason: 'NOT_OWNER',
      });
      return;
    }

    // Check idempotency
    const existingSpinId = await this.redisService.checkIdempotency(
      roomId,
      requestId,
    );
    if (existingSpinId) {
      socket.emit('spin:rejected', {
        roomId,
        requestId,
        reason: 'IDEMPOTENT_REPLAY',
      });
      return;
    }

    // Generate spin ID
    const spinId = randomBytes(16).toString('hex');

    // Acquire distributed lock
    const lockAcquired = await this.redisService.acquireSpinLock(
      roomId,
      spinId,
      10000,
    ); // 10s lock
    if (!lockAcquired) {
      socket.emit('spin:rejected', {
        roomId,
        requestId,
        reason: 'ALREADY_SPINNING',
      });
      return;
    }

    try {
      // Get active members
      const allSocketIds = await this.redisService.getRoomMembers(roomId);
      const activeSocketIds: string[] = [];

      for (const socketId of allSocketIds) {
        const socketInfo = await this.redisService.getSocketInfo(socketId);
        if (socketInfo && socketInfo.roomId === roomId) {
          activeSocketIds.push(socketId);
        }
      }

      if (activeSocketIds.length === 0) {
        socket.emit('spin:rejected', {
          roomId,
          requestId,
          reason: 'NO_MEMBERS',
        });
        return;
      }

      // Get config
      const config = await this.redisService.getRoomConfig(roomId);
      if (!config) {
        socket.emit('spin:rejected', {
          roomId,
          requestId,
          reason: 'ROOM_NOT_FOUND',
        });
        return;
      }

      // Select winners
      const k = Math.min(config.winnersCount, activeSocketIds.length);
      const winners = this.selectRandom(activeSocketIds, k);
      const winnerSet = new Set(winners);

      // Set idempotency
      await this.redisService.setIdempotency(roomId, requestId, spinId);

      const decidedAt = Date.now();
      const revealAt = decidedAt + 2000; // 2s delay for animation
      const durationMs = 3000; // 3s animation

      // Broadcast spin:resolved to all
      server.to(roomId).emit('spin:resolved', {
        roomId,
        requestId,
        spinId,
        winnersCount: k,
        winSentiment: config.winSentiment,
        decidedAt,
        animation: {
          revealAt,
          durationMs,
        },
      });

      // Send individual outcomes
      for (const socketId of activeSocketIds) {
        const isWinner = winnerSet.has(socketId);
        const socketInstance = server.sockets.sockets.get(socketId);
        if (socketInstance) {
          socketInstance.emit('spin:outcome', {
            roomId,
            spinId,
            outcome: isWinner ? 'WIN' : 'LOSE',
            winSentiment: config.winSentiment,
          });
        }
      }

      // Update room state
      await this.redisService.setRoomState(roomId, {
        lastSpin: {
          spinId,
          decidedAt,
        },
      });
    } finally {
      // Release lock
      await this.redisService.releaseSpinLock(roomId, spinId);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const socketInfo = await this.redisService.getSocketInfo(socket.id);
    if (socketInfo) {
      const { roomId } = socketInfo;
      await this.redisService.removeRoomMember(roomId, socket.id);
      await this.redisService.removeSocketInfo(socket.id);
    }
  }

  private selectRandom<T>(array: T[], count: number): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
  }
}
