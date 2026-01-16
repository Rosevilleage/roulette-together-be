import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * 메트릭 수집 서비스
 *
 * Prometheus 형식의 메트릭을 수집하고 노출합니다.
 * - HTTP 요청 메트릭
 * - WebSocket 연결 메트릭
 * - 비즈니스 메트릭 (방, 스핀 등)
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;

  /** HTTP 요청 총 횟수 */
  readonly httpRequestsTotal: Counter;

  /** HTTP 요청 처리 시간 */
  readonly httpRequestDuration: Histogram;

  /** 활성 WebSocket 연결 수 */
  readonly wsConnectionsActive: Gauge;

  /** WebSocket 이벤트 총 횟수 */
  readonly wsEventsTotal: Counter;

  /** 활성 방 수 */
  readonly roomsActive: Gauge;

  /** 스핀 총 횟수 */
  readonly spinsTotal: Counter;

  constructor() {
    this.registry = new Registry();

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });

    this.wsConnectionsActive = new Gauge({
      name: 'ws_connections_active',
      help: 'Active WebSocket connections',
      registers: [this.registry],
    });

    this.wsEventsTotal = new Counter({
      name: 'ws_events_total',
      help: 'Total WebSocket events',
      labelNames: ['event'],
      registers: [this.registry],
    });

    this.roomsActive = new Gauge({
      name: 'rooms_active',
      help: 'Active rooms count',
      registers: [this.registry],
    });

    this.spinsTotal = new Counter({
      name: 'spins_total',
      help: 'Total spins performed',
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
