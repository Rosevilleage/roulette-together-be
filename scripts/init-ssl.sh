#!/usr/bin/env bash
# ============================================================
# Let's Encrypt SSL 인증서 최초 발급 스크립트
# 사용법: bash scripts/init-ssl.sh <도메인> <이메일>
# 예시:   bash scripts/init-ssl.sh api.example.com admin@example.com
#
# 전제조건:
#   - 도메인 A레코드가 이 EC2 IP를 가리키고 있어야 합니다.
#   - docker compose -f docker-compose.prod.yml up -d 이 실행 중이어야 합니다.
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
NGINX_CONF="nginx/conf.d/app.conf"
COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "사용법: bash scripts/init-ssl.sh <도메인> <이메일>"
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

echo "=== [2/4] Nginx SSL 설정 활성화 ==="
# 주석 처리된 HTTPS 블록을 실제 설정 파일로 생성
cat > "$NGINX_CONF" << EOF
upstream app_backend {
  server app:8080;
  keepalive 32;
}

server {
  listen 80;
  server_name ${DOMAIN};

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://\$host\$request_uri;
  }
}

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

  location / {
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

echo "=== [3/4] Nginx 재시작 ==="
$COMPOSE start nginx

echo "=== [4/4] certbot 자동 갱신 컨테이너 시작 ==="
$COMPOSE --profile ssl up -d certbot

echo ""
echo "✅ SSL 설정 완료!"
echo "   https://${DOMAIN} 으로 접속 확인하세요."
echo ""
echo "   인증서 자동 갱신: certbot 컨테이너가 12시간마다 갱신을 시도합니다."
echo "   수동 갱신 테스트: docker compose --env-file .env.prod -f docker-compose.prod.yml exec certbot certbot renew --dry-run"
