#!/usr/bin/env bash
# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0
#
# Run the installer's backend (FastAPI) and frontend (Vite) as separate
# web services instead of inside the Tauri webview. Lets you drive the
# wizard from any external browser — useful for headless boxes, remote
# work over Tailscale, and Playwright/MCP-driven sessions for
# screenshot capture and end-to-end UI tests.
#
# Usage:
#   ./scripts/dev-services.sh             # foreground; Ctrl+C stops both
#   ./scripts/dev-services.sh --no-wait   # start and exit (PIDs in /tmp)
#   ./scripts/dev-services.sh stop        # kill any running instances
#
# Logs (tail with -f to watch live):
#   /tmp/thinkube-installer-backend.log
#   /tmp/thinkube-installer-frontend.log
#
# Notes:
#   - Tauri-only frontend code paths (configFlags via invoke()) fail
#     gracefully in pure-browser mode and default to feature flags off.
#   - To pass TK_TEST=1 etc., export them before invoking this script.
#   - First-time-only: the backend's venv-test is created by tauri:dev;
#     if it doesn't exist, this script bootstraps it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/frontend/src-tauri/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv-test"

BACKEND_LOG="/tmp/thinkube-installer-backend.log"
FRONTEND_LOG="/tmp/thinkube-installer-frontend.log"
BACKEND_PID_FILE="/tmp/thinkube-installer-backend.pid"
FRONTEND_PID_FILE="/tmp/thinkube-installer-frontend.pid"

BACKEND_PORT=8000
FRONTEND_PORT=5173

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { printf "${GREEN}[dev-services]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[dev-services]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[dev-services]${NC} %s\n" "$*" >&2; }

stop_pid_file() {
  local pidfile="$1" name="$2"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      # Give it a moment, then force.
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

stop_by_port() {
  local port="$1" name="$2"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "Stopping stray $name on port $port (pids $pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

cmd_stop() {
  stop_pid_file "$BACKEND_PID_FILE" backend
  stop_pid_file "$FRONTEND_PID_FILE" frontend
  stop_by_port "$BACKEND_PORT" backend
  stop_by_port "$FRONTEND_PORT" frontend
  log "Stopped."
}

if [ "${1:-}" = "stop" ]; then
  cmd_stop
  exit 0
fi

NO_WAIT=0
if [ "${1:-}" = "--no-wait" ]; then NO_WAIT=1; fi

# Refuse to start a second copy on top of an existing one.
if lsof -ti tcp:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  err "Port $BACKEND_PORT is already in use. Run \`$0 stop\` first."
  exit 1
fi
if lsof -ti tcp:"$FRONTEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  err "Port $FRONTEND_PORT is already in use. Run \`$0 stop\` first."
  exit 1
fi

# Bootstrap backend venv if it's missing (matches what tauri:dev would do).
if [ ! -d "$VENV_DIR" ]; then
  log "Bootstrapping backend venv-test (one-time)…"
  python3 -m venv "$VENV_DIR"
  # shellcheck source=/dev/null
  source "$VENV_DIR/bin/activate"
  pip install --upgrade pip >/dev/null
  pip install -r "$BACKEND_DIR/requirements.txt"
  deactivate
fi

# Frontend node_modules sanity-check.
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  log "Installing frontend npm dependencies (one-time)…"
  (cd "$FRONTEND_DIR" && npm install)
fi

log "Starting backend on http://localhost:$BACKEND_PORT (log: $BACKEND_LOG)"
(
  cd "$BACKEND_DIR"
  # shellcheck source=/dev/null
  source "$VENV_DIR/bin/activate"
  exec python main.py --reload
) >"$BACKEND_LOG" 2>&1 &
echo $! > "$BACKEND_PID_FILE"

log "Starting frontend on http://localhost:$FRONTEND_PORT (log: $FRONTEND_LOG)"
(
  cd "$FRONTEND_DIR"
  exec npm run dev
) >"$FRONTEND_LOG" 2>&1 &
echo $! > "$FRONTEND_PID_FILE"

# Wait for both to start serving.
wait_for_http() {
  local url="$1" label="$2"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 1 "$url"; then
      log "$label is up: $url"
      return 0
    fi
    sleep 1
  done
  warn "$label did not become ready in 60s — check its log."
  return 1
}

wait_for_http "http://localhost:$BACKEND_PORT/docs"  backend  || true
wait_for_http "http://localhost:$FRONTEND_PORT/"     frontend || true

cat <<EOF

  Installer is now running as plain web services.

    Frontend (drive the wizard here): http://localhost:$FRONTEND_PORT
    Backend API docs:                 http://localhost:$BACKEND_PORT/docs

  Live logs:
    tail -f $BACKEND_LOG
    tail -f $FRONTEND_LOG

  Stop:
    $0 stop

EOF

if [ "$NO_WAIT" -eq 1 ]; then
  exit 0
fi

# Foreground mode: keep the script alive and forward Ctrl+C to children.
trap 'echo; cmd_stop; exit 0' INT TERM
log "Press Ctrl+C to stop both services."
# Wait on either child; if one dies, stop the other and exit.
while kill -0 "$(cat "$BACKEND_PID_FILE" 2>/dev/null || echo 0)" 2>/dev/null \
   && kill -0 "$(cat "$FRONTEND_PID_FILE" 2>/dev/null || echo 0)" 2>/dev/null; do
  sleep 2
done
warn "One of the services exited. Stopping the other and cleaning up."
cmd_stop
exit 1
