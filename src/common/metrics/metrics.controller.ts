import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@Controller({
  path: 'metrics',
  version: '',
})
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiExcludeEndpoint()
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
