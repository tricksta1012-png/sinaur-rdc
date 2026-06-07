#!/usr/bin/env bash
# healthcheck.sh — Vérifie l'état de tous les services SINAUR-RDC
#
# Usage : ./healthcheck.sh [--json]
# Retourne 0 si tous les services sont sains, 1 sinon.

set -uo pipefail

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

API_URL="${API_URL:-http://localhost:3000}"
SYNC_URL="${SYNC_URL:-http://localhost:3003}"
USSD_URL="${USSD_URL:-http://localhost:3002}"
ALERTING_URL="${ALERTING_URL:-http://localhost:3001}"
PROM_URL="${PROM_URL:-http://localhost:9090}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3500}"

declare -A RESULTS
declare -A LATENCIES

check_http() {
  local name="$1"
  local url="$2"
  local start end latency http_code

  start=$(date +%s%3N)
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}" 2>/dev/null || echo "000")
  end=$(date +%s%3N)
  latency=$((end - start))

  LATENCIES["${name}"]="${latency}ms"

  if [[ "${http_code}" =~ ^[23] ]]; then
    RESULTS["${name}"]="ok"
  else
    RESULTS["${name}"]="FAIL (HTTP ${http_code})"
  fi
}

check_postgres() {
  local start end latency
  start=$(date +%s%3N)
  if pg_isready -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-sinaur}" -q 2>/dev/null; then
    end=$(date +%s%3N)
    latency=$((end - start))
    RESULTS["postgres"]="ok"
    LATENCIES["postgres"]="${latency}ms"
  else
    RESULTS["postgres"]="FAIL"
    LATENCIES["postgres"]="N/A"
  fi
}

check_redis() {
  local start end latency
  start=$(date +%s%3N)
  if redis-cli -u "${REDIS_URL:-redis://localhost:6379}" ping 2>/dev/null | grep -q PONG; then
    end=$(date +%s%3N)
    latency=$((end - start))
    RESULTS["redis"]="ok"
    LATENCIES["redis"]="${latency}ms"
  else
    RESULTS["redis"]="FAIL"
    LATENCIES["redis"]="N/A"
  fi
}

check_http "api"       "${API_URL}/health"
check_http "sync"      "${SYNC_URL}/health"
check_http "ussd"      "${USSD_URL}/health"
check_http "alerting"  "${ALERTING_URL}/health"
check_http "prometheus" "${PROM_URL}/-/healthy"
check_http "grafana"   "${GRAFANA_URL}/api/health"
check_postgres
check_redis

GLOBAL_STATUS=0
for svc in "${!RESULTS[@]}"; do
  [[ "${RESULTS[$svc]}" != "ok" ]] && GLOBAL_STATUS=1
done

if $JSON_MODE; then
  echo "{"
  echo '  "timestamp": "'$(date -Iseconds)'",'
  echo '  "overall": "'$( [[ $GLOBAL_STATUS -eq 0 ]] && echo "ok" || echo "DEGRADED" )'",'
  echo '  "services": {'
  FIRST=true
  for svc in "${!RESULTS[@]}"; do
    $FIRST || echo ","
    FIRST=false
    printf '    "%s": {"status": "%s", "latency": "%s"}' "${svc}" "${RESULTS[$svc]}" "${LATENCIES[$svc]:-N/A}"
  done
  echo ""
  echo "  }"
  echo "}"
else
  printf "\n%-15s %-10s %s\n" "SERVICE" "STATUT" "LATENCE"
  printf "%-15s %-10s %s\n" "-------" "------" "-------"
  for svc in api sync ussd alerting prometheus grafana postgres redis; do
    STATUS="${RESULTS[$svc]:-N/A}"
    LATENCY="${LATENCIES[$svc]:-N/A}"
    if [[ "${STATUS}" == "ok" ]]; then
      printf "%-15s \033[32m%-10s\033[0m %s\n" "${svc}" "${STATUS}" "${LATENCY}"
    else
      printf "%-15s \033[31m%-10s\033[0m %s\n" "${svc}" "${STATUS}" "${LATENCY}"
    fi
  done
  echo ""
  [[ $GLOBAL_STATUS -eq 0 ]] && echo "✓ Tous les services sont sains." || echo "✗ Certains services sont en défaut."
fi

exit $GLOBAL_STATUS
