#!/usr/bin/env bash
# ============================================================
# 배포 스크립트
# 사용법: bash scripts/deploy.sh
# ============================================================
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE 파일이 없습니다."
  echo "   cp .env.example .env.prod 후 값을 채워주세요."
  exit 1
fi

echo "=== [1/4] 최신 코드 pull ==="
git pull origin deploy-low-cost

echo "=== [2/4] nginx/conf.d/app.conf 확인 ==="
if [ ! -f "nginx/conf.d/app.conf" ]; then
  echo "⚠️  nginx/conf.d/app.conf 가 없습니다. 템플릿으로 초기화합니다."
  cp nginx/conf.d/app.conf.example nginx/conf.d/app.conf
fi

echo "=== [3/4] Docker 이미지 빌드 및 서비스 재시작 ==="
$COMPOSE build --no-cache app
$COMPOSE up -d --remove-orphans

echo "=== [4/4] 헬스체크 (최대 60초 대기) ==="
for i in $(seq 1 12); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' rullette-app 2>/dev/null || echo "starting")
  echo "  앱 상태: $STATUS ($((i * 5))s)"
  if [ "$STATUS" = "healthy" ]; then
    echo "✅ 배포 완료!"
    $COMPOSE ps
    exit 0
  fi
  sleep 5
done

echo "⚠️  60초 내에 healthy 상태가 되지 않았습니다. 로그 확인:"
$COMPOSE logs --tail=50 app
exit 1
