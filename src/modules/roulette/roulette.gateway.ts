import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import type { RoomJoinDto } from './dto/room-join.dto';
import type { RoomConfigSetDto } from './dto/room-config-set.dto';
import type { SpinRequestDto } from './dto/spin-request.dto';
import type { ReadyToggleDto } from './dto/ready-toggle.dto';
import type { NicknameChangeDto } from './dto/nickname-change.dto';
import { RedisService } from '../../common/redis/redis.service';
import { RouletteService } from './roulette.service';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
})
export class RouletteGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly redisService: RedisService,
    private readonly rouletteService: RouletteService,
  ) {}

  async afterInit(server: Server): Promise<void> {
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
  }

  handleConnection(socket: Socket): void {
    // Generate a unique rid for this connection (방 내에서만 유저를 구분하는 용도)
    const rid = randomBytes(16).toString('hex');

    // Store rid in socket data
    (socket as unknown as { data: { rid?: string } }).data.rid = rid;
  }

  handleDisconnect(socket: Socket): void {
    this.rouletteService.handleDisconnect(socket, this.server);
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() socket: Socket,
    data: RoomJoinDto,
  ): Promise<void> {
    await this.rouletteService.handleRoomJoin(socket, data, this.server);
  }

  @SubscribeMessage('room:config:set')
  async handleRoomConfigSet(
    @ConnectedSocket() socket: Socket,
    data: RoomConfigSetDto,
  ): Promise<void> {
    await this.rouletteService.handleRoomConfigSet(socket, data, this.server);
  }

  @SubscribeMessage('spin:request')
  async handleSpinRequest(
    @ConnectedSocket() socket: Socket,
    data: SpinRequestDto,
  ): Promise<void> {
    await this.rouletteService.handleSpinRequest(socket, data, this.server);
  }

  @SubscribeMessage('participant:ready:toggle')
  handleReadyToggle(
    @ConnectedSocket() socket: Socket,
    data: ReadyToggleDto,
  ): void {
    void this.rouletteService.handleReadyToggle(socket, data, this.server);
  }

  @SubscribeMessage('participant:nickname:change')
  handleNicknameChange(
    @ConnectedSocket() socket: Socket,
    data: NicknameChangeDto,
  ): void {
    void this.rouletteService.handleNicknameChange(socket, data, this.server);
  }
}
