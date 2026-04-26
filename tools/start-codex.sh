#!/usr/bin/env bash
# Start the OpenClaw (Codex) gateway only. Idempotent.
# Called from start-codex.ps1 (Windows) or directly (WSL).
set -u

UNIT=openclaw-gateway
PORT=18789
CFG=/home/cbkjh/.openclaw/openclaw.json
HTTP_BUDGET=75
CHAT_BUDGET=150

state=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
echo "  systemd state: $state"

if [ "$state" = "" ]; then
  echo "[FAIL] systemd unit '$UNIT' not installed."
  echo "  Install openclaw and run: systemctl --user enable --now $UNIT"
  exit 2
fi

if [ "$state" != "active" ]; then
  echo "  starting $UNIT (cold start ~60s for acpx runtime) ..."
  if ! systemctl --user start "$UNIT"; then
    echo "[FAIL] systemctl start failed."
    echo "  Check: journalctl --user -u $UNIT -n 50 --no-pager"
    exit 2
  fi
fi

# Read token from project .env. We avoid `node -e` because the WSL PATH may
# resolve `node` to a Windows shim (/mnt/c/.../npm/node) that fails silently
# under WSL — empty TOKEN → 401 from gateway with no obvious diagnostic.
ENV_FILE="$(dirname "$0")/../.env"
if [ ! -r "$ENV_FILE" ]; then
  echo "[FAIL] .env not readable: $ENV_FILE"
  exit 2
fi
TOKEN=$(grep -E '^\s*OPENCLAW_GATEWAY_TOKEN\s*=' "$ENV_FILE" | head -1 | sed -E 's/^\s*OPENCLAW_GATEWAY_TOKEN\s*=\s*//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then
  echo "[FAIL] OPENCLAW_GATEWAY_TOKEN missing in $ENV_FILE"
  exit 2
fi

# Phase 1 — wait for HTTP server to bind. Acpx may still be loading.
echo "  probing http://127.0.0.1:$PORT/v1/models (HTTP server up?, up to ${HTTP_BUDGET}s) ..."
deadline=$(( $(date +%s) + HTTP_BUDGET ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 \
    -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:$PORT/v1/models" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then break; fi
  sleep 2
done
if [ "$code" != "200" ]; then
  echo "[FAIL] no 200 from /v1/models within ${HTTP_BUDGET}s (last code=$code)"
  echo "  Check: journalctl --user -u $UNIT -n 80 --no-pager"
  exit 2
fi

# Phase 2 — probe a real chat ping until 200 (= acpx channel connected).
# Cold-start observed: ~57s from HTTP-up to acpx-ready, plus first-call latency.
echo "  waiting for acpx runtime (chat completions live, up to ${CHAT_BUDGET}s) ..."
deadline=$(( $(date +%s) + CHAT_BUDGET ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"model":"openclaw/default","messages":[{"role":"user","content":"ping"}],"stream":false}' \
    "http://127.0.0.1:$PORT/v1/chat/completions" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "[OK] OpenClaw ready (chat verified): http://localhost:$PORT"
    exit 0
  fi
  sleep 2
done
echo "[FAIL] /v1/chat/completions not 200 within ${CHAT_BUDGET}s (last code=$code)"
echo "  acpx runtime failed to register. Check: journalctl --user -u $UNIT -n 80 --no-pager"
exit 2
