import { Logger, UseFilters, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { WsAllExceptionsFilter } from '../../common/filters/ws-exception.filter';
import { WsThrottlerGuard } from '../../common/guards/ws-throttler.guard';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import type { RoomJoinDto } from './dto/room-join.dto';
import type { RoomConfigSetDto } from './dto/room-config-set.dto';
import type { SpinRequestDto } from './dto/spin-request.dto';
import type { ReadyToggleDto } from './dto/ready-toggle.dto';
import type { NicknameChangeDto } from './dto/nickname-change.dto';
import type { RoomLeaveDto } from './dto/room-leave.dto';
import { RedisService } from '../../common/redis/redis.service';
import { RouletteService } from './roulette.service';

@WebSocketGateway()
@UseFilters(new WsAllExceptionsFilter())
@UseGuards(WsThrottlerGuard)
export class RouletteGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(RouletteGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly rouletteService: RouletteService,
  ) {}

  async afterInit(server: Server): Promise<void> {
    // Configure CORS dynamically from ConfigService
    const corsOrigin = this.configService.get<string[]>('CORS_ORIGIN');
    server.engine.opts.cors = {
      origin: corsOrigin,
      credentials: true,
    };

    // Wait for Redis clients to be initialized
    const maxRetries = 50;
    let pubClient: Redis | undefined;
    let subClient: Redis | undefined;

    for (let i = 0; i < maxRetries; i++) {
      pubClient = this.redisService.getPublisher();
      subClient = this.redisService.getSubscriber();

      if (pubClient && subClient) {
        break;
      }

      // Wait 100ms before retrying
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!pubClient || !subClient) {
      throw new Error(
        'Redis clients not initialized after waiting. Please check Redis connection.',
      );
    }

    // Wait for Redis clients to be ready
    await Promise.all([
      new Promise<void>((resolve) => {
        if (pubClient.status === 'ready') {
          resolve();
        } else {
          pubClient.once('ready', () => resolve());
        }
      }),
      new Promise<void>((resolve) => {
        if (subClient.status === 'ready') {
          resolve();
        } else {
          subClient.once('ready', () => resolve());
        }
      }),
    ]);

    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log(
      `WebSocket Gateway initialized with CORS origins: ${JSON.stringify(corsOrigin)}`,
    );
  }

  handleConnection(socket: Socket): void {
    // Generate a unique rid for this connection (방 내에서만 유저를 구분하는 용도)
    const rid = randomBytes(16).toString('hex');

    // Store rid in socket data
    (socket as unknown as { data: { rid?: string } }).data.rid = rid;
    this.logger.debug(`Client connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    this.logger.debug(`Client disconnected: ${socket.id}`);
    this.rouletteService.handleDisconnect(socket, this.server);
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: RoomJoinDto,
  ): Promise<void> {
    await this.rouletteService.handleRoomJoin(socket, data, this.server);
  }

  @SubscribeMessage('room:config:set')
  async handleRoomConfigSet(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: RoomConfigSetDto,
  ): Promise<void> {
    await this.rouletteService.handleRoomConfigSet(socket, data, this.server);
  }

  @SubscribeMessage('spin:request')
  async handleSpinRequest(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: SpinRequestDto,
  ): Promise<void> {
    await this.rouletteService.handleSpinRequest(socket, data, this.server);
  }

  @SubscribeMessage('participant:ready:toggle')
  handleReadyToggle(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: ReadyToggleDto,
  ): void {
    void this.rouletteService.handleReadyToggle(socket, data, this.server);
  }

  @SubscribeMessage('participant:nickname:change')
  handleNicknameChange(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: NicknameChangeDto,
  ): void {
    void this.rouletteService.handleNicknameChange(socket, data, this.server);
  }

  @SubscribeMessage('room:leave')
  async handleRoomLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: RoomLeaveDto,
  ): Promise<void> {
    await this.rouletteService.handleRoomLeave(socket, data, this.server);
  }
}
