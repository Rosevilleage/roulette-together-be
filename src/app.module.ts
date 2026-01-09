import { Module } from '@nestjs/common';
import { RedisModule } from './common/redis/redis.module';
import { RouletteModule } from './modules/roulette/roulette.module';

@Module({
  imports: [RedisModule, RouletteModule],
})
export class AppModule {}
