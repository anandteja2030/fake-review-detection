#!/usr/bin/env bash
# Supervises the two backend processes inside one container.
#
#   FastAPI (ml/serve.py)  127.0.0.1:8501  — private, loads the real model bundle
#   Express (server/src)   0.0.0.0:$PORT   — public, proxies predictions to FastAPI
#
# Express is started immediately so /api/health answers from the first second
# (the platform health check and the UI's model-status call). Prediction requests
# that arrive while the model is still loading fail honestly with
# ML_SERVICE_UNREACHABLE and are retried by the adapter — nothing is faked.
set -euo pipefail

cd /app

export PORT="${PORT:-7860}"
export ML_SERVICE_PORT="${ML_SERVICE_PORT:-8501}"
export ML_SERVICE_URL="${ML_SERVICE_URL:-http://127.0.0.1:${ML_SERVICE_PORT}/predict}"
export ML_ADAPTER_MODE="${ML_ADAPTER_MODE:-python-http}"

echo "[entrypoint] FastAPI inference -> 127.0.0.1:${ML_SERVICE_PORT} (models: /app/ml/models)"
# cwd is /app/ml so predictor.py resolves MODEL_DIR=models to the tracked artifacts.
( cd /app/ml && exec uvicorn serve:app --host 127.0.0.1 --port "${ML_SERVICE_PORT}" --log-level info ) &
ML_PID=$!

echo "[entrypoint] Express API -> 0.0.0.0:${PORT} (ML_SERVICE_URL=${ML_SERVICE_URL})"
node /app/server/src/server.js &
API_PID=$!

STOPPING=0
term() {
  # A platform-initiated stop (docker stop, Space rebuild) must exit 0: a
  # non-zero code is reported as a crash. Only a process that dies on its own
  # is a failure worth restarting for.
  STOPPING=1
  kill -TERM "${ML_PID}" "${API_PID}" 2>/dev/null || true
}
trap term TERM INT

# Returns as soon as either process exits.
wait -n "${ML_PID}" "${API_PID}" || true

if [ "${STOPPING}" = "1" ]; then
  echo "[entrypoint] stop signal received — shutting both services down"
  wait || true
  exit 0
fi

echo "[entrypoint] a service exited — stopping the container for a clean restart"
term
wait || true
exit 1
