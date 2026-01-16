import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  RedisService,
  RoomConfig,
  SocketInfo,
  RoomState,
} from './redis.service';
import Redis from 'ioredis';

/* eslint-disable @typescript-eslint/unbound-method */

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    status: 'ready',
    once: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    eval: jest.fn(),
    pipeline: jest.fn().mockReturnValue({
      del: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
  }));
});

const mockConfigService = {
  get: jest.fn(),
  getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
};

describe('RedisService', () => {
  let service: RedisService;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    await service.onModuleInit();

    // Get the mock client
    mockRedis = service.getClient() as jest.Mocked<Redis>;
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should initialize Redis clients', () => {
      expect(service.getClient()).toBeDefined();
      expect(service.getSubscriber()).toBeDefined();
      expect(service.getPublisher()).toBeDefined();
    });
  });

  describe('getRoomConfig', () => {
    it('should return null for non-existent room', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getRoomConfig('non-existent-room');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith(
        'room:config:non-existent-room',
      );
    });

    it('should return config for existing room', async () => {
      const config: RoomConfig = {
        winnersCount: 3,
        winSentiment: 'NEGATIVE',
        updatedAt: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(config));

      const result = await service.getRoomConfig('existing-room');

      expect(result).toEqual(config);
      expect(mockRedis.get).toHaveBeenCalledWith('room:config:existing-room');
    });
  });

  describe('setRoomConfig', () => {
    it('should set config with correct TTL', async () => {
      const config: RoomConfig = {
        winnersCount: 2,
        winSentiment: 'POSITIVE',
        updatedAt: Date.now(),
      };
      mockRedis.set.mockResolvedValue('OK');

      await service.setRoomConfig('test-room', config);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'room:config:test-room',
        JSON.stringify(config),
        'EX',
        7200, // 2 hours in seconds
      );
    });
  });

  describe('getRoomOwner / setRoomOwner', () => {
    it('should return null for room without owner', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getRoomOwner('no-owner-room');

      expect(result).toBeNull();
    });

    it('should return owner rid for room with owner', async () => {
      mockRedis.get.mockResolvedValue('owner-rid');

      const result = await service.getRoomOwner('owned-room');

      expect(result).toBe('owner-rid');
    });

    it('should set owner with NX option (only if not exists)', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.setRoomOwner('new-room', 'new-owner-rid');

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'room:owner:new-room',
        'new-owner-rid',
        'EX',
        7200,
        'NX',
      );
    });

    it('should return false when owner already exists', async () => {
      mockRedis.set.mockResolvedValue(null);

      const result = await service.setRoomOwner('existing-room', 'another-rid');

      expect(result).toBe(false);
    });
  });

  describe('clearRoomOwner', () => {
    it('should delete room owner key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clearRoomOwner('test-room');

      expect(mockRedis.del).toHaveBeenCalledWith('room:owner:test-room');
    });
  });

  describe('Room Members', () => {
    describe('addRoomMember', () => {
      it('should add socket id to room members set', async () => {
        mockRedis.sadd.mockResolvedValue(1);

        await service.addRoomMember('test-room', 'socket-123');

        expect(mockRedis.sadd).toHaveBeenCalledWith(
          'room:members:test-room',
          'socket-123',
        );
      });
    });

    describe('removeRoomMember', () => {
      it('should remove socket id from room members set', async () => {
        mockRedis.srem.mockResolvedValue(1);

        await service.removeRoomMember('test-room', 'socket-123');

        expect(mockRedis.srem).toHaveBeenCalledWith(
          'room:members:test-room',
          'socket-123',
        );
      });
    });

    describe('getRoomMembers', () => {
      it('should return all socket ids in room', async () => {
        const members = ['socket-1', 'socket-2', 'socket-3'];
        mockRedis.smembers.mockResolvedValue(members);

        const result = await service.getRoomMembers('test-room');

        expect(result).toEqual(members);
        expect(mockRedis.smembers).toHaveBeenCalledWith(
          'room:members:test-room',
        );
      });

      it('should return empty array for empty room', async () => {
        mockRedis.smembers.mockResolvedValue([]);

        const result = await service.getRoomMembers('empty-room');

        expect(result).toEqual([]);
      });
    });
  });

  describe('Socket Info', () => {
    const socketInfo: SocketInfo = {
      roomId: 'test-room',
      rid: 'test-rid',
      nickname: 'Test User',
      role: 'participant',
      lastSeen: Date.now(),
    };

    describe('setSocketInfo', () => {
      it('should store socket info with TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.setSocketInfo('socket-123', socketInfo);

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:socket:socket-123',
          JSON.stringify(socketInfo),
          'EX',
          7200,
        );
      });
    });

    describe('getSocketInfo', () => {
      it('should return null for unknown socket', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await service.getSocketInfo('unknown-socket');

        expect(result).toBeNull();
      });

      it('should return socket info for known socket', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify(socketInfo));

        const result = await service.getSocketInfo('socket-123');

        expect(result).toEqual(socketInfo);
      });
    });

    describe('removeSocketInfo', () => {
      it('should delete socket info', async () => {
        mockRedis.del.mockResolvedValue(1);

        await service.removeSocketInfo('socket-123');

        expect(mockRedis.del).toHaveBeenCalledWith('room:socket:socket-123');
      });
    });
  });

  describe('Distributed Lock for Spin', () => {
    describe('acquireSpinLock', () => {
      it('should acquire lock successfully', async () => {
        mockRedis.set.mockResolvedValue('OK');

        const result = await service.acquireSpinLock(
          'room-1',
          'spin-123',
          10000,
        );

        expect(result).toBe(true);
        expect(mockRedis.set).toHaveBeenCalledWith(
          'lock:spin:room-1',
          'spin-123',
          'PX',
          10000,
          'NX',
        );
      });

      it('should fail to acquire already held lock', async () => {
        mockRedis.set.mockResolvedValue(null);

        const result = await service.acquireSpinLock(
          'room-1',
          'spin-456',
          10000,
        );

        expect(result).toBe(false);
      });
    });

    describe('releaseSpinLock', () => {
      it('should release lock with correct value (Lua script)', async () => {
        mockRedis.eval.mockResolvedValue(1);

        await service.releaseSpinLock('room-1', 'spin-123');

        expect(mockRedis.eval).toHaveBeenCalledWith(
          expect.stringContaining('redis.call'),
          1,
          'lock:spin:room-1',
          'spin-123',
        );
      });
    });
  });

  describe('Idempotency', () => {
    describe('checkIdempotency', () => {
      it('should return null for new request', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await service.checkIdempotency('room-1', 'req-123');

        expect(result).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledWith('idem:spin:room-1:req-123');
      });

      it('should return spinId for duplicate request', async () => {
        mockRedis.get.mockResolvedValue('spin-existing');

        const result = await service.checkIdempotency('room-1', 'req-123');

        expect(result).toBe('spin-existing');
      });
    });

    describe('setIdempotency', () => {
      it('should store request with 30s TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.setIdempotency('room-1', 'req-123', 'spin-new');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'idem:spin:room-1:req-123',
          'spin-new',
          'EX',
          30,
        );
      });
    });
  });

  describe('Room State', () => {
    const roomState: RoomState = {
      lastSpin: {
        spinId: 'spin-123',
        decidedAt: Date.now(),
      },
    };

    describe('getRoomState', () => {
      it('should return null for room without state', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await service.getRoomState('new-room');

        expect(result).toBeNull();
      });

      it('should return state for room with state', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify(roomState));

        const result = await service.getRoomState('played-room');

        expect(result).toEqual(roomState);
      });
    });

    describe('setRoomState', () => {
      it('should store room state with TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.setRoomState('test-room', roomState);

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:state:test-room',
          JSON.stringify(roomState),
          'EX',
          7200,
        );
      });
    });
  });

  describe('Owner Token Verification', () => {
    describe('setRoomOwnerToken', () => {
      it('should store owner token with TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.setRoomOwnerToken('room-1', 'secret-token');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:owner:token:room-1',
          'secret-token',
          'EX',
          7200,
        );
      });
    });

    describe('getRoomOwnerToken', () => {
      it('should return null for room without token', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await service.getRoomOwnerToken('no-token-room');

        expect(result).toBeNull();
      });

      it('should return token for room with token', async () => {
        mockRedis.get.mockResolvedValue('stored-token');

        const result = await service.getRoomOwnerToken('room-1');

        expect(result).toBe('stored-token');
      });
    });

    describe('verifyRoomOwnerToken', () => {
      it('should return true for matching token', async () => {
        mockRedis.get.mockResolvedValue('correct-token');

        const result = await service.verifyRoomOwnerToken(
          'room-1',
          'correct-token',
        );

        expect(result).toBe(true);
      });

      it('should return false for non-matching token', async () => {
        mockRedis.get.mockResolvedValue('correct-token');

        const result = await service.verifyRoomOwnerToken(
          'room-1',
          'wrong-token',
        );

        expect(result).toBe(false);
      });

      it('should return false when no token stored', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await service.verifyRoomOwnerToken(
          'room-1',
          'any-token',
        );

        expect(result).toBe(false);
      });
    });
  });

  describe('Participant Counter', () => {
    describe('getNextParticipantNumber', () => {
      it('should return incremented number', async () => {
        mockRedis.incr.mockResolvedValue(5);
        mockRedis.expire.mockResolvedValue(1);

        const result = await service.getNextParticipantNumber('room-1');

        expect(result).toBe(5);
        expect(mockRedis.incr).toHaveBeenCalledWith(
          'room:participant:counter:room-1',
        );
        expect(mockRedis.expire).toHaveBeenCalledWith(
          'room:participant:counter:room-1',
          7200,
        );
      });
    });
  });

  describe('Ready Status', () => {
    describe('setParticipantReady', () => {
      it('should add socket to ready set', async () => {
        mockRedis.sadd.mockResolvedValue(1);

        await service.setParticipantReady('room-1', 'socket-123');

        expect(mockRedis.sadd).toHaveBeenCalledWith(
          'room:ready:room-1',
          'socket-123',
        );
      });
    });

    describe('removeParticipantReady', () => {
      it('should remove socket from ready set', async () => {
        mockRedis.srem.mockResolvedValue(1);

        await service.removeParticipantReady('room-1', 'socket-123');

        expect(mockRedis.srem).toHaveBeenCalledWith(
          'room:ready:room-1',
          'socket-123',
        );
      });
    });

    describe('getReadyParticipants', () => {
      it('should return all ready socket ids', async () => {
        const readyIds = ['socket-1', 'socket-2'];
        mockRedis.smembers.mockResolvedValue(readyIds);

        const result = await service.getReadyParticipants('room-1');

        expect(result).toEqual(readyIds);
        expect(mockRedis.smembers).toHaveBeenCalledWith('room:ready:room-1');
      });
    });
  });

  describe('Socket Nickname', () => {
    describe('updateSocketNickname', () => {
      it('should update nickname in socket info', async () => {
        const existingInfo: SocketInfo = {
          roomId: 'room-1',
          rid: 'rid-1',
          nickname: 'Old Name',
          role: 'participant',
          lastSeen: Date.now(),
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(existingInfo));
        mockRedis.set.mockResolvedValue('OK');

        await service.updateSocketNickname('socket-123', 'New Name');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:socket:socket-123',
          expect.stringContaining('"nickname":"New Name"'),
          'EX',
          7200,
        );
      });

      it('should do nothing if socket info not found', async () => {
        mockRedis.get.mockResolvedValue(null);

        await service.updateSocketNickname('unknown-socket', 'New Name');

        expect(mockRedis.set).not.toHaveBeenCalled();
      });
    });
  });

  describe('Initial Owner Nickname', () => {
    describe('setInitialOwnerNickname', () => {
      it('should store initial nickname with TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.setInitialOwnerNickname('room-1', '방장닉네임');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:owner:initial-nickname:room-1',
          '방장닉네임',
          'EX',
          7200,
        );
      });
    });

    describe('getInitialOwnerNickname', () => {
      it('should return stored nickname', async () => {
        mockRedis.get.mockResolvedValue('방장닉네임');

        const result = await service.getInitialOwnerNickname('room-1');

        expect(result).toBe('방장닉네임');
      });
    });

    describe('removeInitialOwnerNickname', () => {
      it('should delete initial nickname', async () => {
        mockRedis.del.mockResolvedValue(1);

        await service.removeInitialOwnerNickname('room-1');

        expect(mockRedis.del).toHaveBeenCalledWith(
          'room:owner:initial-nickname:room-1',
        );
      });
    });
  });

  describe('Room Title', () => {
    describe('setRoomTitle', () => {
      it('should store room title with TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.setRoomTitle('room-1', '테스트 방');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:title:room-1',
          '테스트 방',
          'EX',
          7200,
        );
      });
    });

    describe('getRoomTitle', () => {
      it('should return stored title', async () => {
        mockRedis.get.mockResolvedValue('테스트 방');

        const result = await service.getRoomTitle('room-1');

        expect(result).toBe('테스트 방');
      });
    });
  });

  describe('Room Last Activity', () => {
    describe('setRoomLastActivity', () => {
      it('should store timestamp with TTL', async () => {
        mockRedis.set.mockResolvedValue('OK');
        const beforeCall = Date.now();

        await service.setRoomLastActivity('room-1');

        expect(mockRedis.set).toHaveBeenCalledWith(
          'room:lastActivity:room-1',
          expect.any(String),
          'EX',
          7200,
        );

        const calledTimestamp = parseInt(
          (mockRedis.set.mock.calls[0] as string[])[1],
          10,
        );
        expect(calledTimestamp).toBeGreaterThanOrEqual(beforeCall);
      });
    });

    describe('getRoomLastActivity', () => {
      it('should return timestamp as number', async () => {
        const timestamp = Date.now();
        mockRedis.get.mockResolvedValue(timestamp.toString());

        const result = await service.getRoomLastActivity('room-1');

        expect(result).toBe(timestamp);
      });

      it('should return null if no activity', async () => {
        mockRedis.get.mockResolvedValue(null);

        const result = await service.getRoomLastActivity('room-1');

        expect(result).toBeNull();
      });
    });
  });

  describe('deleteRoom', () => {
    it('should delete all room-related keys via pipeline', async () => {
      const mockPipeline = {
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockRedis.pipeline.mockReturnValue(
        mockPipeline as unknown as ReturnType<typeof mockRedis.pipeline>,
      );

      await service.deleteRoom('room-to-delete');

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.del).toHaveBeenCalledTimes(11); // 11 different keys
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('extendRoomTTL', () => {
    it('should extend TTL for all room keys via pipeline', async () => {
      const mockPipeline = {
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockRedis.pipeline.mockReturnValue(
        mockPipeline as unknown as ReturnType<typeof mockRedis.pipeline>,
      );

      await service.extendRoomTTL('room-1');

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.expire).toHaveBeenCalledTimes(7); // 7 different keys
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        'room:config:room-1',
        1800,
      ); // 30 minutes
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('hasActiveOwnerConnection', () => {
    it('should return false if no owner', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.hasActiveOwnerConnection('room-1');

      expect(result).toBe(false);
    });

    it('should return false if owner has no active socket', async () => {
      mockRedis.get
        .mockResolvedValueOnce('owner-rid') // getRoomOwner
        .mockResolvedValueOnce(JSON.stringify({ rid: 'other-rid' })); // getSocketInfo
      mockRedis.smembers.mockResolvedValue(['socket-1']);

      const result = await service.hasActiveOwnerConnection('room-1');

      expect(result).toBe(false);
    });

    it('should return true if owner has active socket', async () => {
      const ownerRid = 'owner-rid';
      mockRedis.get
        .mockResolvedValueOnce(ownerRid) // getRoomOwner
        .mockResolvedValueOnce(
          JSON.stringify({ rid: ownerRid, roomId: 'room-1' }),
        ); // getSocketInfo
      mockRedis.smembers.mockResolvedValue(['socket-1']);

      const result = await service.hasActiveOwnerConnection('room-1');

      expect(result).toBe(true);
    });
  });

  describe('getActiveOwnerSocketId', () => {
    it('should return null if no owner', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getActiveOwnerSocketId('room-1');

      expect(result).toBeNull();
    });

    it('should return null if owner has no active socket', async () => {
      mockRedis.get
        .mockResolvedValueOnce('owner-rid') // getRoomOwner
        .mockResolvedValueOnce(JSON.stringify({ rid: 'other-rid' })); // getSocketInfo
      mockRedis.smembers.mockResolvedValue(['socket-1']);

      const result = await service.getActiveOwnerSocketId('room-1');

      expect(result).toBeNull();
    });

    it('should return socket id if owner has active socket', async () => {
      const ownerRid = 'owner-rid';
      mockRedis.get
        .mockResolvedValueOnce(ownerRid) // getRoomOwner
        .mockResolvedValueOnce(
          JSON.stringify({ rid: ownerRid, roomId: 'room-1' }),
        ); // getSocketInfo
      mockRedis.smembers.mockResolvedValue(['socket-1']);

      const result = await service.getActiveOwnerSocketId('room-1');

      expect(result).toBe('socket-1');
    });
  });
});
