import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { AppModule } from '../src/app.module';

interface RoomResponse {
  roomId: string;
  title: string;
  createdAt: string;
  winnersCount?: number;
  winSentiment?: string;
}

interface RoomsListResponse {
  rooms: RoomResponse[];
  queriedAt: string;
}

/**
 * E2E Tests for the Roulette Together API
 *
 * These tests require a running Redis instance.
 * Start Redis with: pnpm run docker:up
 */
describe('AppController (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply the same middleware as main.ts
    app.use(cookieParser());

    // Apply the same pipes as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
    httpServer = app.getHttpServer() as Server;
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  }, 10000);

  describe('POST /rooms', () => {
    it('should create a new room', async () => {
      const response = await request(httpServer)
        .post('/rooms')
        .send({
          title: 'Test Room',
          nickname: 'TestOwner',
        })
        .expect(201);

      const body = response.body as RoomResponse;
      expect(body).toHaveProperty('roomId');
      expect(body.roomId).toMatch(/^room-[a-f0-9]{16}$/);
      expect(body.title).toBe('Test Room');
      expect(body.createdAt).toBeDefined();
    });

    it('should set owner_token cookie', async () => {
      const response = await request(httpServer)
        .post('/rooms')
        .send({ title: 'Cookie Test' })
        .expect(201);

      const body = response.body as RoomResponse;
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const ownerCookie = (cookies as unknown as string[]).find((c: string) =>
        c.startsWith(`owner_token_${body.roomId}`),
      );
      expect(ownerCookie).toBeDefined();
      expect(ownerCookie).toContain('HttpOnly');
    });

    it('should use default values when not provided', async () => {
      const response = await request(httpServer)
        .post('/rooms')
        .send({})
        .expect(201);

      const body = response.body as RoomResponse;
      expect(body.title).toBe('룰렛 방');
    });

    it('should create room with custom config', async () => {
      const response = await request(httpServer)
        .post('/rooms')
        .send({
          title: 'Custom Config Room',
          winnersCount: 5,
          winSentiment: 'NEGATIVE',
        })
        .expect(201);

      const body = response.body as RoomResponse;
      expect(body.roomId).toBeDefined();
    });

    it('should reject invalid winnersCount type', async () => {
      await request(httpServer)
        .post('/rooms')
        .send({
          winnersCount: 'invalid',
        })
        .expect(400);
    });

    it('should reject invalid winSentiment value', async () => {
      await request(httpServer)
        .post('/rooms')
        .send({
          winSentiment: 'INVALID',
        })
        .expect(400);
    });

    it('should reject extra properties', async () => {
      await request(httpServer)
        .post('/rooms')
        .send({
          title: 'Test',
          unknownProperty: 'value',
        })
        .expect(400);
    });
  });

  describe('GET /rooms', () => {
    it('should return empty array without cookies', async () => {
      const response = await request(httpServer).get('/rooms').expect(200);

      const body = response.body as RoomsListResponse;
      expect(body).toHaveProperty('rooms');
      expect(body.rooms).toEqual([]);
      expect(body.queriedAt).toBeDefined();
    });

    it('should return rooms for valid owner cookies', async () => {
      // First create a room
      const createResponse = await request(httpServer)
        .post('/rooms')
        .send({ title: 'My Room' });

      const createdRoom = createResponse.body as RoomResponse;
      const cookies = createResponse.headers[
        'set-cookie'
      ] as unknown as string[];

      // Then get rooms with the cookie
      const response = await request(httpServer)
        .get('/rooms')
        .set('Cookie', cookies)
        .expect(200);

      const body = response.body as RoomsListResponse;
      expect(body.rooms.length).toBeGreaterThanOrEqual(1);

      const room = body.rooms.find((r) => r.roomId === createdRoom.roomId);
      expect(room).toBeDefined();
      expect(room?.title).toBe('My Room');
    });

    it('should include room configuration in response', async () => {
      // Create room with specific config
      const createResponse = await request(httpServer).post('/rooms').send({
        title: 'Config Test Room',
        winnersCount: 3,
        winSentiment: 'NEGATIVE',
      });

      const createdRoom = createResponse.body as RoomResponse;
      const cookies = createResponse.headers[
        'set-cookie'
      ] as unknown as string[];

      const response = await request(httpServer)
        .get('/rooms')
        .set('Cookie', cookies)
        .expect(200);

      const body = response.body as RoomsListResponse;
      const room = body.rooms.find((r) => r.roomId === createdRoom.roomId);
      expect(room?.winnersCount).toBe(3);
      expect(room?.winSentiment).toBe('NEGATIVE');
    });
  });
});
