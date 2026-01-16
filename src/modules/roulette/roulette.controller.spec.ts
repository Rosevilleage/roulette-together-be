import { Test, TestingModule } from '@nestjs/testing';
import { RouletteController } from './roulette.controller';
import { RedisService } from '../../common/redis/redis.service';
import {
  createMockRedisService,
  createRoomConfig,
  createSocketInfo,
} from '../../../test/utils/test-utils';
import type { Response, Request } from 'express';
import { WinSentiment } from './dto/room-config-set.dto';

/* eslint-disable @typescript-eslint/unbound-method */

describe('RouletteController', () => {
  let controller: RouletteController;
  let mockRedisService: jest.Mocked<RedisService>;

  const createMockResponse = (): Partial<Response> => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  });

  const createMockRequest = (
    cookies: Record<string, string> = {},
  ): Partial<Request> => ({
    cookies,
  });

  beforeEach(async () => {
    mockRedisService = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouletteController],
      providers: [
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    controller = module.get<RouletteController>(RouletteController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /rooms (createRoom)', () => {
    it('should create room and return roomId', async () => {
      const mockRes = createMockResponse();

      const result = await controller.createRoom(
        { title: 'Test Room', nickname: 'Owner' },
        mockRes as Response,
      );

      expect(result.roomId).toMatch(/^room-[a-f0-9]{16}$/);
      expect(result.title).toBe('Test Room');
      expect(result.createdAt).toBeDefined();
    });

    it('should set HTTP-only cookie', async () => {
      const mockRes = createMockResponse();

      const result = await controller.createRoom(
        { title: 'Test Room' },
        mockRes as Response,
      );

      expect(mockRes.cookie).toHaveBeenCalledWith(
        `owner_token_${result.roomId}`,
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        }),
      );
    });

    it('should store owner token in Redis', async () => {
      const mockRes = createMockResponse();

      const result = await controller.createRoom(
        { title: 'Test Room' },
        mockRes as Response,
      );

      expect(mockRedisService.setRoomOwnerToken).toHaveBeenCalledWith(
        result.roomId,
        expect.any(String),
      );
    });

    it('should store room config with custom values', async () => {
      const mockRes = createMockResponse();

      await controller.createRoom(
        {
          title: 'Custom Room',
          winnersCount: 3,
          winSentiment: 'NEGATIVE' as WinSentiment,
        },
        mockRes as Response,
      );

      expect(mockRedisService.setRoomConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          winnersCount: 3,
          winSentiment: 'NEGATIVE',
        }),
      );
    });

    it('should use default values when not provided', async () => {
      const mockRes = createMockResponse();

      const result = await controller.createRoom({}, mockRes as Response);

      expect(result.title).toBe('룰렛 방');
      expect(mockRedisService.setRoomConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          winnersCount: 1,
          winSentiment: 'POSITIVE',
        }),
      );
      expect(mockRedisService.setInitialOwnerNickname).toHaveBeenCalledWith(
        expect.any(String),
        '생성자',
      );
    });

    it('should store room title', async () => {
      const mockRes = createMockResponse();

      await controller.createRoom(
        { title: 'My Roulette' },
        mockRes as Response,
      );

      expect(mockRedisService.setRoomTitle).toHaveBeenCalledWith(
        expect.any(String),
        'My Roulette',
      );
    });

    it('should store initial owner nickname', async () => {
      const mockRes = createMockResponse();

      await controller.createRoom(
        { nickname: '방장닉네임' },
        mockRes as Response,
      );

      expect(mockRedisService.setInitialOwnerNickname).toHaveBeenCalledWith(
        expect.any(String),
        '방장닉네임',
      );
    });

    it('should initialize room activity timestamp', async () => {
      const mockRes = createMockResponse();

      await controller.createRoom({}, mockRes as Response);

      expect(mockRedisService.setRoomLastActivity).toHaveBeenCalled();
    });
  });

  describe('GET /rooms (getRooms)', () => {
    it('should return empty array when no cookies', async () => {
      const mockReq = createMockRequest({});
      const mockRes = createMockResponse();

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms).toEqual([]);
      expect(result.queriedAt).toBeDefined();
    });

    it('should return rooms for valid cookies', async () => {
      const roomId = 'room-test123';
      const token = 'valid-token';
      const cookieValue = JSON.stringify({ roomId, token });

      const mockReq = createMockRequest({
        [`owner_token_${roomId}`]: cookieValue,
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockResolvedValue(token);
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());
      mockRedisService.getRoomLastActivity.mockResolvedValue(Date.now());
      mockRedisService.getRoomMembers.mockResolvedValue([]);
      mockRedisService.getRoomOwner.mockResolvedValue(null);
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms).toHaveLength(1);
      expect(result.rooms[0].roomId).toBe(roomId);
      expect(result.rooms[0].title).toBe('Test Room');
    });

    it('should handle expired rooms (clear cookie)', async () => {
      const roomId = 'room-expired';
      const token = 'valid-token';
      const cookieValue = JSON.stringify({ roomId, token });

      const mockReq = createMockRequest({
        [`owner_token_${roomId}`]: cookieValue,
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockResolvedValue(token);
      mockRedisService.getRoomConfig.mockResolvedValue(null); // Room expired

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms).toHaveLength(0);
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        `owner_token_${roomId}`,
        { path: '/' },
      );
    });

    it('should handle invalid token (clear cookie)', async () => {
      const roomId = 'room-invalid';
      const cookieValue = JSON.stringify({ roomId, token: 'wrong-token' });

      const mockReq = createMockRequest({
        [`owner_token_${roomId}`]: cookieValue,
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockResolvedValue('correct-token');

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms).toHaveLength(0);
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        `owner_token_${roomId}`,
        { path: '/' },
      );
    });

    it('should include participant count', async () => {
      const roomId = 'room-test';
      const token = 'valid-token';
      const cookieValue = JSON.stringify({ roomId, token });

      const mockReq = createMockRequest({
        [`owner_token_${roomId}`]: cookieValue,
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockResolvedValue(token);
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());
      mockRedisService.getRoomLastActivity.mockResolvedValue(Date.now());
      mockRedisService.getRoomMembers.mockResolvedValue([
        'socket-1',
        'socket-2',
        'socket-3',
      ]);
      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');
      mockRedisService.getSocketInfo.mockImplementation((socketId: string) => {
        if (socketId === 'socket-1') {
          return Promise.resolve(
            createSocketInfo({ rid: 'owner-rid', role: 'owner' }),
          );
        }
        return Promise.resolve(createSocketInfo({ role: 'participant' }));
      });

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms[0].participantCount).toBe(2); // 2 participants
    });

    it('should include owner nickname', async () => {
      const roomId = 'room-test';
      const token = 'valid-token';
      const cookieValue = JSON.stringify({ roomId, token });

      const mockReq = createMockRequest({
        [`owner_token_${roomId}`]: cookieValue,
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockResolvedValue(token);
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());
      mockRedisService.getRoomLastActivity.mockResolvedValue(Date.now());
      mockRedisService.getRoomMembers.mockResolvedValue(['socket-owner']);
      mockRedisService.getRoomOwner.mockResolvedValue('owner-rid');
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');
      mockRedisService.getSocketInfo.mockResolvedValue(
        createSocketInfo({
          rid: 'owner-rid',
          role: 'owner',
          nickname: '방장님',
        }),
      );

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms[0].ownerNickname).toBe('방장님');
    });

    it('should sort rooms by lastActivity descending', async () => {
      const now = Date.now();
      const cookieValue1 = JSON.stringify({
        roomId: 'room-1',
        token: 'token-1',
      });
      const cookieValue2 = JSON.stringify({
        roomId: 'room-2',
        token: 'token-2',
      });

      const mockReq = createMockRequest({
        'owner_token_room-1': cookieValue1,
        'owner_token_room-2': cookieValue2,
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockImplementation((roomId: string) =>
        Promise.resolve(roomId === 'room-1' ? 'token-1' : 'token-2'),
      );
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());
      mockRedisService.getRoomLastActivity.mockImplementation(
        (roomId: string) =>
          Promise.resolve(roomId === 'room-1' ? now - 10000 : now),
      );
      mockRedisService.getRoomMembers.mockResolvedValue([]);
      mockRedisService.getRoomOwner.mockResolvedValue(null);
      mockRedisService.getRoomTitle.mockResolvedValue('Test Room');

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms[0].roomId).toBe('room-2'); // More recent first
      expect(result.rooms[1].roomId).toBe('room-1');
    });

    it('should handle old cookie format (plain token)', async () => {
      const roomId = 'room-old';
      const token = 'plain-token-value';

      const mockReq = createMockRequest({
        [`owner_token_${roomId}`]: token, // Plain token, not JSON
      });
      const mockRes = createMockResponse();

      mockRedisService.getRoomOwnerToken.mockResolvedValue(token);
      mockRedisService.getRoomConfig.mockResolvedValue(createRoomConfig());
      mockRedisService.getRoomLastActivity.mockResolvedValue(Date.now());
      mockRedisService.getRoomMembers.mockResolvedValue([]);
      mockRedisService.getRoomOwner.mockResolvedValue(null);
      mockRedisService.getRoomTitle.mockResolvedValue('Old Room');

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms).toHaveLength(1);
      expect(result.rooms[0].roomId).toBe(roomId);
    });

    it('should skip non-owner_token cookies', async () => {
      const mockReq = createMockRequest({
        session_id: 'some-session',
        other_cookie: 'value',
      });
      const mockRes = createMockResponse();

      const result = await controller.getRooms(
        mockReq as Request,
        mockRes as Response,
      );

      expect(result.rooms).toHaveLength(0);
      expect(mockRedisService.getRoomOwnerToken).not.toHaveBeenCalled();
    });
  });
});
