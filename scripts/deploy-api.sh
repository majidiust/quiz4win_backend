#!/usr/bin/env bash
# deploy-api.sh — R-11.3-compliant api container deploy
#
# Enforces .env byte hygiene and always force-recreates the api container
# so that environment variables are re-read from the current .env.
#
# Usage: bash scripts/deploy-api.sh [--build]
#   --build  also rebuild the Docker image (needed after source changes)
#
# Rule compliance:
#   R-11.1  untouched (no auth source edits)
#   R-11.2  untouched (no docker-compose.yml Redis line edits)
#   R-11.3  ENFORCED: strips CRLF, validates key length, force-recreates
#
# This script MUST be used instead of "docker restart" or
# "docker compose restart api".  Restarting without force-recreate
# preserves the old environment and causes "Invalid API key" at signin.

set -euo pipefail

ENV_FILE=".env"
BUILD_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --build) BUILD_FLAG="--build" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "=== [R-11.3] .env byte hygiene check ==="

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Strip CRLF in-place (safe for LF-only files)
if file "$ENV_FILE" | grep -qi "CRLF"; then
  echo "  CRLF detected — stripping..."
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' $'s/\r$//' "$ENV_FILE"
  else
    sed -i 's/\r$//' "$ENV_FILE"
  fi
  echo "  Stripped. .env is now LF-only."
else
  echo "  No CRLF found — .env is clean."
fi

# Validate SUPABASE_ANON_KEY length (metadata only, no value printed)
KEY_LEN=$(awk -F= '/^SUPABASE_ANON_KEY=/{print length($2); exit}' "$ENV_FILE")
if [ -z "$KEY_LEN" ] || [ "$KEY_LEN" -lt 100 ]; then
  echo "ERROR: SUPABASE_ANON_KEY is absent or suspiciously short (len=$KEY_LEN)." >&2
  echo "       Check .env before deploying." >&2
  exit 1
fi
echo "  SUPABASE_ANON_KEY length in .env: $KEY_LEN (looks good)"

# Check if container is already running and compare key lengths
CONTAINER_LEN=$(docker compose exec -T api printenv SUPABASE_ANON_KEY 2>/dev/null | tr -d '\n' | wc -c | tr -d ' ' || echo "0")
if [ "$CONTAINER_LEN" -gt 0 ]; then
  if [ "$CONTAINER_LEN" -ne "$KEY_LEN" ]; then
    echo "  WARNING: Container key length ($CONTAINER_LEN) != .env length ($KEY_LEN)."
    echo "           This IS the 'Invalid API key' root cause. Force-recreating..."
  else
    echo "  Container key length matches .env ($KEY_LEN). Recreating anyway to stay fresh."
  fi
else
  echo "  Container not running (or no exec access). Will start fresh."
fi

echo ""
echo "=== Deploying api (--force-recreate) ==="
# shellcheck disable=SC2086
docker compose up -d --force-recreate $BUILD_FLAG api

echo ""
echo "=== Post-deploy verification ==="
sleep 3
NEW_CONTAINER_LEN=$(docker compose exec -T api printenv SUPABASE_ANON_KEY 2>/dev/null | tr -d '\n' | wc -c | tr -d ' ' || echo "0")
if [ "$NEW_CONTAINER_LEN" -eq "$KEY_LEN" ]; then
  echo "  OK: Container key length ($NEW_CONTAINER_LEN) matches .env ($KEY_LEN)."
  echo "  Deploy complete. 'Invalid API key' from stale env is resolved."
else
  echo "  ERROR: Container key length ($NEW_CONTAINER_LEN) still != .env ($KEY_LEN)." >&2
  echo "  Check for host-exported SUPABASE_ANON_KEY overriding .env:" >&2
  echo "    printenv SUPABASE_ANON_KEY" >&2
  echo "  If set, run: unset SUPABASE_ANON_KEY && bash scripts/deploy-api.sh" >&2
  exit 1
fi
