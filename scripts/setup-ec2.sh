#!/usr/bin/env bash
# ============================================================
# EC2 초기 셋업 스크립트 (Ubuntu 24.04 기준)
# 레포 클론 없이 curl로 바로 실행 가능 (최초 1회만)
#
# 사용법 A - curl (레포 클론 전):
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/deploy-low-cost/scripts/setup-ec2.sh | bash
#
# 사용법 B - 클론 후:
#   bash scripts/setup-ec2.sh
# ============================================================
set -euo pipefail

echo "=== [1/5] 패키지 업데이트 ==="
sudo apt-get update -y
sudo apt-get upgrade -y

echo "=== [2/5] Git 설치 ==="
sudo apt-get install -y git

echo "=== [3/5] Docker 설치 ==="
sudo apt-get install -y ca-certificates curl gnupg lsb-release

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker "$USER"

echo "=== [4/5] certbot 설치 (SSL 발급용) ==="
sudo apt-get install -y certbot

echo "=== [5/5] 방화벽 설정 (ufw) ==="
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw --force enable

echo ""
echo "✅ 셋업 완료!"
echo "   ⚠️  Docker 그룹 적용을 위해 새 세션으로 재접속하세요: exec su - \$USER"
echo ""
echo "   다음 단계:"
echo "     1. exec su - \$USER  (새 세션 - Docker 그룹 적용)"
echo "     2. git clone <repo> && cd rullette-together && git checkout deploy-low-cost"
echo "     3. cp .env.example .env.prod  (값 채우기)"
echo "     4. bash scripts/deploy.sh"
echo "     5. bash scripts/init-ssl.sh <your-domain> <your-email>"
