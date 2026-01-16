import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { RoomJoinDto } from './dto/room-join.dto';
import { RoomConfigSetDto } from './dto/room-config-set.dto';
import { SpinRequestDto } from './dto/spin-request.dto';
import { ReadyToggleDto } from './dto/ready-toggle.dto';
import { NicknameChangeDto } from './dto/nickname-change.dto';
import { RoomLeaveDto } from './dto/room-leave.dto';
import { RedisService } from 'src/common/redis/redis.service';
import { parseCookies, parseOwnerToken, selectRandom } from './roulette.utils';

interface SocketWithData extends Socket {
  data: {
    rid?: string;
    nickname?: string;
    role?: 'owner' | 'participant';
  };
}

@Injectable()
export class RouletteService {
  private readonly logger = new Logger(RouletteService.name);

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
    this.logger.debug(
      `Room join attempt: roomId=${data?.roomId}, role=${data?.role}`,
    );

    // Validate request
    const validation = this.validateJoinRequest(socket, data);
    if (!validation.valid) {
      this.rejectJoin(socket, validation.reason!);
      return;
    }

    const { roomId, role } = data;
    let rid = validation.rid!;

    // Verify owner token if owner role
    if (role === 'owner') {
      const tokenResult = await this.verifyOwnerToken(socket, roomId);
      if (!tokenResult.valid) {
        this.rejectJoin(socket, tokenResult.reason!);
        return;
      }
      // Use the rid from cookie for owner (ensures consistent identity)
      if (tokenResult.ownerRid) {
        rid = tokenResult.ownerRid;
        // Update socket data with the owner's rid from cookie
        (socket as SocketWithData).data.rid = rid;
      }
    }

    // Handle role-specific join logic
    const joinResult =
      role === 'owner'
        ? await this.handleOwnerJoin(roomId, rid, server, data.nickname)
        : await this.handleParticipantJoin(roomId, data.nickname);

    if (!joinResult.success) {
      this.rejectJoin(socket, joinResult.reason!);
      return;
    }

    // Complete join process
    await this.completeJoin(
      socket,
      roomId,
      rid,
      role,
      joinResult.nickname!,
      server,
    );
  }

  private validateJoinRequest(
    socket: Socket,
    data: RoomJoinDto,
  ): { valid: boolean; rid?: string; reason?: string } {
    if (!data?.roomId || !data?.role) {
      this.logger.warn('Room join rejected: Missing roomId or role');
      return { valid: false, reason: 'INVALID_REQUEST' };
    }

    const rid = this.getRid(socket);
    if (!rid) {
      this.logger.warn(
        `Room join rejected: No rid found for room ${data.roomId}`,
      );
      return { valid: false, reason: 'INVALID_RID' };
    }

    return { valid: true, rid };
  }

  private async verifyOwnerToken(
    socket: Socket,
    roomId: string,
  ): Promise<{ valid: boolean; ownerRid?: string; reason?: string }> {
    const cookies = socket.handshake.headers.cookie;
    if (!cookies) {
      this.logger.warn(
        `Room join rejected: Missing owner token for room ${roomId}`,
      );
      return { valid: false, reason: 'MISSING_OWNER_TOKEN' };
    }

    const cookieObj = parseCookies(cookies);
    const ownerTokenFromCookie = parseOwnerToken(
      cookieObj[`owner_token_${roomId}`],
    );

    if (!ownerTokenFromCookie) {
      this.logger.warn(
        `Room join rejected: Missing owner token for room ${roomId}`,
      );
      return { valid: false, reason: 'MISSING_OWNER_TOKEN' };
    }

    const storedToken = await this.redisService.getRoomOwnerToken(roomId);
    if (!storedToken || storedToken !== ownerTokenFromCookie) {
      this.logger.warn(
        `Room join rejected: Invalid owner token for room ${roomId}`,
      );
      return { valid: false, reason: 'INVALID_OWNER_TOKEN' };
    }

    // Verify rid cookie matches stored owner rid
    const ridFromCookie = cookieObj[`rid_${roomId}`];
    const storedOwnerRid = await this.redisService.getRoomOwner(roomId);

    if (storedOwnerRid && ridFromCookie && ridFromCookie !== storedOwnerRid) {
      this.logger.warn(
        `Room join rejected: rid mismatch for room ${roomId} (cookie: ${ridFromCookie}, stored: ${storedOwnerRid})`,
      );
      return { valid: false, reason: 'INVALID_OWNER_RID' };
    }

    this.logger.debug(`Owner token verified for room ${roomId}`);
    // Return the rid from cookie if available, otherwise use stored rid
    return {
      valid: true,
      ownerRid: ridFromCookie || storedOwnerRid || undefined,
    };
  }

  private async handleOwnerJoin(
    roomId: string,
    rid: string,
    server: Server,
    providedNickname?: string,
  ): Promise<{ success: boolean; nickname?: string; reason?: string }> {
    // Check if owner has an active connection and disconnect existing one
    const existingOwnerSocketId =
      await this.redisService.getActiveOwnerSocketId(roomId);

    if (existingOwnerSocketId) {
      // Disconnect existing owner socket to allow new connection
      const existingSocket = server.sockets.sockets.get(existingOwnerSocketId);
      if (existingSocket) {
        this.logger.debug(
          `Disconnecting existing owner socket ${existingOwnerSocketId} for room ${roomId}`,
        );
        existingSocket.emit('room:owner:replaced', {
          roomId,
          reason: 'NEW_CONNECTION',
        });
        existingSocket.disconnect(true);
      }

      // Clean up old socket data
      await this.redisService.removeRoomMember(roomId, existingOwnerSocketId);
      await this.redisService.removeSocketInfo(existingOwnerSocketId);
    }

    // Determine nickname
    let nickname = providedNickname?.trim();
    if (!nickname) {
      try {
        const initialNickname =
          await this.redisService.getInitialOwnerNickname(roomId);
        if (initialNickname) {
          nickname = initialNickname;
          await this.redisService.removeInitialOwnerNickname(roomId);
        }
      } catch (error: unknown) {
        this.logger.error('Error getting initial owner nickname', error);
      }
      nickname = nickname || '생성자';
    }

    // Ensure owner rid is set in Redis
    // Note: Owner rid is now pre-set during room creation via controller
    // This is kept for backwards compatibility if rid_cookie is missing
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    if (!ownerRid) {
      await this.redisService.setRoomOwner(roomId, rid);
    }

    return { success: true, nickname };
  }

  private async handleParticipantJoin(
    roomId: string,
    providedNickname?: string,
  ): Promise<{ success: boolean; nickname?: string; reason?: string }> {
    let nickname = providedNickname?.trim();
    if (!nickname) {
      const participantNumber =
        await this.redisService.getNextParticipantNumber(roomId);
      nickname = `참가자 ${participantNumber}`;
    }

    return { success: true, nickname };
  }

  private async completeJoin(
    socket: Socket,
    roomId: string,
    rid: string,
    role: string,
    nickname: string,
    server: Server,
  ): Promise<void> {
    // Join socket room
    await socket.join(roomId);
    await this.redisService.addRoomMember(roomId, socket.id);

    // Store in socket.data
    (socket as SocketWithData).data.role = role as 'owner' | 'participant';
    (socket as SocketWithData).data.nickname = nickname;

    // Store socket info
    await this.redisService.setSocketInfo(socket.id, {
      roomId,
      rid,
      nickname,
      role: role as 'owner' | 'participant',
      lastSeen: Date.now(),
    });

    // Get owner info
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    const isOwner = ownerRid === rid;

    // Ensure config exists
    let config = await this.redisService.getRoomConfig(roomId);
    if (!config) {
      config = {
        winnersCount: 1,
        winSentiment: 'POSITIVE',
        updatedAt: Date.now(),
      };
      await this.redisService.setRoomConfig(roomId, config);
    }

    // Get room title
    const title = (await this.redisService.getRoomTitle(roomId)) || '룰렛 방';

    // Send events
    socket.emit('room:joined', {
      roomId,
      title,
      serverTime: Date.now(),
      you: { isOwner, nickname, rid },
    });

    socket.emit('room:config', { roomId, ...config });

    const state = await this.redisService.getRoomState(roomId);
    if (state) {
      socket.emit('room:state', {
        roomId,
        ownerRid: ownerRid || '',
        lastSpin: state.lastSpin,
      });
    }

    await this.broadcastParticipantsToOwner(roomId, server);
    await this.redisService.setRoomLastActivity(roomId);
  }

  private rejectJoin(socket: Socket, reason: string): void {
    socket.emit('room:join:rejected', { reason });
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

    // Update room activity timestamp
    await this.redisService.setRoomLastActivity(roomId);
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
      // 배치로 멤버 및 준비 상태 조회
      const [allSocketIds, readyParticipants, config] = await Promise.all([
        this.redisService.getRoomMembers(roomId),
        this.redisService
          .getReadyParticipants(roomId)
          .catch((error: unknown) => {
            this.logger.error('Error getting ready participants', error);
            return [] as string[];
          }),
        this.redisService.getRoomConfig(roomId),
      ]);

      // 배치로 소켓 정보 조회
      const socketInfoMap =
        await this.redisService.getSocketInfoBatch(allSocketIds);

      const activeSocketIds: string[] = [];
      const participantSocketIds: string[] = [];

      for (const socketId of allSocketIds) {
        const socketInfo = socketInfoMap.get(socketId);
        if (socketInfo && socketInfo.roomId === roomId) {
          activeSocketIds.push(socketId);
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
      const readySet = new Set<string>(readyParticipants);
      const allParticipantsReady = participantSocketIds.every((socketId) =>
        readySet.has(socketId),
      );

      if (participantSocketIds.length > 0 && !allParticipantsReady) {
        socket.emit('spin:rejected', {
          roomId,
          requestId,
          reason: 'NOT_ALL_READY',
        });
        return;
      }

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
      const winners = selectRandom(activeSocketIds, k);
      const winnerSet = new Set(winners);

      // Set idempotency
      await this.redisService.setIdempotency(roomId, requestId, spinId);

      const decidedAt = Date.now();
      const revealAt = decidedAt + 2000;
      const durationMs = 3000;

      // Broadcast spin:resolved to all
      server.to(roomId).emit('spin:resolved', {
        roomId,
        requestId,
        spinId,
        winnersCount: k,
        winSentiment: config.winSentiment,
        decidedAt,
        animation: { revealAt, durationMs },
      });

      // Send individual outcomes with nickname (socketInfoMap 재사용)
      const outcomes: Array<{
        socketId: string;
        nickname: string;
        outcome: 'WIN' | 'LOSE';
      }> = [];

      for (const socketId of activeSocketIds) {
        const isWinner = winnerSet.has(socketId);
        const socketInfo = socketInfoMap.get(socketId);
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

      // Update room activity timestamp
      await this.redisService.setRoomLastActivity(roomId);

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

        // Handle based on role
        if (role === 'owner') {
          // Owner disconnected - extend room TTL to 30 minutes
          // This allows owner to reconnect within 30 minutes
          this.logger.debug(
            `Owner disconnected from room ${roomId}, extending TTL to 30 minutes`,
          );
          await this.redisService.extendRoomTTL(roomId);
        } else {
          // Participant left - broadcast updated participants list to owner
          await this.broadcastParticipantsToOwner(roomId, server);
        }
      }
    } catch (error: unknown) {
      // Log error but don't throw - disconnect should always succeed
      this.logger.error('Error in handleDisconnect', error);
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

        // Confirm ready state change to the participant
        socket.emit('ready:toggled', {
          roomId,
          ready,
        });

        // Broadcast participants list to owner
        await this.broadcastParticipantsToOwner(roomId, server);

        // Update room activity timestamp
        await this.redisService.setRoomLastActivity(roomId);
      } catch (error: unknown) {
        this.logger.error('Error in handleReadyToggle', error);
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

        // Update room activity timestamp
        await this.redisService.setRoomLastActivity(roomId);
      } catch (error: unknown) {
        this.logger.error('Error in handleNicknameChange', error);
        socket.emit('nickname:change:rejected', {
          roomId,
          reason: 'INTERNAL_ERROR',
        });
      }
    })();
  }

  async handleRoomLeave(
    socket: Socket,
    data: RoomLeaveDto,
    server: Server,
  ): Promise<void> {
    const { roomId } = data;
    const rid = this.getRid(socket);
    const role = this.getRole(socket);

    if (!rid || !role) {
      socket.emit('room:leave:rejected', {
        roomId,
        reason: 'INVALID_REQUEST',
      });
      return;
    }

    // Get socket info to verify room membership
    const socketInfo = await this.redisService.getSocketInfo(socket.id);
    if (!socketInfo || socketInfo.roomId !== roomId) {
      socket.emit('room:leave:rejected', {
        roomId,
        reason: 'NOT_IN_ROOM',
      });
      return;
    }

    if (role === 'owner') {
      // Owner exit: Delete entire room and disconnect all participants
      await this.handleOwnerExit(roomId, socket, server);
    } else {
      // Participant exit: Just disconnect (existing logic handles cleanup)
      await this.handleParticipantExit(roomId, socket, server);
    }
  }

  private async handleOwnerExit(
    roomId: string,
    socket: Socket,
    server: Server,
  ): Promise<void> {
    try {
      // Notify all participants that owner has left (but room is still active)
      server.to(roomId).emit('room:owner:left', {
        roomId,
        leftAt: Date.now(),
      });

      // Remove owner from room members
      await this.redisService.removeRoomMember(roomId, socket.id);

      // Clean up owner socket info
      await this.redisService.removeSocketInfo(socket.id);

      // Clear owner rid (allow owner to rejoin later with same token)
      await this.redisService.clearRoomOwner(roomId);

      // Confirm to owner
      socket.emit('room:left', {
        roomId,
        leftAt: Date.now(),
      });

      // Leave socket.io room
      await socket.leave(roomId);

      // Extend room TTL to allow owner to rejoin
      await this.redisService.extendRoomTTL(roomId);
    } catch (error: unknown) {
      this.logger.error('Error in handleOwnerExit', error);
      socket.emit('room:leave:rejected', {
        roomId,
        reason: 'INTERNAL_ERROR',
      });
    }
  }

  private async handleParticipantExit(
    roomId: string,
    socket: Socket,
    server: Server,
  ): Promise<void> {
    try {
      // Confirm to participant first
      socket.emit('room:left', {
        roomId,
        leftAt: Date.now(),
      });

      // Trigger disconnect which handles all cleanup
      // This reuses existing handleDisconnect logic
      await this.handleDisconnect(socket, server);

      // Leave socket.io room
      await socket.leave(roomId);
    } catch (error: unknown) {
      this.logger.error('Error in handleParticipantExit', error);
      socket.emit('room:leave:rejected', {
        roomId,
        reason: 'INTERNAL_ERROR',
      });
    }
  }

  private async broadcastParticipantsToOwner(
    roomId: string,
    server: Server,
  ): Promise<void> {
    const ownerRid = await this.redisService.getRoomOwner(roomId);
    if (!ownerRid) {
      return;
    }

    // 배치로 조회
    const allSocketIds = await this.redisService.getRoomMembers(roomId);
    let readyParticipants: string[] = [];
    try {
      readyParticipants = await this.redisService.getReadyParticipants(roomId);
    } catch (error: unknown) {
      this.logger.error('Error getting ready participants', error);
    }

    const readySet = new Set<string>(readyParticipants);

    // 배치로 소켓 정보 조회
    const socketInfoMap =
      await this.redisService.getSocketInfoBatch(allSocketIds);

    const participants: Array<{
      rid: string;
      nickname: string;
      ready: boolean;
    }> = [];
    let ownerSocketId: string | null = null;

    for (const socketId of allSocketIds) {
      const socketInfo = socketInfoMap.get(socketId);
      if (!socketInfo) continue;

      if (socketInfo.rid === ownerRid) {
        ownerSocketId = socketId;
        continue;
      }

      if (socketInfo.role === 'participant') {
        participants.push({
          rid: socketInfo.rid,
          nickname: socketInfo.nickname,
          ready: readySet.has(socketId),
        });
      }
    }

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
