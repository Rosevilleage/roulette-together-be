import { Module } from '@nestjs/common';
import { SessionModule } from './modules/session/session.module';
import { RedisModule } from './common/redis/redis.module';
import { RouletteModule } from './modules/roulette/roulette.module';

@Module({
  imports: [SessionModule, RedisModule, RouletteModule],
})
export class AppModule {}
