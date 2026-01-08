import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { RoomJoinDto } from './dto/room-join.dto';
import type { RoomConfigSetDto } from './dto/room-config-set.dto';
import type { SpinRequestDto } from './dto/spin-request.dto';
import { SessionService } from '../session/session.service';
import { RedisService } from '../../common/redis/redis.service';
import { RouletteService } from './roulette.service';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
})
export class RouletteGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessionService: SessionService,
    private readonly redisService: RedisService,
    private readonly rouletteService: RouletteService,
  ) {}

  afterInit(server: Server): void {
    const pubClient = this.redisService.getPublisher();
    const subClient = this.redisService.getSubscriber();
    server.adapter(createAdapter(pubClient, subClient));
  }

  private isValidRid(rid: string | undefined): rid is string {
    return (
      typeof rid === 'string' &&
      rid.length > 0 &&
      this.sessionService.verifyRid(rid)
    );
  }

  handleConnection(socket: Socket): void {
    // Extract rid from cookie
    const cookies = socket.handshake.headers.cookie;
    if (!cookies || typeof cookies !== 'string') {
      socket.disconnect();
      return;
    }

    // Parse cookies (handle URL encoding)
    const cookieMap = new Map<string, string>();
    cookies.split(';').forEach((cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        cookieMap.set(key, decodeURIComponent(value));
      }
    });

    const rid = cookieMap.get('rid');
    if (!this.isValidRid(rid)) {
      socket.disconnect();
      return;
    }

    (socket as unknown as { data: { rid?: string } }).data.rid = rid;
  }

  handleDisconnect(socket: Socket): void {
    this.rouletteService.handleDisconnect(socket);
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() socket: Socket,
    data: RoomJoinDto,
  ): Promise<void> {
    await this.rouletteService.handleRoomJoin(socket, data);
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
}
