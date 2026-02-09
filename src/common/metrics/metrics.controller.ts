import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@Controller({
  path: 'metrics',
  version: '',
})
@SkipThrottle() // 메트릭스는 스로틀링 제외
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    try {
      // 3초 타임아웃 추가
      const metricsPromise = this.metricsService.getMetrics();
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Metrics timeout')), 3000),
      );

      return await Promise.race([metricsPromise, timeoutPromise]);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // 타임아웃이나 에러 발생시 빈 메트릭 반환
      return '# Metrics collection failed\n';
    }
  }
}
