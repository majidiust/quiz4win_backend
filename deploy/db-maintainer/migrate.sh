#!/bin/bash
# Apply pending SQL migrations from /migrations against $SUPABASE_DB_URL.
#
# Tracking table:  public.schema_migrations(version text primary key,
#                                           checksum text not null,
#                                           applied_at timestamptz default now())
#
# Bootstrap rule: on first run, if the tracking table doesn't exist BUT
# the database already has the canonical tables (public.profiles), we
# assume migrations were applied previously via Supabase Studio. We
# create the tracking table and mark every file currently on disk as
# applied without executing it. Subsequent deploys then only run files
# that arrived in this commit.
#
# Each migration is applied inside a single transaction. On failure the
# script exits non-zero so docker compose surfaces the error and the
# api container can be held back.

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

log() { printf '[migrate] %s\n' "$*"; }

psql_q() {
  PGOPTIONS="--client-min-messages=warning" \
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -qAtX "$@"
}

ensure_tracking_table() {
  # R-04: RLS is enabled with no policies so PostgREST clients (anon /
  # authenticated / service_role through the API) cannot read or write
  # the table. The db-maintainer connects as the postgres role which
  # bypasses RLS, so this script keeps full access.
  psql_q -c "
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version     text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.schema_migrations FROM anon, authenticated;
  " >/dev/null
}

# Returns 't' if a table already exists in the public schema.
table_exists() {
  psql_q -c "SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='$1'
  );"
}

is_applied() {
  local v="$1"
  local n
  n=$(psql_q -c "SELECT 1 FROM public.schema_migrations WHERE version='$v' LIMIT 1;")
  [ "$n" = "1" ]
}

checksum() { sha256sum "$1" | awk '{print $1}'; }

mark_applied() {
  local v="$1" c="$2"
  psql_q -c "INSERT INTO public.schema_migrations(version, checksum)
             VALUES ('$v', '$c')
             ON CONFLICT (version) DO UPDATE SET checksum=EXCLUDED.checksum;" >/dev/null
}

apply_file() {
  local f="$1" v c
  v=$(basename "$f" .sql)
  c=$(checksum "$f")
  log "applying $v"
  # Single transaction: run the file, then record the version. If any
  # statement fails psql exits non-zero and the surrounding BEGIN/COMMIT
  # never commits because ON_ERROR_STOP rolls everything back.
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -f "$f" >/dev/null
  mark_applied "$v" "$c"
}

main() {
  log "connecting to database"
  psql_q -c "SELECT 1;" >/dev/null

  ensure_tracking_table

  shopt -s nullglob
  local files=("$MIGRATIONS_DIR"/*.sql)
  shopt -u nullglob
  if [ ${#files[@]} -eq 0 ]; then
    log "no migration files under $MIGRATIONS_DIR — nothing to do"
    return 0
  fi

  # Sort by filename (timestamp prefix gives deterministic order).
  IFS=$'\n' files=($(printf '%s\n' "${files[@]}" | sort))
  unset IFS

  local applied_count
  applied_count=$(psql_q -c "SELECT count(*) FROM public.schema_migrations;")
  if [ "$applied_count" = "0" ] && [ "$(table_exists profiles)" = "t" ]; then
    log "first run on a populated database — marking ${#files[@]} files as already applied"
    for f in "${files[@]}"; do
      mark_applied "$(basename "$f" .sql)" "$(checksum "$f")"
    done
    log "bootstrap complete"
    return 0
  fi

  local pending=0
  for f in "${files[@]}"; do
    v=$(basename "$f" .sql)
    if is_applied "$v"; then
      continue
    fi
    apply_file "$f"
    pending=$((pending + 1))
  done

  if [ "$pending" -eq 0 ]; then
    log "database is up to date (${#files[@]} migration(s) on record)"
  else
    log "applied $pending new migration(s)"
  fi
}

main "$@"
