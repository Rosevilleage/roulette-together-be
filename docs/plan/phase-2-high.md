# Phase 2: High Priority - 높은 우선순위 작업

> 🟠 **우선순위**: High
> **목표**: 코드 품질 및 유지보수성 향상

---

## 2.1 NestJS Logger 도입

### 현재 상태
- 전역적으로 `console.log`, `console.error` 사용
- 구조화된 로깅 없음
- 로그 레벨 제어 불가

### 목표
- NestJS 내장 Logger로 전환
- 구조화된 로그 출력
- 환경별 로그 레벨 제어

### 작업 항목

#### 2.1.1 Logger 서비스 설정
- [ ] main.ts에서 로거 설정

```typescript
// src/main.ts
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const logger = new Logger('Bootstrap');

  await app.listen(process.env.PORT ?? 3000);
  logger.log(`Application is running on: ${await app.getUrl()}`);
}
```

#### 2.1.2 RedisService Logger 적용
- [ ] console.log → Logger 교체

```typescript
// src/common/redis/redis.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  async onModuleInit() {
    this.logger.log('Connecting to Redis...');
    // ...
    this.logger.log('Redis connection established');
  }

  async onModuleDestroy() {
    this.logger.log('Closing Redis connections...');
  }
}
```

#### 2.1.3 RouletteService Logger 적용
- [ ] console.log → Logger 교체

```typescript
// src/modules/roulette/roulette.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RouletteService {
  private readonly logger = new Logger(RouletteService.name);

  async handleRoomJoin(client: Socket, payload: RoomJoinDto) {
    this.logger.log(`Room join attempt: ${payload.roomId}`);

    try {
      // ...
      this.logger.debug(`User ${rid} joined room ${roomId} as ${role}`);
    } catch (error) {
      this.logger.error(`Room join failed: ${error.message}`, error.stack);
    }
  }
}
```

#### 2.1.4 RouletteGateway Logger 적용
- [ ] console.log → Logger 교체

```typescript
// src/modules/roulette/roulette.gateway.ts
import { Logger } from '@nestjs/common';

@WebSocketGateway()
export class RouletteGateway {
  private readonly logger = new Logger(RouletteGateway.name);

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }
}
```

#### 2.1.5 RouletteController Logger 적용
- [ ] console.log → Logger 교체

### 완료 기준
- [ ] 모든 console.log/error 제거
- [ ] 각 클래스에 Logger 인스턴스 추가
- [ ] 적절한 로그 레벨 사용 (log, debug, warn, error)

---

## 2.2 전역 예외 필터 구현

### 현재 상태
- 기본 NestJS 예외 처리만 사용
- 일관되지 않은 에러 응답 형식
- 커스텀 예외 클래스 없음

### 목표
- 통일된 에러 응답 형식
- 커스텀 예외 클래스로 명확한 에러 정의
- HTTP 및 WebSocket 에러 일관성

### 작업 항목

#### 2.2.1 공통 에러 응답 인터페이스 정의
- [ ] `src/common/interfaces/error-response.interface.ts` 생성

```typescript
// src/common/interfaces/error-response.interface.ts
export interface ErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  timestamp: string;
  path?: string;
  details?: Record<string, unknown>;
}
```

#### 2.2.2 커스텀 예외 클래스 생성
- [ ] `src/common/exceptions/` 디렉토리 생성

```typescript
// src/common/exceptions/room.exception.ts
import { NotFoundException, BadRequestException } from '@nestjs/common';

export class RoomNotFoundException extends NotFoundException {
  constructor(roomId: string) {
    super({
      errorCode: 'ROOM_NOT_FOUND',
      message: `Room with ID '${roomId}' does not exist`,
    });
  }
}

export class RoomFullException extends BadRequestException {
  constructor(roomId: string) {
    super({
      errorCode: 'ROOM_FULL',
      message: `Room '${roomId}' has reached maximum capacity`,
    });
  }
}

export class InvalidOwnerTokenException extends BadRequestException {
  constructor() {
    super({
      errorCode: 'INVALID_OWNER_TOKEN',
      message: 'Invalid or missing owner token',
    });
  }
}

export class NotAllReadyException extends BadRequestException {
  constructor() {
    super({
      errorCode: 'NOT_ALL_READY',
      message: 'Not all participants are ready',
    });
  }
}

export class AlreadySpinningException extends BadRequestException {
  constructor() {
    super({
      errorCode: 'ALREADY_SPINNING',
      message: 'A spin is already in progress',
    });
  }
}
```

#### 2.2.3 HTTP 예외 필터 구현
- [ ] `src/common/filters/http-exception.filter.ts` 생성

```typescript
// src/common/filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponse } from '../interfaces/error-response.interface';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        errorCode = (resp.errorCode as string) || this.getDefaultErrorCode(status);
        message = (resp.message as string) || exception.message;
        details = resp.details as Record<string, unknown>;
      } else {
        message = exceptionResponse;
      }
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(details && { details }),
    };

    this.logger.error(
      `${request.method} ${request.url} - ${status} ${errorCode}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(errorResponse);
  }

  private getDefaultErrorCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      500: 'INTERNAL_ERROR',
    };
    return codes[status] || 'UNKNOWN_ERROR';
  }
}
```

#### 2.2.4 WebSocket 예외 필터 구현
- [ ] `src/common/filters/ws-exception.filter.ts` 생성

```typescript
// src/common/filters/ws-exception.filter.ts
import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsAllExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsAllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const data = host.switchToWs().getData();

    let errorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof WsException) {
      const error = exception.getError();
      if (typeof error === 'object') {
        errorCode = (error as any).errorCode || errorCode;
        message = (error as any).message || message;
      } else {
        message = error;
      }
    }

    this.logger.error(`WebSocket error: ${errorCode} - ${message}`, {
      clientId: client.id,
      data,
    });

    // 이벤트 이름 추출 (room:join → room:join:rejected)
    const eventPattern = data?.event || 'error';
    client.emit(`${eventPattern}:rejected`, {
      reason: errorCode,
      message,
    });
  }
}
```

#### 2.2.5 전역 필터 등록
- [ ] main.ts에 필터 등록

```typescript
// src/main.ts
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new AllExceptionsFilter());

  // ...
}
```

#### 2.2.6 Gateway에 WS 필터 등록
- [ ] RouletteGateway에 필터 적용

```typescript
// src/modules/roulette/roulette.gateway.ts
import { UseFilters } from '@nestjs/common';
import { WsAllExceptionsFilter } from '../../common/filters/ws-exception.filter';

@WebSocketGateway()
@UseFilters(new WsAllExceptionsFilter())
export class RouletteGateway {
  // ...
}
```

### 완료 기준
- [ ] 모든 예외가 통일된 형식으로 응답
- [ ] 커스텀 예외 클래스 사용
- [ ] HTTP/WebSocket 모두 일관된 에러 처리

---

## 2.3 설정 검증 모듈 추가

### 현재 상태
- `process.env` 직접 사용
- 환경 변수 누락 시 런타임 오류
- 타입 안전성 없음

### 목표
- 시작 시 환경 변수 검증
- 타입 안전한 설정 접근
- ConfigService 사용

### 작업 항목

#### 2.3.1 ConfigModule 설치 확인
- [ ] `@nestjs/config` 패키지 확인 (이미 설치됨)

#### 2.3.2 환경 변수 검증 클래스 생성
- [ ] `src/common/config/env.validation.ts` 생성

```typescript
// src/common/config/env.validation.ts
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  REDIS_URL: string;

  @IsString()
  SESSION_SECRET: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:5173';

  @IsUrl({ require_tld: false })
  @IsOptional()
  FRONTEND_URL: string = 'http://localhost:3000';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((err) => Object.values(err.constraints || {}).join(', '))
      .join('\n');
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  return validatedConfig;
}
```

#### 2.3.3 AppModule에 ConfigModule 등록
- [ ] app.module.ts 수정

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './common/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    RedisModule,
    RouletteModule,
  ],
})
export class AppModule {}
```

#### 2.3.4 ConfigService로 환경 변수 접근
- [ ] process.env → ConfigService 교체

```typescript
// src/common/redis/redis.service.ts
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService {
  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.client = new Redis(redisUrl);
  }
}

// src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({ origin: corsOrigin, credentials: true });

  const port = configService.get<number>('PORT');
  await app.listen(port);
}
```

### 완료 기준
- [ ] 필수 환경 변수 누락 시 시작 실패
- [ ] 모든 process.env 직접 접근 제거
- [ ] ConfigService 주입으로 타입 안전성 확보

---

## 체크리스트 요약

### Logger (2.1)
- [ ] main.ts 로거 설정
- [ ] RedisService Logger 적용
- [ ] RouletteService Logger 적용
- [ ] RouletteGateway Logger 적용
- [ ] RouletteController Logger 적용

### 예외 필터 (2.2)
- [ ] 에러 응답 인터페이스
- [ ] 커스텀 예외 클래스
- [ ] HTTP 예외 필터
- [ ] WebSocket 예외 필터
- [ ] 전역 필터 등록

### 설정 검증 (2.3)
- [ ] 환경 변수 검증 클래스
- [ ] ConfigModule 등록
- [ ] ConfigService 사용

---

## 다음 단계

Phase 2 완료 후 → [Phase 3: Medium Priority](phase-3-medium.md)
