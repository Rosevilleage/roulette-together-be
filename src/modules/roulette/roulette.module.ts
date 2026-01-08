import { Module } from '@nestjs/common';
import { RouletteGateway } from './roulette.gateway';
import { RouletteService } from './roulette.service';
import { SessionModule } from '../session/session.module';
import { RedisModule } from 'src/common/redis/redis.module';

@Module({
  imports: [SessionModule, RedisModule],
  providers: [RouletteGateway, RouletteService],
})
export class RouletteModule {}
