import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { ModuleMetadata } from '@nestjs/common';
import {
  RedisService,
  RoomConfig,
  SocketInfo,
  RoomState,
} from '../../src/common/redis/redis.service';

export const createTestingModule = async (
  metadata: ModuleMetadata,
): Promise<TestingModule> => {
  return Test.createTestingModule(metadata).compile();
};

export const createTestingModuleBuilder = (
  metadata: ModuleMetadata,
): TestingModuleBuilder => {
  return Test.createTestingModule(metadata);
};

/**
 * Creates a mock RedisService with Jest mock functions
 */
export const createMockRedisService = (): jest.Mocked<RedisService> => {
  return {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getClient: jest.fn(),
    getSubscriber: jest.fn(),
    getPublisher: jest.fn(),

    // Room config
    getRoomConfig: jest.fn(),
    setRoomConfig: jest.fn(),

    // Room owner
    getRoomOwner: jest.fn(),
    setRoomOwner: jest.fn(),
    clearRoomOwner: jest.fn(),

    // Room members
    addRoomMember: jest.fn(),
    removeRoomMember: jest.fn(),
    getRoomMembers: jest.fn(),

    // Socket info
    setSocketInfo: jest.fn(),
    getSocketInfo: jest.fn(),
    removeSocketInfo: jest.fn(),

    // Distributed lock
    acquireSpinLock: jest.fn(),
    releaseSpinLock: jest.fn(),

    // Idempotency
    checkIdempotency: jest.fn(),
    setIdempotency: jest.fn(),

    // Room state
    getRoomState: jest.fn(),
    setRoomState: jest.fn(),

    // Room tokens
    setRoomOwnerToken: jest.fn(),
    getRoomOwnerToken: jest.fn(),
    verifyRoomOwnerToken: jest.fn(),

    // Participant counter
    getNextParticipantNumber: jest.fn(),

    // Ready status
    setParticipantReady: jest.fn(),
    removeParticipantReady: jest.fn(),
    getReadyParticipants: jest.fn(),

    // Socket nickname
    updateSocketNickname: jest.fn(),

    // Initial owner nickname
    setInitialOwnerNickname: jest.fn(),
    getInitialOwnerNickname: jest.fn(),
    removeInitialOwnerNickname: jest.fn(),

    // Room title
    setRoomTitle: jest.fn(),
    getRoomTitle: jest.fn(),
    removeRoomTitle: jest.fn(),

    // Room last activity
    setRoomLastActivity: jest.fn(),
    getRoomLastActivity: jest.fn(),

    // Room deletion
    deleteRoom: jest.fn(),
    extendRoomTTL: jest.fn(),

    // Active owner connection
    hasActiveOwnerConnection: jest.fn(),
    getActiveOwnerSocketId: jest.fn(),

    // Batch operations
    getSocketInfoBatch: jest.fn().mockResolvedValue(new Map()),
    getRoomMembersWithInfo: jest.fn().mockResolvedValue([]),
    getRoomConfigBatch: jest.fn().mockResolvedValue(new Map()),
    getRoomOwnerTokenBatch: jest.fn().mockResolvedValue(new Map()),
    getRoomMetadataBatch: jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<RedisService>;
};

/**
 * Creates a mock Socket.IO socket
 */
export const createMockSocket = (
  overrides: Partial<{
    id: string;
    data: Record<string, unknown>;
    handshake: { headers: { cookie?: string } };
  }> = {},
) => {
  const socket = {
    id: overrides.id || 'mock-socket-id',
    data: overrides.data || {},
    handshake: overrides.handshake || { headers: {} },
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    rooms: new Set<string>(),
  };
  return socket;
};

/**
 * Creates a mock Socket.IO server
 */
export const createMockServer = () => {
  const mockSocketsMap = new Map();

  return {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    sockets: {
      sockets: mockSocketsMap,
    },
  };
};

/**
 * Helper to create room config fixture
 */
export const createRoomConfig = (
  overrides: Partial<RoomConfig> = {},
): RoomConfig => ({
  winnersCount: 1,
  winSentiment: 'POSITIVE',
  updatedAt: Date.now(),
  ...overrides,
});

/**
 * Helper to create socket info fixture
 */
export const createSocketInfo = (
  overrides: Partial<SocketInfo> = {},
): SocketInfo => ({
  roomId: 'test-room-id',
  rid: 'test-rid',
  nickname: 'Test User',
  role: 'participant',
  lastSeen: Date.now(),
  ...overrides,
});

/**
 * Helper to create room state fixture
 */
export const createRoomState = (
  overrides: Partial<RoomState> = {},
): RoomState => ({
  lastSpin: {
    spinId: 'test-spin-id',
    decidedAt: Date.now(),
  },
  ...overrides,
});

/**
 * Waits for a specified number of milliseconds
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
