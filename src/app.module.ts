import { Module } from '@nestjs/common';
import { SessionModule } from './session/session.module';
import { RedisModule } from './redis/redis.module';
import { RouletteModule } from './roulette/roulette.module';

@Module({
  imports: [SessionModule, RedisModule, RouletteModule],
})
export class AppModule {}
