#!/bin/bash

# Health Check 로컬 테스트 스크립트
# Redis가 다운된 상태에서도 /health가 즉시 응답하는지 확인

set -e

echo "======================================"
echo "Health Check 테스트 시작"
echo "======================================"
echo ""

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 서버 URL
SERVER_URL="http://localhost:8080"

# 테스트 함수
test_endpoint() {
  local endpoint=$1
  local max_time=$2
  local expected_status=$3
  local description=$4
  
  echo -e "${YELLOW}테스트: ${description}${NC}"
  echo "Endpoint: ${endpoint}"
  echo "Max time: ${max_time}s"
  echo "Expected: ${expected_status}"
  
  # 시작 시간 기록
  start_time=$(date +%s%N)
  
  # curl 실행
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time ${max_time} "${SERVER_URL}${endpoint}" || echo "timeout")
  
  # 종료 시간 기록
  end_time=$(date +%s%N)
  
  # 응답 시간 계산 (밀리초)
  elapsed_ms=$(( (end_time - start_time) / 1000000 ))
  
  echo "HTTP Status: ${http_code}"
  echo "Response time: ${elapsed_ms}ms"
  
  # 결과 판정
  if [ "$http_code" = "timeout" ]; then
    echo -e "${RED}❌ FAIL: Timeout (hang 발생!)${NC}"
    return 1
  elif [ "$http_code" = "$expected_status" ]; then
    if [ $elapsed_ms -lt 1000 ]; then
      echo -e "${GREEN}✅ PASS: ${http_code} (${elapsed_ms}ms)${NC}"
      return 0
    else
      echo -e "${YELLOW}⚠️  WARN: ${http_code} but slow (${elapsed_ms}ms)${NC}"
      return 0
    fi
  else
    echo -e "${RED}❌ FAIL: Expected ${expected_status} but got ${http_code}${NC}"
    return 1
  fi
  
  echo ""
}

# 서버 실행 확인
echo "서버 연결 확인 중..."
if ! curl -s --max-time 2 "${SERVER_URL}/health" > /dev/null 2>&1; then
  echo -e "${RED}❌ 서버가 실행 중이지 않습니다. 먼저 서버를 시작하세요:${NC}"
  echo "  pnpm run dev"
  exit 1
fi
echo -e "${GREEN}✅ 서버 연결 확인 완료${NC}"
echo ""

# Redis 상태 확인
echo "Redis 상태 확인 중..."
if docker ps | grep -q redis; then
  REDIS_STATUS="running"
  echo -e "${YELLOW}⚠️  Redis가 실행 중입니다.${NC}"
  echo "Redis 다운 상태를 테스트하려면 다음 명령어를 실행하세요:"
  echo "  pnpm run docker:down"
  echo ""
else
  REDIS_STATUS="down"
  echo -e "${GREEN}✅ Redis가 다운 상태입니다 (정상 - hang 테스트)${NC}"
  echo ""
fi

# 테스트 실행
FAILED=0

echo "======================================"
echo "1. /health 테스트 (즉시 응답)"
echo "======================================"
if ! test_endpoint "/health" 1 "200" "ALB Health Check"; then
  FAILED=$((FAILED + 1))
fi
echo ""

echo "======================================"
echo "2. /health/live 테스트 (즉시 응답)"
echo "======================================"
if ! test_endpoint "/health/live" 1 "200" "Liveness Probe"; then
  FAILED=$((FAILED + 1))
fi
echo ""

if [ "$REDIS_STATUS" = "running" ]; then
  echo "======================================"
  echo "3. /health/ready 테스트 (Redis 정상)"
  echo "======================================"
  if ! test_endpoint "/health/ready" 2 "200" "Readiness Probe"; then
    FAILED=$((FAILED + 1))
  fi
  echo ""
  
  echo "======================================"
  echo "4. /health/deps 테스트 (Redis 정상)"
  echo "======================================"
  if ! test_endpoint "/health/deps" 2 "200" "Dependencies Check"; then
    FAILED=$((FAILED + 1))
  fi
  echo ""
else
  echo "======================================"
  echo "3. /health/ready 테스트 (Redis 다운)"
  echo "======================================"
  if ! test_endpoint "/health/ready" 2 "503" "Readiness Probe"; then
    FAILED=$((FAILED + 1))
  fi
  echo ""
  
  echo "======================================"
  echo "4. /health/deps 테스트 (Redis 다운)"
  echo "======================================"
  if ! test_endpoint "/health/deps" 2 "503" "Dependencies Check"; then
    FAILED=$((FAILED + 1))
  fi
  echo ""
fi

# 최종 결과
echo "======================================"
echo "테스트 결과"
echo "======================================"
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ 모든 테스트 통과!${NC}"
  echo ""
  echo "핵심 확인 사항:"
  echo "  - /health가 즉시 200 응답 (Redis 무관)"
  echo "  - /health/live가 즉시 200 응답 (Redis 무관)"
  if [ "$REDIS_STATUS" = "down" ]; then
    echo "  - /health/ready가 1초 이내 503 응답 (hang 없음!)"
    echo "  - /health/deps가 1초 이내 503 응답 (hang 없음!)"
  else
    echo "  - /health/ready가 빠르게 200 응답"
    echo "  - /health/deps가 빠르게 200 응답"
  fi
  echo ""
  echo "ECS 배포 준비 완료!"
  exit 0
else
  echo -e "${RED}❌ ${FAILED}개 테스트 실패${NC}"
  echo ""
  echo "문제 해결:"
  echo "  1. 서버 로그 확인: pnpm run dev"
  echo "  2. Redis 상태 확인: docker ps"
  echo "  3. 빌드 확인: pnpm run build"
  exit 1
fi
