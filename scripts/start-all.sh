#!/usr/bin/env bash
# start-all.sh — bring up the full stack in dependency order with health gates.
#
#   ML FastAPI (8501)  →  Express API (4000)  →  Vite dev server (3000)
#
# - Idempotent: skips any service whose port already answers its health check.
# - Never blocks the whole stack on the ML service: if FastAPI cannot start,
#   Express still boots honestly in model_not_connected mode (no fake output).
# - Preview hostname: pass PV_HOSTS="host1,host2" to allow cloud preview hosts
#   on Vite (server.allowedHosts), e.g.
#     PV_HOSTS="pv-xxxx.style.dev" scripts/start-all.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ML_PORT="${ML_SERVICE_PORT:-8501}"
API_PORT="${PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
ML_HEALTH="http://127.0.0.1:${ML_PORT}/health"
API_HEALTH="http://127.0.0.1:${API_PORT}/api/health"
WEB_URL="http://127.0.0.1:${WEB_PORT}/"
PV_HOSTS="${PV_HOSTS:-}"

log()  { printf '[start-all] %s\n' "$*"; }
up()   { curl -fsS -m 2 "$1" > /dev/null 2>&1; }
wait_for() { # wait_for <url> <name> <timeout_s>
  local i=0
  while [ "$i" -lt "$3" ]; do
    if up "$1"; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ── 1. ML inference service ────────────────────────────────────────────────
if up "$ML_HEALTH"; then
  log "ML service already healthy on :${ML_PORT}"
elif [ -x "ml/.venv/bin/python" ]; then
  log "starting ML service (FastAPI) on :${ML_PORT}…"
  ( cd ml && setsid nohup ./.venv/bin/python serve.py > ../fastapi.log 2>&1 < /dev/null & )
  if wait_for "$ML_HEALTH" "ML" 90; then
    log "ML service healthy ✔"
  else
    log "ML service did NOT become healthy — see fastapi.log."
    log "Express will start in honest model_not_connected mode (no fake predictions)."
  fi
else
  log "ml/.venv missing — skipping ML service (model_not_connected mode)."
  log "Bootstrap: cd ml && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
fi

# ── 2. Express API (needs ML env; waits for ML before treating as connected) ─
if up "$API_HEALTH"; then
  log "API already healthy on :${API_PORT}"
else
  log "starting Express API on :${API_PORT}…"
  ( cd server && ML_ADAPTER_MODE="${ML_ADAPTER_MODE:-python-http}" \
      ML_SERVICE_URL="${ML_SERVICE_URL:-http://127.0.0.1:${ML_PORT}/predict}" \
      BATCH_MAX_REVIEWS="${BATCH_MAX_REVIEWS:-10}" ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}" \
      setsid nohup node src/server.js > ../express.log 2>&1 < /dev/null & )
  if wait_for "$API_HEALTH" "API" 30; then
    log "API healthy ✔  ($(curl -fsS -m 3 "$API_HEALTH" | tr -d '\n'))"
  else
    log "API FAILED to start — see express.log"; exit 1
  fi
fi

# ── 3. Vite dev server (allowed hosts include the cloud preview hostname) ──
if up "$WEB_URL"; then
  log "frontend already serving on :${WEB_PORT}"
else
  log "starting Vite dev server on :${WEB_PORT}…"
  ( cd frontend && PORT="$WEB_PORT" VITE_ADDITIONAL_ALLOWED_HOSTS="$PV_HOSTS" \
      setsid nohup npx vite > ../vite.log 2>&1 < /dev/null & )
  if wait_for "$WEB_URL" "Vite" 30; then
    log "frontend serving ✔  →  ${WEB_URL} (preview host allowed: ${PV_HOSTS:-none})"
  else
    log "Vite FAILED to start — see vite.log"; exit 1
  fi
fi

log "stack ready: ML :${ML_PORT} · API :${API_PORT} · Web :${WEB_PORT}"
