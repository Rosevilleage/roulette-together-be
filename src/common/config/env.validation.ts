import { plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
  type ValidationError,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  [key: string]: unknown;

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

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  CORS_ORIGIN: string[] = ['http://localhost:5173', 'http://localhost:3000'];

  @IsString()
  @IsOptional()
  FRONTEND_URL: string = 'http://localhost:3000';
}

export function validate(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors: ValidationError[] = validateSync(validatedConfig, {
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
