import { Test, TestingModule } from '@nestjs/testing';
import { RouletteService } from './roulette.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  createMockRedisService,
  createMockSocket,
  createRoomConfig,
  createSocketInfo,
} from '../../../test/utils/test-utils';

/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

/**
 * Creates a mock Socket.IO server with chainable methods
 */
const createChainableMockServer = () => {
  const mockSocketsMap = new Map();
  const emitMock = jest.fn();

  const server = {
    to: jest.fn().mockReturnValue({ emit: emitMock }),
    emit: emitMock,
    sockets: {
      sockets: mockSocketsMap,
    },
  };

  return { server, emitMock, mockSocketsMap };
};

describe('RouletteService', () => {
  let service: RouletteService;
  let mockRedisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    mockRedisService = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouletteService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<RouletteService>(RouletteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('selectRandom (via handleSpinRequest)', () => {
    it('should select correct number of winners', async () => {
      const { server, emitMock, mockSocketsMap } = createChainableMockServer();

      const ownerSocket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid', role: 'owner', nickname: 'Owner' },
      });
      const participantIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const allSocketIds = ['owner-socket', ...participantIds];

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue(null);
      mockRedisService.acquireSpinLock.mockResolvedValue(true);
      mockRedisService.getRoomMembers.mockResolvedValue(allSocketIds);
      mockRedisService.getRoomConfig.mockResolvedValue(
        createRoomConfig({ winnersCount: 2 }),
      );
      mockRedisService.getReadyParticipants.mockResolvedValue(participantIds);

      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'owner-socket') {
          return Promise.resolve(
            createSocketInfo({
              rid: 'owner-rid',
              role: 'owner',
              nickname: 'Owner',
              roomId: 'room-1',
            }),
          );
        }
        return Promise.resolve(
          createSocketInfo({
            rid: socketId,
            role: 'participant',
            nickname: `User ${socketId}`,
            roomId: 'room-1',
          }),
        );
      });

      allSocketIds.forEach((id) => {
        const mockSocket = createMockSocket({ id });
        mockSocketsMap.set(id, mockSocket);
      });

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(server.to).toHaveBeenCalledWith('room-1');
      expect(emitMock).toHaveBeenCalledWith(
        'spin:resolved',
        expect.objectContaining({
          winnersCount: 2,
        }),
      );

      expect(emitMock).toHaveBeenCalledWith(
        'spin:result',
        expect.objectContaining({
          outcomes: expect.any(Array),
        }),
      );

      const spinResultCall = emitMock.mock.calls.find(
        (call: unknown[]) => call[0] === 'spin:result',
      );
      const outcomes = spinResultCall?.[1]?.outcomes;
      const winnerCount = outcomes?.filter(
        (o: { outcome: string }) => o.outcome === 'WIN',
      ).length;
      expect(winnerCount).toBe(2);
    });

    it('should not return duplicates in winners', async () => {
      const { server, emitMock, mockSocketsMap } = createChainableMockServer();

      const ownerSocket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid', role: 'owner', nickname: 'Owner' },
      });
      const participantIds = ['p1', 'p2', 'p3'];
      const allSocketIds = ['owner-socket', ...participantIds];

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue(null);
      mockRedisService.acquireSpinLock.mockResolvedValue(true);
      mockRedisService.getRoomMembers.mockResolvedValue(allSocketIds);
      mockRedisService.getRoomConfig.mockResolvedValue(
        createRoomConfig({ winnersCount: 3 }),
      );
      mockRedisService.getReadyParticipants.mockResolvedValue(participantIds);

      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'owner-socket') {
          return Promise.resolve(
            createSocketInfo({
              rid: 'owner-rid',
              role: 'owner',
              nickname: 'Owner',
              roomId: 'room-1',
            }),
          );
        }
        return Promise.resolve(
          createSocketInfo({
            rid: socketId,
            role: 'participant',
            nickname: `User ${socketId}`,
            roomId: 'room-1',
          }),
        );
      });

      allSocketIds.forEach((id) => {
        mockSocketsMap.set(id, createMockSocket({ id }));
      });

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      const spinResultCall = emitMock.mock.calls.find(
        (call: unknown[]) => call[0] === 'spin:result',
      );
      const outcomes = spinResultCall?.[1]?.outcomes;
      const winners = outcomes?.filter(
        (o: { outcome: string }) => o.outcome === 'WIN',
      );

      const winnerNicknames = winners?.map(
        (w: { nickname: string }) => w.nickname,
      );
      const uniqueNicknames = new Set(winnerNicknames);
      expect(uniqueNicknames.size).toBe(winnerNicknames?.length);
    });

    it('should handle edge case: winners > participants (cap to available)', async () => {
      const { server, emitMock, mockSocketsMap } = createChainableMockServer();

      const ownerSocket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid', role: 'owner', nickname: 'Owner' },
      });
      const participantIds = ['p1', 'p2'];
      const allSocketIds = ['owner-socket', ...participantIds];

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue(null);
      mockRedisService.acquireSpinLock.mockResolvedValue(true);
      mockRedisService.getRoomMembers.mockResolvedValue(allSocketIds);
      mockRedisService.getRoomConfig.mockResolvedValue(
        createRoomConfig({ winnersCount: 10 }),
      );
      mockRedisService.getReadyParticipants.mockResolvedValue(participantIds);

      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'owner-socket') {
          return Promise.resolve(
            createSocketInfo({
              rid: 'owner-rid',
              role: 'owner',
              nickname: 'Owner',
              roomId: 'room-1',
            }),
          );
        }
        return Promise.resolve(
          createSocketInfo({
            rid: socketId,
            role: 'participant',
            nickname: `User ${socketId}`,
            roomId: 'room-1',
          }),
        );
      });

      allSocketIds.forEach((id) => {
        mockSocketsMap.set(id, createMockSocket({ id }));
      });

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(emitMock).toHaveBeenCalledWith(
        'spin:resolved',
        expect.objectContaining({
          winnersCount: 3,
        }),
      );
    });
  });

  describe('handleRoomJoin', () => {
    it('should set owner correctly for first join with valid token', async () => {
      const { server, mockSocketsMap } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'owner-rid' },
        handshake: {
          headers: {
            cookie: `owner_token_room-1=${encodeURIComponent(JSON.stringify({ token: 'valid-token' }))}`,
          },
        },
      });

      mockRedisService.getRoomOwnerToken.mockResolvedValue('valid-token');
      mockRedisService.hasActiveOwnerConnection.mockResolvedValue(false);
      // First call returns null (checking if owner exists), second call returns the new owner
      mockRedisService.getRoomOwner
        .mockResolvedValueOnce(null) // First check during join
        .mockResolvedValueOnce('owner-rid'); // After setRoomOwner, when checking isOwner
      mockRedisService.setRoomOwner.mockResolvedValue(true);
      mockRedisService.getRoomConfig.mockResolvedValue(null);
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');
      mockRedisService.getRoomMembers.mockResolvedValue(['socket-1']);
      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ rid: 'owner-rid', role: 'owner', roomId: 'room-1' }),
      );

      mockSocketsMap.set('socket-1', socket);

      await service.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', role: 'owner' },
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.setRoomOwner).toHaveBeenCalledWith(
        'room-1',
        'owner-rid',
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'room:joined',
        expect.objectContaining({
          you: expect.objectContaining({
            isOwner: true,
          }),
        }),
      );
    });

    it('should reject invalid owner token', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'owner-rid' },
        handshake: {
          headers: {
            cookie: `owner_token_room-1=${encodeURIComponent(JSON.stringify({ token: 'wrong-token' }))}`,
          },
        },
      });

      mockRedisService.getRoomOwnerToken.mockResolvedValue('correct-token');

      await service.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', role: 'owner' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('room:join:rejected', {
        reason: 'INVALID_OWNER_TOKEN',
      });
      expect(mockRedisService.setRoomOwner).not.toHaveBeenCalled();
    });

    it('should auto-generate nickname for participant', async () => {
      const { server, mockSocketsMap } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-2',
        data: { rid: 'participant-rid' },
      });

      mockRedisService.getNextParticipantNumber.mockResolvedValue(3);
      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');
      mockRedisService.getRoomMembers.mockResolvedValue([
        'owner-socket',
        'socket-2',
      ]);
      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'owner-socket') {
          return Promise.resolve(
            createSocketInfo({
              rid: 'owner-rid',
              role: 'owner',
              roomId: 'room-1',
            }),
          );
        }
        return Promise.resolve(
          createSocketInfo({
            rid: 'participant-rid',
            role: 'participant',
            roomId: 'room-1',
          }),
        );
      });

      mockSocketsMap.set(
        'owner-socket',
        createMockSocket({ id: 'owner-socket' }),
      );
      mockSocketsMap.set('socket-2', socket);

      await service.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', role: 'participant' },
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.getNextParticipantNumber).toHaveBeenCalledWith(
        'room-1',
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'room:joined',
        expect.objectContaining({
          you: expect.objectContaining({
            nickname: '참가자 3',
          }),
        }),
      );
    });

    it('should use initial owner nickname if set', async () => {
      const { server, mockSocketsMap } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'owner-rid' },
        handshake: {
          headers: {
            cookie: `owner_token_room-1=${encodeURIComponent(JSON.stringify({ token: 'valid-token' }))}`,
          },
        },
      });

      mockRedisService.getRoomOwnerToken.mockResolvedValue('valid-token');
      mockRedisService.hasActiveOwnerConnection.mockResolvedValue(false);
      mockRedisService.getRoomOwner.mockResolvedValue(null);
      mockRedisService.setRoomOwner.mockResolvedValue(true);
      mockRedisService.getInitialOwnerNickname.mockResolvedValue('방장님');
      mockRedisService.getRoomConfig.mockResolvedValue(null);
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');
      mockRedisService.getRoomMembers.mockResolvedValue(['socket-1']);
      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ rid: 'owner-rid', role: 'owner', roomId: 'room-1' }),
      );

      mockSocketsMap.set('socket-1', socket);

      await service.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', role: 'owner' },
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.removeInitialOwnerNickname).toHaveBeenCalledWith(
        'room-1',
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'room:joined',
        expect.objectContaining({
          you: expect.objectContaining({
            nickname: '방장님',
          }),
        }),
      );
    });

    it('should reject when missing owner token cookie', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'owner-rid' },
        handshake: { headers: {} },
      });

      await service.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', role: 'owner' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('room:join:rejected', {
        reason: 'MISSING_OWNER_TOKEN',
      });
    });

    it('should reject when owner already exists with active connection', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-new',
        data: { rid: 'new-owner-rid' },
        handshake: {
          headers: {
            cookie: `owner_token_room-1=${encodeURIComponent(JSON.stringify({ token: 'valid-token' }))}`,
          },
        },
      });

      mockRedisService.getRoomOwnerToken.mockResolvedValue('valid-token');
      mockRedisService.hasActiveOwnerConnection.mockResolvedValue(true);

      await service.handleRoomJoin(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', role: 'owner' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('room:join:rejected', {
        reason: 'OWNER_ALREADY_EXISTS',
      });
    });
  });

  describe('handleSpinRequest', () => {
    let ownerSocket: ReturnType<typeof createMockSocket>;

    beforeEach(() => {
      ownerSocket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid', role: 'owner', nickname: 'Owner' },
      });
    });

    it('should reject when not all ready', async () => {
      const { server } = createChainableMockServer();

      const participantIds = ['p1', 'p2', 'p3'];
      const allSocketIds = ['owner-socket', ...participantIds];

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue(null);
      mockRedisService.acquireSpinLock.mockResolvedValue(true);
      mockRedisService.getRoomMembers.mockResolvedValue(allSocketIds);
      mockRedisService.getReadyParticipants.mockResolvedValue(['p1']);

      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'owner-socket') {
          return Promise.resolve(
            createSocketInfo({
              rid: 'owner-rid',
              role: 'owner',
              roomId: 'room-1',
            }),
          );
        }
        return Promise.resolve(
          createSocketInfo({
            rid: socketId,
            role: 'participant',
            roomId: 'room-1',
          }),
        );
      });

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(ownerSocket.emit).toHaveBeenCalledWith('spin:rejected', {
        roomId: 'room-1',
        requestId: 'req-1',
        reason: 'NOT_ALL_READY',
      });
    });

    it('should reject when already spinning (lock held)', async () => {
      const { server } = createChainableMockServer();

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue(null);
      mockRedisService.acquireSpinLock.mockResolvedValue(false);

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(ownerSocket.emit).toHaveBeenCalledWith('spin:rejected', {
        roomId: 'room-1',
        requestId: 'req-1',
        reason: 'ALREADY_SPINNING',
      });
    });

    it('should handle idempotent requests', async () => {
      const { server } = createChainableMockServer();

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue('existing-spin-id');

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-duplicate' },
        server as unknown as import('socket.io').Server,
      );

      expect(ownerSocket.emit).toHaveBeenCalledWith('spin:rejected', {
        roomId: 'room-1',
        requestId: 'req-duplicate',
        reason: 'IDEMPOTENT_REPLAY',
      });
      expect(mockRedisService.acquireSpinLock).not.toHaveBeenCalled();
    });

    it('should reject non-owner spin requests', async () => {
      const { server } = createChainableMockServer();

      mockRedisService.getRoomOwner.mockResolvedValue('different-owner-rid');

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(ownerSocket.emit).toHaveBeenCalledWith('spin:rejected', {
        roomId: 'room-1',
        requestId: 'req-1',
        reason: 'NOT_OWNER',
      });
    });

    it('should release lock after successful spin', async () => {
      const { server, mockSocketsMap } = createChainableMockServer();

      const participantIds = ['p1'];
      const allSocketIds = ['owner-socket', ...participantIds];

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.checkIdempotency.mockResolvedValue(null);
      mockRedisService.acquireSpinLock.mockResolvedValue(true);
      mockRedisService.getRoomMembers.mockResolvedValue(allSocketIds);
      mockRedisService.getReadyParticipants.mockResolvedValue(participantIds);
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());

      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'owner-socket') {
          return Promise.resolve(
            createSocketInfo({
              rid: 'owner-rid',
              role: 'owner',
              roomId: 'room-1',
            }),
          );
        }
        return Promise.resolve(
          createSocketInfo({
            rid: socketId,
            role: 'participant',
            roomId: 'room-1',
          }),
        );
      });

      participantIds.forEach((id) => {
        mockSocketsMap.set(id, createMockSocket({ id }));
      });
      mockSocketsMap.set('owner-socket', ownerSocket);

      await service.handleSpinRequest(
        ownerSocket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', requestId: 'req-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.releaseSpinLock).toHaveBeenCalledWith(
        'room-1',
        expect.any(String),
      );
    });
  });

  describe('handleReadyToggle', () => {
    it('should set participant ready state', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'participant-socket',
        data: { rid: 'participant-rid' },
      });

      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ role: 'participant', roomId: 'room-1' }),
      );
      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomMembers.mockResolvedValue([]);

      service.handleReadyToggle(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', ready: true },
        server as unknown as import('socket.io').Server,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRedisService.setParticipantReady).toHaveBeenCalledWith(
        'room-1',
        'participant-socket',
      );
      expect(socket.emit).toHaveBeenCalledWith('ready:toggled', {
        roomId: 'room-1',
        ready: true,
      });
    });

    it('should reject owner trying to toggle ready', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid' },
      });

      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ role: 'owner', roomId: 'room-1' }),
      );

      service.handleReadyToggle(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', ready: true },
        server as unknown as import('socket.io').Server,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(socket.emit).toHaveBeenCalledWith('ready:toggle:rejected', {
        roomId: 'room-1',
        reason: 'ONLY_PARTICIPANTS_CAN_READY',
      });
      expect(mockRedisService.setParticipantReady).not.toHaveBeenCalled();
    });
  });

  describe('handleNicknameChange', () => {
    it('should update nickname for valid input', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'test-rid' },
      });

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomMembers.mockResolvedValue([]);

      service.handleNicknameChange(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', nickname: '새로운닉네임' },
        server as unknown as import('socket.io').Server,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRedisService.updateSocketNickname).toHaveBeenCalledWith(
        'socket-1',
        '새로운닉네임',
      );
      expect(socket.emit).toHaveBeenCalledWith('nickname:changed', {
        roomId: 'room-1',
        nickname: '새로운닉네임',
      });
    });

    it('should reject empty nickname', () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'test-rid' },
      });

      service.handleNicknameChange(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', nickname: '   ' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('nickname:change:rejected', {
        roomId: 'room-1',
        reason: 'INVALID_NICKNAME',
      });
      expect(mockRedisService.updateSocketNickname).not.toHaveBeenCalled();
    });

    it('should reject nickname over 20 characters', () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: { rid: 'test-rid' },
      });

      service.handleNicknameChange(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', nickname: 'a'.repeat(21) },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('nickname:change:rejected', {
        roomId: 'room-1',
        reason: 'INVALID_NICKNAME',
      });
    });
  });

  describe('handleDisconnect', () => {
    it('should cleanup socket info on disconnect', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({ id: 'socket-1' });

      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ roomId: 'room-1', role: 'participant' }),
      );
      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomMembers.mockResolvedValue([]);

      await service.handleDisconnect(
        socket as unknown as import('socket.io').Socket,
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.removeParticipantReady).toHaveBeenCalledWith(
        'room-1',
        'socket-1',
      );
      expect(mockRedisService.removeRoomMember).toHaveBeenCalledWith(
        'room-1',
        'socket-1',
      );
      expect(mockRedisService.removeSocketInfo).toHaveBeenCalledWith(
        'socket-1',
      );
    });

    it('should extend room TTL when owner disconnects', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({ id: 'owner-socket' });

      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ roomId: 'room-1', role: 'owner', rid: 'owner-rid' }),
      );

      await service.handleDisconnect(
        socket as unknown as import('socket.io').Socket,
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.extendRoomTTL).toHaveBeenCalledWith('room-1');
    });
  });

  describe('handleRoomLeave', () => {
    it('should handle participant leave', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'participant-socket',
        data: { rid: 'participant-rid', role: 'participant' },
      });

      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ roomId: 'room-1', role: 'participant' }),
      );
      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomMembers.mockResolvedValue([]);

      await service.handleRoomLeave(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith(
        'room:left',
        expect.objectContaining({
          roomId: 'room-1',
        }),
      );
      expect(socket.leave).toHaveBeenCalledWith('room-1');
    });

    it('should handle owner leave with room preservation', async () => {
      const { server, emitMock } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid', role: 'owner' },
      });

      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({ roomId: 'room-1', role: 'owner', rid: 'owner-rid' }),
      );

      await service.handleRoomLeave(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(server.to).toHaveBeenCalledWith('room-1');
      expect(emitMock).toHaveBeenCalledWith(
        'room:owner:left',
        expect.objectContaining({
          roomId: 'room-1',
        }),
      );

      expect(mockRedisService.clearRoomOwner).toHaveBeenCalledWith('room-1');
      expect(mockRedisService.extendRoomTTL).toHaveBeenCalledWith('room-1');

      expect(socket.emit).toHaveBeenCalledWith(
        'room:left',
        expect.objectContaining({
          roomId: 'room-1',
        }),
      );
    });

    it('should reject leave for invalid request', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'socket-1',
        data: {},
      });

      await service.handleRoomLeave(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('room:leave:rejected', {
        roomId: 'room-1',
        reason: 'INVALID_REQUEST',
      });
    });
  });

  describe('handleRoomConfigSet', () => {
    it('should update config when owner requests', async () => {
      const { server, emitMock } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid' },
      });

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');

      await service.handleRoomConfigSet(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', winnersCount: 5, winSentiment: 'NEGATIVE' },
        server as unknown as import('socket.io').Server,
      );

      expect(mockRedisService.setRoomConfig).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          winnersCount: 5,
          winSentiment: 'NEGATIVE',
        }),
      );
      expect(server.to).toHaveBeenCalledWith('room-1');
      expect(emitMock).toHaveBeenCalledWith(
        'room:config',
        expect.objectContaining({
          winnersCount: 5,
          winSentiment: 'NEGATIVE',
        }),
      );
    });

    it('should reject non-owner config change', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'participant-socket',
        data: { rid: 'participant-rid' },
      });

      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');

      await service.handleRoomConfigSet(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', winnersCount: 5, winSentiment: 'NEGATIVE' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('room:config:rejected', {
        roomId: 'room-1',
        reason: 'NOT_OWNER',
      });
      expect(mockRedisService.setRoomConfig).not.toHaveBeenCalled();
    });

    it('should reject invalid winnersCount', async () => {
      const { server } = createChainableMockServer();

      const socket = createMockSocket({
        id: 'owner-socket',
        data: { rid: 'owner-rid' },
      });

      await service.handleRoomConfigSet(
        socket as unknown as import('socket.io').Socket,
        { roomId: 'room-1', winnersCount: 0, winSentiment: 'POSITIVE' },
        server as unknown as import('socket.io').Server,
      );

      expect(socket.emit).toHaveBeenCalledWith('room:config:rejected', {
        roomId: 'room-1',
        reason: 'INVALID',
      });
    });
  });
});
