#!/bin/bash

# Health check endpoint test script
# Usage: ./test-health.sh [host:port]
# Example: ./test-health.sh localhost:8080

HOST="${1:-localhost:8080}"

echo "======================================"
echo "Testing Health Check Endpoints"
echo "Host: $HOST"
echo "======================================"
echo ""

# Test 1: /health
echo "1. Testing GET /health (ALB health check)"
curl -v "http://$HOST/health" 2>&1 | grep -E "HTTP|ok"
echo ""

# Test 2: /v1/health (with version)
echo "2. Testing GET /v1/health (with version)"
curl -v "http://$HOST/v1/health" 2>&1 | grep -E "HTTP|ok|404"
echo ""

# Test 3: /health/live
echo "3. Testing GET /health/live (liveness)"
curl -v "http://$HOST/health/live" 2>&1 | grep -E "HTTP|status"
echo ""

# Test 4: /health/ready
echo "4. Testing GET /health/ready (readiness)"
curl -v "http://$HOST/health/ready" 2>&1 | grep -E "HTTP|status|redis"
echo ""

# Test 5: /health/deps
echo "5. Testing GET /health/deps (dependencies)"
curl -v "http://$HOST/health/deps" 2>&1 | grep -E "HTTP|status|redis|memory"
echo ""

echo "======================================"
echo "Test completed"
echo "======================================"
