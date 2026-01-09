import { Module } from '@nestjs/common';
import { RouletteGateway } from './roulette.gateway';
import { RouletteService } from './roulette.service';
import { RouletteController } from './roulette.controller';
import { RedisModule } from 'src/common/redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [RouletteController],
  providers: [RouletteGateway, RouletteService],
})
export class RouletteModule {}
