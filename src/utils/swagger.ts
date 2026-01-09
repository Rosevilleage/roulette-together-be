import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('🎰 Rullette Together API')
    .setDescription(
      `
## 실시간 다중 사용자 룰렛 게임 API

### 주요 기능
- 세션 기반 사용자 인증
- WebSocket을 통한 실시간 게임 통신
- 방 생성 및 관리
- 룰렛 스핀 및 결과 처리

### WebSocket 연결
WebSocket 이벤트는 이 Swagger UI에서 문서화되지 않습니다.
WebSocket 연결: \`ws://localhost:3000\`

**사용 가능한 이벤트:**
- \`room:join\` - 방 입장
- \`room:config:set\` - 방 설정 변경
- \`spin:request\` - 룰렛 스핀 요청

자세한 내용은 README.md를 참고하세요.
    `,
    )
    .setVersion('1.0.0')
    .addCookieAuth('rid', {
      type: 'apiKey',
      in: 'cookie',
      name: 'rid',
      description: 'HMAC 서명된 세션 ID',
    })
    .addTag('Session', '세션 관리 API')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    customSiteTitle: 'Rullette Together API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
