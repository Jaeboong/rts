#!/usr/bin/env bash
# Start the Nanoclaw (Claude) bridge only. Idempotent.
# Called from start-claude.ps1 (Windows) or directly (WSL).
set -u

UNIT=nanoclaw
PORT=4500
ENVFILE=/home/cbkjh/project/nanoclaw/.env
PROJECT=/home/cbkjh/project/nanoclaw
TIMEOUT=30

# Nanoclaw spawns Docker per request — without daemon, requests hang/fail.
# Try to auto-start: rootless first (no sudo), then sudo service. If sudo needs
# a password, -n makes it fail fast instead of hanging.
if ! docker info >/dev/null 2>&1; then
  echo "  docker daemon not running, attempting to start ..."
  started=0
  if systemctl --user start docker 2>/dev/null; then started=1
  elif sudo -n service docker start 2>/dev/null; then started=1
  fi
  if [ "$started" = "0" ]; then
    echo "[FAIL] could not auto-start docker (sudo needs password, or docker not installed)."
    echo "  Run manually in WSL: sudo service docker start"
    exit 2
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! docker info >/dev/null 2>&1; then
    echo "[FAIL] docker started but daemon still not responding after 10s"
    exit 2
  fi
  echo "  docker daemon started"
fi

state=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
echo "  systemd state: $state"

if [ "$state" = "" ]; then
  echo "[FAIL] systemd unit '$UNIT' not installed."
  echo "  Fix: cd $PROJECT && npm run setup"
  exit 2
fi

if [ "$state" != "active" ]; then
  echo "  starting $UNIT ..."
  if ! systemctl --user start "$UNIT"; then
    echo "[FAIL] systemctl start failed."
    echo "  Check: journalctl --user -u $UNIT -n 50 --no-pager"
    exit 2
  fi
fi

echo "  probing http://127.0.0.1:$PORT (expect 401 = bound, up to ${TIMEOUT}s) ..."
deadline=$(( $(date +%s) + TIMEOUT ))
code=000
while [ "$(date +%s)" -lt "$deadline" ]; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 \
    -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT/api/agent-message" 2>/dev/null || echo 000)
  if [ "$code" = "401" ]; then break; fi
  sleep 1
done

if [ "$code" != "401" ]; then
  echo "[FAIL] no 401 on port $PORT within ${TIMEOUT}s (last code=$code)"
  echo "  Check: journalctl --user -u $UNIT -n 50 --no-pager"
  exit 2
fi

if [ ! -r "$ENVFILE" ]; then
  echo "[FAIL] env file not readable: $ENVFILE"
  exit 2
fi
TOKEN=$(grep -E '^\s*NANOCLAW_HTTP_TOKEN\s*=' "$ENVFILE" | head -1 | sed -E 's/^\s*NANOCLAW_HTTP_TOKEN\s*=\s*//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then
  echo "[FAIL] server up but NANOCLAW_HTTP_TOKEN missing in $ENVFILE"
  echo "  The game cannot authenticate without it."
  exit 2
fi

echo "[OK] Nanoclaw ready: http://localhost:$PORT"
exit 0
