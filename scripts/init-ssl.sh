#!/usr/bin/env bash
# ============================================================
# Let's Encrypt SSL 인증서 최초 발급 스크립트
#
# 사용법:
#   # origin-api 도메인만
#   bash scripts/init-ssl.sh <origin-api-domain> <email>
#
#   # origin-api + ws 도메인 함께
#   bash scripts/init-ssl.sh <origin-api-domain> <email> <ws-domain>
#
# 예시:
#   bash scripts/init-ssl.sh origin-api.example.com admin@example.com
#   bash scripts/init-ssl.sh origin-api.example.com admin@example.com ws.example.com
#
# 전제조건:
#   - 각 도메인의 A레코드가 이 EC2 Elastic IP를 가리키고 있어야 합니다.
#   - docker compose -f docker-compose.prod.yml up -d 이 실행 중이어야 합니다.
#   - .env.prod 에 ORIGIN_VERIFY_SECRET 값이 설정되어 있어야 합니다.
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
WS_DOMAIN="${3:-}"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
NGINX_CONF="nginx/conf.d/app.conf"
COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "사용법: bash scripts/init-ssl.sh <origin-api-domain> <email> [ws-domain]"
  exit 1
fi

# .env.prod 에서 ORIGIN_VERIFY_SECRET 파싱
ORIGIN_VERIFY_SECRET=""
if [ -f "$ENV_FILE" ]; then
  ORIGIN_VERIFY_SECRET=$(grep -E '^ORIGIN_VERIFY_SECRET=' "$ENV_FILE" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "$ORIGIN_VERIFY_SECRET" ]; then
  echo "❌ 오류: $ENV_FILE 에 ORIGIN_VERIFY_SECRET 값이 없습니다."
  echo "   openssl rand -base64 48 로 생성 후 .env.prod 에 추가하세요."
  exit 1
fi

echo "=== [1/4] certbot standalone으로 인증서 발급 ==="
# Nginx가 80포트를 점유하므로 잠시 중지
$COMPOSE stop nginx

sudo certbot certonly \
  --standalone \
  --preferred-challenges http \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

if [ -n "$WS_DOMAIN" ]; then
  echo "    → ws 도메인 인증서 발급: $WS_DOMAIN"
  sudo certbot certonly \
    --standalone \
    --preferred-challenges http \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$WS_DOMAIN"
fi

echo "=== [2/4] Nginx SSL 설정 활성화 ==="
cat > "$NGINX_CONF" << EOF
upstream app_backend {
  server app:8080;
  keepalive 32;
}

# HTTP: certbot 갱신 + HTTPS 리다이렉트
server {
  listen 80;
  server_name ${DOMAIN}${WS_DOMAIN:+ $WS_DOMAIN};

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://\$host\$request_uri;
  }
}

# [A] CloudFront origin-facing 전용 (HTTP API)
# 브라우저가 직접 접근하는 도메인이 아니라 CloudFront가 바라보는 origin 도메인입니다.
server {
  listen 443 ssl http2;
  server_name ${DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         HIGH:!aNULL:!MD5;
  ssl_session_cache   shared:SSL:10m;
  ssl_session_timeout 10m;
  ssl_stapling        on;
  ssl_stapling_verify on;

  # CloudFront secret header 검사
  # CloudFront Origin custom header(X-Origin-Verify)가 없거나 다르면 403
  if (\$http_x_origin_verify != "${ORIGIN_VERIFY_SECRET}") {
    return 403;
  }

  location / {
    limit_req          zone=api_limit burst=30 nodelay;
    proxy_pass         http://app_backend;
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_buffering    off;
    proxy_read_timeout 60s;
  }
}
EOF

# [B] ws 도메인이 있을 때만 WebSocket 전용 블록 추가
if [ -n "$WS_DOMAIN" ]; then
  cat >> "$NGINX_CONF" << EOF

# [B] WebSocket 전용 (브라우저에서 wss:// 로 직접 연결)
server {
  listen 443 ssl http2;
  server_name ${WS_DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${WS_DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${WS_DOMAIN}/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         HIGH:!aNULL:!MD5;
  ssl_session_cache   shared:SSL:10m;
  ssl_session_timeout 10m;
  ssl_stapling        on;
  ssl_stapling_verify on;

  location / {
    limit_req          zone=ws_limit burst=10 nodelay;
    proxy_pass         http://app_backend;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_buffering    off;
    proxy_read_timeout 86400s;
  }
}
EOF
fi

echo "=== [3/4] Nginx 재시작 ==="
$COMPOSE start nginx

echo "=== [4/4] certbot 자동 갱신 컨테이너 시작 ==="
$COMPOSE --profile ssl up -d certbot

echo ""
echo "✅ SSL 설정 완료!"
echo "   [A] origin 도메인 https://${DOMAIN} → CloudFront origin (secret header 검사 활성)"
if [ -n "$WS_DOMAIN" ]; then
  echo "   [B] ws 도메인    wss://${WS_DOMAIN}  → WebSocket 직접 연결"
fi
echo ""
echo "   CloudFront Origin custom header: X-Origin-Verify = (ORIGIN_VERIFY_SECRET 값)"
echo ""
echo "   인증서 자동 갱신: certbot 컨테이너가 12시간마다 갱신을 시도합니다."
echo "   수동 갱신 테스트: docker compose --env-file .env.prod -f docker-compose.prod.yml exec certbot certbot renew --dry-run"
