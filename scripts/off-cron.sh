#!/usr/bin/env bash
#
# Open Food Facts maintenance wrapper.
#
#   ./scripts/off-cron.sh          # nightly delta import + counter cleanup
#   ./scripts/off-cron.sh full     # one-off complete dataset import
#   ./scripts/off-cron.sh backfill-languages   # one-off: add localized fields
#   ./scripts/off-cron.sh prune    # counter cleanup only
#
# This is the entry point a panel cron job should call. It exists because cron
# does not give a job the environment an interactive shell has:
#
#   - PATH is minimal, so `node` from nvm is not on it.
#   - .env is not loaded. Prisma's CLI reads it, a plain node script does not,
#     so DATABASE_URL would be missing and the import would fail immediately.
#   - Nothing prevents two slow imports from overlapping.
#
# Run it as the site user, never as root: files it creates must stay writable by
# the user that PM2 and the cron job run as.
#
# Everything below is resolved relative to this file, so the script works from
# any deployment path and from any working directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

# Parse .env instead of sourcing it. Sourcing would execute the file, and real
# values break that immediately: OPEN_FOOD_FACTS_USER_AGENT contains unquoted
# parentheses, which bash reads as a subshell and rejects as a syntax error.
load_env() {
  local file="$1" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"                       # tolerate CRLF
    case "$line" in ''|'#'*) continue ;; esac
    line="${line#export }"
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -z "$key" ] && continue
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$file"
}

load_env "$APP_DIR/.env"

LOG_DIR="${OFF_LOG_DIR:-$HOME/logs}"
LOCK_FILE="${OFF_LOCK_FILE:-$HOME/.ingrefit-off-import.lock}"
mkdir -p "$LOG_DIR"

# Resolve node: an explicit NODE_BIN wins, then the current PATH, then the
# usual nvm and system locations. Failing loudly here beats a silent cron job.
resolve_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
    echo "$NODE_BIN"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  return 1
}

if ! NODE="$(resolve_node)"; then
  echo "[$(date -Is)] FATAL: node not found. Set NODE_BIN in .env to the output of 'command -v node'." \
    | tee -a "$LOG_DIR/off-cron.log" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[$(date -Is)] FATAL: DATABASE_URL is not set. Check .env in $APP_DIR." \
    | tee -a "$LOG_DIR/off-cron.log" >&2
  exit 1
fi

MODE="${1:-delta}"
LOG_FILE="$LOG_DIR/off-$MODE.log"

log() { echo "[$(date -Is)] $*" >> "$LOG_FILE"; }

prune_counters() {
  # Expired rate-limit windows accumulate and nothing else removes them.
  "$NODE" -e '
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    prisma.rateLimitWindow
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .then((r) => console.log(`pruned ${r.count} expired rate-limit rows`))
      .catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
  ' >> "$LOG_FILE" 2>&1
}

case "$MODE" in
  prune)
    log "prune started"
    prune_counters
    log "prune finished"
    ;;
  full|delta|backfill-languages|backfill-countries|backfill-nutrition-basis)
    # A full import or a backfill runs for hours. flock makes an overrun skip
    # the next night rather than start a second pass against the same table.
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
      log "another import is still running, skipping"
      exit 0
    fi
    log "$MODE import started"
    "$NODE" scripts/import-openfoodfacts.mjs "--$MODE" >> "$LOG_FILE" 2>&1
    log "$MODE import finished"
    # Written as an if, not `[ ... ] && ...`: as the final statement of the
    # script the latter returns 1 in full mode under `set -e`, which made a
    # successful import report itself as a failed job.
    if [ "$MODE" = "delta" ]; then
      prune_counters
    fi
    ;;
  *)
    echo "Usage: $0 [delta|full|prune|backfill-languages|backfill-countries|backfill-nutrition-basis]" >&2
    exit 1
    ;;
esac
