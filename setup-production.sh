#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-3035}"
DB_DIR="${EXAM_DB_DIR:-/var/lib/vp-exams}"
ENV_FILE="$ROOT_DIR/.env.local"
ENV_BACKUP="$ROOT_DIR/.env.local.setup-backup"
PID_FILE="$ROOT_DIR/.next-production.pid"
LOG_FILE="$ROOT_DIR/production.log"
SERVER_PID=""
SETUP_STARTED="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
CURRENT_STEP="initialization"
SETUP_SUCCEEDED=false

: >> "$LOG_FILE"
chmod 600 "$LOG_FILE"

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '[%s] [INFO] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE"; }
warn() { printf '[%s] [WARN] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE" >&2; }
fail() { printf '[%s] [ERROR] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE" >&2; }

on_error() {
  local exit_code=$?
  local line_number="${1:-unknown}"
  fail "Setup failed during '$CURRENT_STEP' at line $line_number (exit code $exit_code)."
  fail "Review detailed logs: $LOG_FILE"
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    warn "Stopping the newly started Next.js process after setup failure (PID $SERVER_PID)."
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}

on_exit() {
  local exit_code=$?
  if [[ "$SETUP_SUCCEEDED" == true ]]; then
    log "Setup completed successfully at $(timestamp)."
  elif [[ $exit_code -ne 0 ]]; then
    fail "Setup did not complete successfully. The failure occurred during '$CURRENT_STEP'."
  fi
}
trap 'on_error "$LINENO"' ERR
trap on_exit EXIT

run_step() {
  CURRENT_STEP="$1"
  shift
  log "Starting step: $CURRENT_STEP"
  if "$@" >> "$LOG_FILE" 2>&1; then
    log "Completed step: $CURRENT_STEP"
  else
    local exit_code=$?
    fail "Step '$CURRENT_STEP' failed with exit code $exit_code."
    return "$exit_code"
  fi
}

log "Production setup started at $SETUP_STARTED"
log "Project directory: $ROOT_DIR"

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  fail "This script must not be run as root. Run it as the dedicated server account."
  exit 1
fi

CURRENT_STEP="dependency checks"
for required_command in node npm curl sudo; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    fail "Required command is unavailable: $required_command"
    exit 1
  fi
  log "Found $required_command at $(command -v "$required_command")"
done

log "Node.js: $(node --version)"
log "npm: $(npm --version)"

read -r -p "Production port [${PORT}]: " INPUT_PORT
PORT="${INPUT_PORT:-$PORT}"
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535)); then
  fail "Invalid production port: $PORT"
  exit 1
fi
log "Selected production port: $PORT"

read -r -p "SQLite database directory [${DB_DIR}]: " INPUT_DB_DIR
DB_DIR="${INPUT_DB_DIR:-$DB_DIR}"
DB_PATH="$DB_DIR/exams.db"
log "Selected SQLite database: $DB_PATH"

CURRENT_STEP="SQLite directory setup"
if [[ ! -d "$DB_DIR" ]]; then
  log "SQLite directory does not exist; requesting ownership setup with sudo."
  if ! sudo -n mkdir -p "$DB_DIR" >> "$LOG_FILE" 2>&1; then
    read -r -p "sudo credentials are required. Press Enter to continue, or Ctrl+C to cancel: "
    sudo mkdir -p "$DB_DIR"
  fi
  sudo -n chown "$(id -u):$(id -g)" "$DB_DIR" >> "$LOG_FILE" 2>&1 || sudo chown "$(id -u):$(id -g)" "$DB_DIR"
fi

mkdir -p "$DB_DIR"
if [[ ! -w "$DB_DIR" ]]; then
  fail "SQLite directory is not writable: $DB_DIR"
  exit 1
fi

CHECK_FILE="$DB_DIR/.setup-write-check-$$"
if ! (umask 077; : > "$CHECK_FILE") 2>/dev/null; then
  fail "Could not write a test file to SQLite directory: $DB_DIR"
  exit 1
fi
rm -f "$CHECK_FILE"
log "SQLite directory is present and writable."

CURRENT_STEP="environment configuration"
if [[ -f "$ENV_FILE" ]]; then
  cp -p "$ENV_FILE" "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
  log "Existing environment file backed up to $ENV_BACKUP (Azure credentials are never copied to logs)."

  TEMP_ENV="$(mktemp "$ROOT_DIR/.env.local.XXXXXX")"
  awk -v db_path="$DB_PATH" '
    /^EXAM_DB_PATH=/ { if (!updated) { print "EXAM_DB_PATH=" db_path; updated=1 } next }
    { print }
    END { if (!updated) print "EXAM_DB_PATH=" db_path }
  ' "$ENV_FILE" > "$TEMP_ENV"
  chmod 600 "$TEMP_ENV"
  mv -f "$TEMP_ENV" "$ENV_FILE"
else
  printf 'EXAM_DB_PATH=%s\n' "$DB_PATH" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Created new environment file: $ENV_FILE"
fi
export EXAM_DB_PATH="$DB_PATH"
log "EXAM_DB_PATH set for this setup process."

run_step "dependency installation" npm ci
run_step "database migration tests" npm run db:test
run_step "authentication tests" npm run auth:test
run_step "batch validation tests" npm run batch:test
run_step "SQLite metadata migration" npm run db:migrate
run_step "Azure legacy blob migration" npm run db:migrate-blobs
run_step "production build" npm run build

CURRENT_STEP="old server shutdown"
PID_FILE_DATA=""
if [[ -f "$PID_FILE" ]]; then
  PID_FILE_DATA="$(cat "$PID_FILE" 2>/dev/null || true)"
fi
if [[ "$PID_FILE_DATA" =~ ^[0-9]+$ ]] && kill -0 "$PID_FILE_DATA" 2>/dev/null; then
  log "Stopping previous managed Next.js server (PID $PID_FILE_DATA)."
  kill "$PID_FILE_DATA" 2>/dev/null || true
  for _ in {1..40}; do
    if ! kill -0 "$PID_FILE_DATA" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  if kill -0 "$PID_FILE_DATA" 2>/dev/null; then
    warn "Previous server did not stop within 10 seconds; sending SIGTERM again."
    kill -TERM "$PID_FILE_DATA" 2>/dev/null || true
  fi
else
  log "No live server was found in the production PID file."
fi

CURRENT_STEP="production server startup"
log "Starting Next.js in production mode on 0.0.0.0:$PORT."
setsid env EXAM_DB_PATH="$DB_PATH" NODE_ENV=production npm run start -- -H 0.0.0.0 -p "$PORT" >> "$LOG_FILE" 2>&1 < /dev/null &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" > "$PID_FILE"
chmod 600 "$PID_FILE"
log "Started Next.js process PID $SERVER_PID."

HEALTHY=false
for attempt in $(seq 1 40); do
  if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$PORT/api/server-time" >/dev/null 2>&1; then
    HEALTHY=true
    log "Health check passed on attempt $attempt/40 (http://127.0.0.1:$PORT/api/server-time)."
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "Next.js exited before becoming healthy. PID $SERVER_PID."
    fail "Review the production server output in $LOG_FILE."
    exit 1
  fi
  if (( attempt % 10 == 0 )); then
    log "Waiting for Next.js health check; attempt $attempt/40."
  fi
  sleep 0.25
done

if [[ "$HEALTHY" != true ]]; then
  fail "Next.js did not pass its health check after 40 attempts."
  fail "Review the production server output in $LOG_FILE."
  exit 1
fi

log "Production server is healthy."
log "SQLite database: $DB_PATH"
log "Application log: $LOG_FILE"

CURRENT_STEP="super-admin bootstrap"
read -r -p "Create or reset a super admin now? [Y/n]: " CREATE_ADMIN
CREATE_ADMIN="${CREATE_ADMIN:-Y}"
if [[ "$CREATE_ADMIN" =~ ^[Yy]$ ]]; then
  log "Starting interactive super-admin creation or password reset."
  if ! env EXAM_DB_PATH="$DB_PATH" npm run auth:bootstrap-admin 2>&1 | tee -a "$LOG_FILE"; then
    fail "Super-admin bootstrap failed. The production server is still running."
    exit 1
  fi
  log "Super-admin bootstrap completed successfully."
else
  log "Super-admin bootstrap skipped by the operator."
fi

SETUP_SUCCEEDED=true
log "Setup summary:"
log "  Production URL: http://localhost:$PORT"
log "  Admin URL: http://localhost:$PORT/admin"
log "  SQLite database: $DB_PATH"
log "  Server PID: $SERVER_PID"
log "  Server log: $LOG_FILE"
printf '\nSetup complete. Open http://localhost:%s/admin\n' "$PORT"
