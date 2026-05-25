#!/bin/bash
# Lightweight DB consistency check.
#
# Verifies:
#   - The database is reachable.
#   - All tables listed in REQUIRED_TABLES exist in public.
#   - RLS is enabled on every public table (R-04 sanity).
#   - schema_migrations contains at least one row.
#
# Exits non-zero on any failure so callers (entrypoint / cron) can react.

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

# Tables the application cannot run without. Kept short on purpose so
# this check is a smoke test, not a full schema diff.
REQUIRED_TABLES=(
  profiles
  games
  game_participants
  game_questions
  game_answers
  questions
  transactions
  withdrawals
  kyc_requests
  user_security
  schema_migrations
)

log() { printf '[consistency] %s\n' "$*"; }
fail() { printf '[consistency] FAIL: %s\n' "$*" >&2; exit 1; }

psql_q() {
  PGOPTIONS="--client-min-messages=warning" \
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -qAtX "$@"
}

main() {
  log "checking connectivity"
  psql_q -c "SELECT 1;" >/dev/null || fail "cannot connect to database"

  log "checking required tables"
  local missing=()
  for t in "${REQUIRED_TABLES[@]}"; do
    local r
    r=$(psql_q -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables
                                  WHERE table_schema='public' AND table_name='$t');")
    [ "$r" = "t" ] || missing+=("$t")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    fail "missing tables: ${missing[*]}"
  fi

  log "checking RLS is enabled on every public table"
  local unsecured
  unsecured=$(psql_q -c "
    SELECT string_agg(c.relname, ', ')
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false;
  ")
  if [ -n "$unsecured" ]; then
    fail "RLS disabled on: $unsecured"
  fi

  log "checking schema_migrations is populated"
  local n
  n=$(psql_q -c "SELECT count(*) FROM public.schema_migrations;")
  [ "$n" -gt 0 ] || fail "schema_migrations is empty — did migrate.sh run?"

  log "OK ($n migration(s) recorded, all required tables present, RLS enforced)"
}

main "$@"
