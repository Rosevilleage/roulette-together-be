import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { RoomJoinDto } from './dto/room-join.dto';
import { RoomConfigSetDto } from './dto/room-config-set.dto';
import { SpinRequestDto } from './dto/spin-request.dto';
import { ReadyToggleDto } from './dto/ready-toggle.dto';
import { NicknameChangeDto } from './dto/nickname-change.dto';
import { RedisService } from 'src/common/redis/redis.service';

interface SocketWithData extends Socket {
  data: {
    rid?: string;
    nickname?: string;
    role?: 'owner' | 'participant';
  };
}

@Injectable()
export class RouletteService {
  constructor(private readonly redisService: RedisService) {}

  private getRid(socket: Socket): string | null {
    const rid = (socket as SocketWithData).data.rid;
    return typeof rid === 'string' ? rid : null;
  }

  private getNickname(socket: Socket): string | null {
    const nickname = (socket as SocketWithData).data.nickname;
    return typeof nickname === 'string' ? nickname : null;
  }

  private getRole(socket: Socket): 'owner' | 'participant' | null {
    const role = (socket as SocketWithData).data.role;
    return role === 'owner' || role === 'participant' ? role : null;
  }

  async handleRoomJoin(
    socket: Socket,
    data: RoomJoinDto,
    server: Server,
  ): Promise<void> {
    if (!data?.roomId || !data?.role) {
      socket.emit('room:join:rejected', {
        reason: 'INVALID_REQUEST',
      });
      return;
    }

    const { roomId, role } = data;
    const rid = this.getRid(socket);

    if (!rid) {
      socket.emit('room:join:rejected', {
        reason: 'INVALID_RID',
      });
      return;
    }

    // Determine nickname
    let nickname = data.nickname?.trim();
    if (!nickname) {
      // Generate auto nickname
      const participantNumber =
        await this.redisService.getNextParticipantNumber(roomId);
      nickname = `참가자 ${participantNumber}`;
    }

    // Verify owner token if role is owner
    if (role === 'owner') {
      // For owner role, we need a token from query params
      // This should be validated in gateway before joining
      const ownerRid = await this.redisService.getRoomOwner(roomId);

      // If room already has owner and this rid is not the owner, reject
      if (ownerRid && ownerRid !== rid) {
        socket.emit('room:join:rejected', {
          reason: 'OWNER_ALREADY_EXISTS',
        });
        return;
      }

      // Set as owner if not already set
      if (!ownerRid) {
        await this.redisService.setRoomOwner(roomId, rid);
      }
    }

    // Join socket room
    await socket.join(roomId);

    // Add to Redis members set
    await this.redisService.addRoomMember(roomId, socket.id);

    // Store socket info with nickname and role
    await this.redisService.setSocketInfo(socket.id, {
      roomId,
      rid,
      nickname,
      role: role as 'owner' | 'participant',
      lastSeen: Date.now(),
    });

    // Check if user is owner
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    const isOwner = ownerRid === rid;

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
      you: {
        isOwner,
        nickname,
        rid,
      },
    });

    // Send room:config
    socket.emit('room:config', {
      roomId,
      ...config,
    });

    // Send room:state (optional)
    const state = await this.redisService.getRoomState(roomId);
    if (state) {
      socket.emit('room:state', {
        roomId,
        ownerRid: ownerRid || '',
        lastSpin: state.lastSpin,
      });
    }

    // Broadcast participants list to owner (if a participant joined)
    if (role === 'participant') {
      await this.broadcastParticipantsToOwner(roomId, server);
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
      const participantSocketIds: string[] = [];

      for (const socketId of allSocketIds) {
        const socketInfo = await this.redisService.getSocketInfo(socketId);
        if (socketInfo && socketInfo.roomId === roomId) {
          activeSocketIds.push(socketId);
          // Collect participants (not owner)
          if (socketInfo.role === 'participant') {
            participantSocketIds.push(socketId);
          }
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

      // Check if all participants are ready
      let readyParticipants: string[] = [];
      try {
        const result = await this.redisService.getReadyParticipants(roomId);
        readyParticipants = result;
      } catch (error: unknown) {
        console.error('Error getting ready participants:', error);
      }
      const readySet = new Set<string>(readyParticipants);

      const allParticipantsReady = participantSocketIds.every((socketId) =>
        readySet.has(socketId),
      );

      // Only require ready check if there are participants
      if (participantSocketIds.length > 0 && !allParticipantsReady) {
        socket.emit('spin:rejected', {
          roomId,
          requestId,
          reason: 'NOT_ALL_READY',
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

      // Send individual outcomes with nickname
      const outcomes: Array<{
        socketId: string;
        nickname: string;
        outcome: 'WIN' | 'LOSE';
      }> = [];

      for (const socketId of activeSocketIds) {
        const isWinner = winnerSet.has(socketId);
        const socketInfo = await this.redisService.getSocketInfo(socketId);
        const nickname = socketInfo?.nickname || '알 수 없음';

        outcomes.push({
          socketId,
          nickname,
          outcome: isWinner ? 'WIN' : 'LOSE',
        });

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

      // Broadcast result summary to all (with nicknames)
      server.to(roomId).emit('spin:result', {
        roomId,
        spinId,
        outcomes: outcomes.map((o) => ({
          nickname: o.nickname,
          outcome: o.outcome,
        })),
      });

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

  async handleDisconnect(socket: Socket, server: Server): Promise<void> {
    try {
      const socketInfo = await this.redisService.getSocketInfo(socket.id);
      if (socketInfo) {
        const { roomId, role } = socketInfo;

        // Remove from ready list if applicable
        await this.redisService.removeParticipantReady(roomId, socket.id);

        // Remove from room members
        await this.redisService.removeRoomMember(roomId, socket.id);
        await this.redisService.removeSocketInfo(socket.id);

        // Broadcast updated participants list to owner (if a participant left)
        if (role === 'participant') {
          await this.broadcastParticipantsToOwner(roomId, server);
        }
      }
    } catch (error: unknown) {
      // Log error but don't throw - disconnect should always succeed
      console.error('Error in handleDisconnect:', error);
    }
  }

  handleReadyToggle(
    socket: Socket,
    data: ReadyToggleDto,
    server: Server,
  ): void {
    const { roomId, ready } = data;
    const rid = this.getRid(socket);

    if (!rid) {
      return;
    }

    // Handle asynchronously without blocking
    void (async (): Promise<void> => {
      try {
        // Get socket info to check role
        const socketInfo = await this.redisService.getSocketInfo(socket.id);
        if (!socketInfo) {
          return;
        }

        // Only participants can toggle ready state (not owner)
        if (socketInfo.role !== 'participant') {
          socket.emit('ready:toggle:rejected', {
            roomId,
            reason: 'ONLY_PARTICIPANTS_CAN_READY',
          });
          return;
        }

        // Update ready state in Redis
        if (ready) {
          await this.redisService.setParticipantReady(roomId, socket.id);
        } else {
          await this.redisService.removeParticipantReady(roomId, socket.id);
        }

        // Broadcast participants list to owner
        await this.broadcastParticipantsToOwner(roomId, server);
      } catch (error: unknown) {
        console.error('Error in handleReadyToggle:', error);
        socket.emit('ready:toggle:rejected', {
          roomId,
          reason: 'INTERNAL_ERROR',
        });
      }
    })();
  }

  handleNicknameChange(
    socket: Socket,
    data: NicknameChangeDto,
    server: Server,
  ): void {
    const { roomId, nickname } = data;
    const rid = this.getRid(socket);

    if (!rid) {
      return;
    }

    // Trim and validate nickname
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname || trimmedNickname.length > 20) {
      socket.emit('nickname:change:rejected', {
        roomId,
        reason: 'INVALID_NICKNAME',
      });
      return;
    }

    // Handle asynchronously without blocking
    void (async (): Promise<void> => {
      try {
        // Update nickname in Redis
        await this.redisService.updateSocketNickname(
          socket.id,
          trimmedNickname,
        );

        // Confirm to the user
        socket.emit('nickname:changed', {
          roomId,
          nickname: trimmedNickname,
        });

        // Broadcast participants list to owner
        await this.broadcastParticipantsToOwner(roomId, server);
      } catch (error: unknown) {
        console.error('Error in handleNicknameChange:', error);
        socket.emit('nickname:change:rejected', {
          roomId,
          reason: 'INTERNAL_ERROR',
        });
      }
    })();
  }

  private selectRandom<T>(array: T[], count: number): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
  }

  private async broadcastParticipantsToOwner(
    roomId: string,
    server: Server,
  ): Promise<void> {
    // Get owner rid
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    if (!ownerRid) {
      return;
    }

    // Get all room members
    const allSocketIds = await this.redisService.getRoomMembers(roomId);
    let readyParticipants: string[] = [];
    try {
      const result = await this.redisService.getReadyParticipants(roomId);
      readyParticipants = result;
    } catch (error: unknown) {
      console.error('Error getting ready participants:', error);
    }
    const readySet = new Set<string>(readyParticipants);

    // Collect participant info (excluding owner)
    const participants: Array<{
      rid: string;
      nickname: string;
      ready: boolean;
    }> = [];

    let ownerSocketId: string | null = null;

    for (const socketId of allSocketIds) {
      const socketInfo = await this.redisService.getSocketInfo(socketId);
      if (!socketInfo) {
        continue;
      }

      // Check if this is the owner
      if (socketInfo.rid === ownerRid) {
        ownerSocketId = socketId;
        continue;
      }

      // Only include participants
      if (socketInfo.role === 'participant') {
        participants.push({
          rid: socketInfo.rid,
          nickname: socketInfo.nickname,
          ready: readySet.has(socketId),
        });
      }
    }

    // Send to owner only
    if (ownerSocketId) {
      const ownerSocket = server.sockets.sockets.get(ownerSocketId);
      if (ownerSocket) {
        const readyCount = participants.filter((p) => p.ready).length;
        const allReady =
          participants.length > 0 && readyCount === participants.length;

        ownerSocket.emit('room:participants', {
          roomId,
          participants,
          readyCount,
          totalCount: participants.length,
          allReady,
        });
      }
    }
  }
}
