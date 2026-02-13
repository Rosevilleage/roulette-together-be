# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Rullette Together** is a real-time multiplayer roulette game backend server built with NestJS. Users can create rooms, join together, and participate in synchronized roulette spins via WebSocket connections. The system uses Redis for distributed state management and Socket.IO with Redis Adapter for multi-instance support.

## Commands

### Development
```bash
pnpm install              # Install dependencies
pnpm run dev              # Start development server (watch mode)
pnpm run start            # Start development server
pnpm run start:debug      # Start in debug mode
```

### Build and Production
```bash
pnpm run build            # Build TypeScript to dist/
pnpm run prod             # Run production build
```

### Code Quality
```bash
pnpm run format           # Format code with Prettier
pnpm run lint             # Run ESLint with auto-fix
```

### Testing
```bash
pnpm run test             # Run unit tests
pnpm run test:watch       # Run tests in watch mode
pnpm run test:cov         # Run tests with coverage
pnpm run test:e2e         # Run end-to-end tests
```

### Docker (Redis)
```bash
pnpm run docker:up        # Start Redis container
pnpm run docker:down      # Stop Redis container
pnpm run docker:logs      # View Redis logs
```

## Architecture

### Core Flow

1. **Room Creation (HTTP)**: Client calls `POST /rooms` → Server generates roomId, ownerToken (stored in secure HTTP-only cookie), and returns URLs for owner and participants
2. **Room Join (WebSocket)**: Client connects via Socket.IO with cookies → Server auto-generates rid → Client emits `room:join` with role (owner verifies via cookie)
3. **Participant Ready**: Participants toggle ready state → Owner receives participant list with ready status
4. **Spin**: Owner requests spin (only when all participants ready) → Server uses Fisher-Yates shuffle to select winners → All clients receive results

### Technology Stack

- **Framework**: NestJS 11
- **Real-time**: Socket.IO 4.8 with Redis Adapter
- **Database**: Redis (IORedis 5.9) - all state stored in Redis
- **Language**: TypeScript 5.7
- **Runtime**: Node.js 22
- **Package Manager**: pnpm

### Module Structure

```
src/
├── main.ts                 # Application entry point, CORS, validation pipes, Swagger setup
├── app.module.ts          # Root module
├── common/redis/          # Global Redis module
│   ├── redis.service.ts   # Redis operations abstraction
│   └── redis-spec.md      # Detailed Redis data structures and methods
└── modules/roulette/      # Main game logic
    ├── roulette.controller.ts  # HTTP API (room creation only)
    ├── roulette.gateway.ts     # WebSocket gateway (all game events)
    ├── roulette.service.ts     # Business logic (join, spin, ready, etc.)
    └── dto/                    # Data transfer objects with class-validator
```

### Key Architectural Patterns

**Distributed State Management**: All room state (config, members, ready status, spin locks) stored in Redis with appropriate TTLs. This enables horizontal scaling across multiple server instances.

**Role-Based Authorization**: Two roles exist - `owner` (room creator with admin privileges) and `participant`. Owner authentication uses secure HTTP-only cookies set during room creation, preventing XSS attacks. Owner can change room config and initiate spins. Participants can toggle ready state and change nicknames.

**rid (Room-scoped User ID)**: Generated on WebSocket connection (not from session/cookie). Valid only within the room context for that connection. Used to identify users in Redis and enforce permissions.

**Distributed Lock for Spins**: Uses Redis SET NX PX with Lua script for safe release. Prevents concurrent spin requests. Lock TTL: 10 seconds.

**Idempotency**: Spin requests use client-provided `requestId` cached for 30 seconds to prevent duplicate processing on retry.

**Participant Ready System**: All participants must toggle ready before owner can spin. Ready state persists after spin (participants stay ready for next round). Owner cannot be "ready" (owner is always implicitly ready).

### Redis Data Structures

All keys have 2-hour TTL except where noted:

- `room:config:{roomId}` - Room settings (winnersCount, winSentiment)
- `room:owner:{roomId}` - Owner's rid (set with NX for atomic owner selection)
- `room:owner:token:{roomId}` - Owner authentication token (verified against HTTP-only cookie)
- `room:owner:initial-nickname:{roomId}` - Owner's nickname from room creation
- `room:participant:counter:{roomId}` - Auto-increment counter for "참가자 N" nicknames
- `room:members:{roomId}` - Set of socket IDs (no TTL, cleaned on disconnect)
- `room:ready:{roomId}` - Set of ready participant socket IDs (no TTL)
- `room:socket:{socketId}` - JSON: {roomId, rid, nickname, role, lastSeen}
- `room:state:{roomId}` - JSON: {lastSpin: {spinId, decidedAt}}
- `lock:spin:{roomId}` - Spin lock value (TTL: 10s)
- `idem:spin:{roomId}:{requestId}` - Idempotency tracking (TTL: 30s)

See [src/common/redis/redis-spec.md](src/common/redis/redis-spec.md) for complete Redis operations documentation.

### WebSocket Event Flow

**Client → Server**:
- `room:join` - Join room with role and optional nickname
- `room:config:set` - Change room settings (owner only)
- `participant:ready:toggle` - Toggle ready state (participants only)
- `participant:nickname:change` - Change nickname after joining
- `spin:request` - Request roulette spin (owner only, requires all participants ready)

**Server → Client**:
- `room:joined` - Confirmation with isOwner, nickname, rid
- `room:config` - Room configuration (broadcast on change)
- `room:participants` - Participant list with ready states (to owner only)
- `spin:resolved` - Spin started, animation timing (broadcast)
- `spin:outcome` - Individual WIN/LOSE result (to each client)
- `spin:result` - All results with nicknames (broadcast)
- `nickname:changed` - Confirmation of nickname change
- `*:rejected` - Error responses with reason codes

See [src/modules/roulette/roulette-spec.md](src/modules/roulette/roulette-spec.md) for complete event specifications.

## Important Implementation Details

### Nickname Handling
- **Owner**: If nickname provided at room creation, stored in Redis. If no nickname in `room:join`, uses stored nickname or defaults to "생성자"
- **Participant**: If no nickname in `room:join`, auto-generates "참가자 N" using `room:participant:counter:{roomId}`
- **Post-join**: Any user can change nickname via `participant:nickname:change` event (1-20 characters)

### Spin Requirements
Owner's `spin:request` will be rejected (`spin:rejected` with reason `NOT_ALL_READY`) unless:
1. All participants (excluding owner) have toggled ready state
2. At least one participant exists (owner alone cannot spin)

### Socket.IO Redis Adapter
Configured in `RouletteGateway.afterInit()` with retry logic (max 50 attempts, 100ms delay). Required for multi-instance deployments. Uses separate subscriber and publisher Redis clients.

### Validation
Global ValidationPipe configured in [main.ts](src/main.ts) with:
- `whitelist: true` - Strip non-DTO properties
- `forbidNonWhitelisted: true` - Reject requests with extra properties
- `transform: true` - Auto-transform types
- `exceptionFactory` - Custom factory for user-friendly Korean validation messages with field-level details

Validation messages are mapped in [src/common/utils/validation-message.ts](src/common/utils/validation-message.ts) to provide context-specific Korean error messages for each DTO field and constraint type.

### Error Handling Patterns

#### HTTP API Error Response Format
All HTTP errors return a standardized JSON format:
```typescript
{
  statusCode: number;        // HTTP status code
  errorCode: string;         // Custom error code (UPPER_SNAKE_CASE)
  message: string;           // User-friendly Korean message
  timestamp: string;         // ISO 8601 timestamp
  path?: string;             // Request path
  details?: Record<string, unknown>;  // Additional details (optional)
}
```

**Global Exception Filters** (registered in [main.ts](src/main.ts)):
- `ThrottlerExceptionFilter` - Handles rate limit errors (429) with Korean messages
- `AllExceptionsFilter` - Catches all HTTP exceptions with standardized format

**Custom Validation Messages**: ValidationPipe configured with `exceptionFactory` to transform class-validator errors into user-friendly Korean messages with field-level details.

**Room Creation Error Codes** (see [docs/api/ERROR_RESPONSES.md](docs/api/ERROR_RESPONSES.md)):
- `INVALID_TITLE_LENGTH` - Room title exceeds 50 characters
- `INVALID_NICKNAME_LENGTH` - Nickname exceeds 20 characters
- `INVALID_WINNERS_COUNT` - Winners count out of range (1-100)
- `INVALID_WIN_SENTIMENT` - Invalid win sentiment value
- `RATE_LIMIT_EXCEEDED` - Too many requests (10/min per IP)
- `DATABASE_ERROR` - Redis operation failure
- `ROOM_CREATION_FAILED` - General room creation failure

#### WebSocket Error Response Format
WebSocket errors emit `{event}:rejected` with `reason` field. Common rejection reasons:
- `INVALID_REQUEST`, `INVALID_RID` - Missing required data
- `MISSING_OWNER_TOKEN` - Owner cookie not provided during WebSocket connection
- `INVALID_OWNER_TOKEN` - Owner cookie doesn't match stored token
- `NOT_OWNER` - Permission denied for owner-only actions
- `OWNER_ALREADY_EXISTS` - Room already has owner
- `ALREADY_SPINNING` - Spin in progress (lock held)
- `NOT_ALL_READY` - Participants not ready
- `ONLY_PARTICIPANTS_CAN_READY` - Owner tried to toggle ready
- `INVALID_NICKNAME` - Empty or >20 characters

### Security Features
- **HTTP-only Cookies**: Owner tokens stored in HTTP-only cookies prevent XSS attacks
- **Secure Flag**: Cookies use Secure flag in production (HTTPS only)
- **SameSite**: Cookies use SameSite=Lax for CSRF protection
- **Cookie Scoping**: Each room has its own cookie (`owner_token_{roomId}`)
- **Token Verification**: Owner role verified against cookie on WebSocket join
- **Credentials Required**: CORS configured with `credentials: true` for cookie support

## Configuration

Required environment variables (`.env`):
```bash
PORT=3000                              # Server port
NODE_ENV=development                   # Environment
CORS_ORIGIN=http://localhost:5173      # Frontend origin for CORS
REDIS_URL=redis://localhost:6379       # Redis connection string
FRONTEND_URL=http://localhost:3000     # Used in room URL generation
```

## Frontend Integration

Frontend development plan available at [front-dev-plan.md](front-dev-plan.md) - comprehensive guide including:
- Complete WebSocket event specifications with payloads
- React/Next.js implementation recommendations
- State management patterns (Zustand/Recoil)
- UI/UX flow for room creation, joining, ready system, and spin animation
- Participant management UI for owner (v2.1)

API documentation available at `http://localhost:3000/api` (Swagger UI) when server is running.

## Development Workflow

When modifying game logic:
1. Update DTOs in [src/modules/roulette/dto/](src/modules/roulette/dto/) if event payloads change
2. Modify business logic in [roulette.service.ts](src/modules/roulette/roulette.service.ts)
3. Update gateway handlers in [roulette.gateway.ts](src/modules/roulette/roulette.gateway.ts) if needed
4. If Redis data structures change, update [redis.service.ts](src/common/redis/redis.service.ts) and [redis-spec.md](src/common/redis/redis-spec.md)
5. Update [roulette-spec.md](src/modules/roulette/roulette-spec.md) to document changes
6. Ensure Redis is running (`pnpm run docker:up`) before testing
7. Test with multiple browser windows to verify real-time sync

## Git Commit Conventions

Project uses commitizen with conventional commits. Commit types configured in [.cz-config.js](.cz-config.js):
- `feat` - New features
- `fix` - Bug fixes
- `refactor` - Code refactoring
- `docs` - Documentation changes
- `test` - Test additions/changes
- `chore` - Build process, dependencies
- `style` - Code style changes

Husky pre-commit hook runs lint-staged to format and lint staged files.
