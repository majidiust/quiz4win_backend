#!/bin/bash
# Container entrypoint.
#
# Sequence:
#   1. Wait briefly for the network to be ready.
#   2. Apply pending migrations.
#   3. Run an initial consistency check.
#   4. Run an initial backup if RUN_BACKUP_ON_START=true (default false).
#   5. Install the cron job and exec crond in the foreground so the
#      container stays alive and logs are streamed.
#
# Failure of step 2 or 3 aborts startup (non-zero exit) so docker
# compose marks the service unhealthy / restarts according to policy.

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"   # daily at 02:00 UTC
RUN_BACKUP_ON_START="${RUN_BACKUP_ON_START:-false}"

log() { printf '[entrypoint] %s\n' "$*"; }

log "db-maintainer starting"
log "migrations dir: ${MIGRATIONS_DIR:-/migrations}"
log "backup schedule: $BACKUP_SCHEDULE (UTC)"

# Step 1: pre-flight connectivity check.
#
# Supabase's direct connection host (db.<project>.supabase.co) resolves
# only to IPv6, and the default docker bridge network has no IPv6 route
# → psql fails with "Network unreachable" and the container restart-
# loops forever. Detect that up-front and print actionable guidance
# instead of letting the restart policy mask the real problem.
DB_HOST="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^[a-z]+://[^@]*@([^:/?]+).*|\1|')"
log "resolving database host: $DB_HOST"
if ! getent ahostsv4 "$DB_HOST" >/dev/null 2>&1; then
  log "ERROR: '$DB_HOST' has no IPv4 address."
  log "       The docker bridge network is IPv4-only — direct Supabase"
  log "       hosts (db.<project>.supabase.co) are IPv6-only and will"
  log "       not work here."
  log "       Switch SUPABASE_DB_URL to the **Session Pooler** URL:"
  log "         Supabase dashboard → Project Settings → Database →"
  log "         Connection string → 'Session pooler' (port 5432)."
  log "       Username format is: postgres.<project-ref>"
  exit 2
fi

# Step 2: migrations.
/opt/db-maintainer/migrate.sh

# Step 3: post-migration consistency check.
/opt/db-maintainer/consistency.sh

# Signal readiness — the api service uses this via a healthcheck so it
# doesn't boot until migrations + consistency check succeed.
touch /tmp/db-maintainer-ready
log "readiness flag written"

# Step 4: optional initial backup.
if [ "$RUN_BACKUP_ON_START" = "true" ]; then
  log "RUN_BACKUP_ON_START=true → running initial backup"
  /opt/db-maintainer/backup.sh
fi

# Step 5: install cron job and start crond.
#
# busybox crond reads /var/spool/cron/crontabs/root and writes logs
# to syslog by default; -L /dev/stdout forces logs to stdout so they
# appear in `docker compose logs`.
#
# We snapshot the current environment into /etc/profile.d/env.sh and
# source it from the cron command line so the daily job sees the
# SUPABASE_DB_URL / S3_* variables that docker-compose injected here
# (cron strips the parent environment otherwise).
ENV_FILE=/etc/profile.d/db-maintainer-env.sh
{
  echo "#!/bin/sh"
  # Use `env -0` and quote each value so newlines/spaces survive.
  env | while IFS='=' read -r k v; do
    case "$k" in
      SUPABASE_DB_URL|S3_*|BACKUP_*|MIGRATIONS_DIR|PATH|TZ)
        printf 'export %s=%q\n' "$k" "$v"
        ;;
    esac
  done
} > "$ENV_FILE"
chmod 0600 "$ENV_FILE"

mkdir -p /var/spool/cron/crontabs /var/log/db-maintainer
# Pre-create the cron log so `tail -F` below doesn't print an error on
# first start (busybox tail emits "cannot open ... No such file" even
# with -F when the file is missing at startup).
touch /var/log/db-maintainer/backup.log
cat > /var/spool/cron/crontabs/root <<EOF
# Quiz4Win — daily database backup
$BACKUP_SCHEDULE . $ENV_FILE; /opt/db-maintainer/backup.sh >> /var/log/db-maintainer/backup.log 2>&1
EOF
chmod 0600 /var/spool/cron/crontabs/root

log "starting crond (foreground, logging to stdout)"
# `tail -F` streams the cron log so it shows up in docker logs.
tail -n0 -F /var/log/db-maintainer/backup.log &
exec crond -f -l 8 -L /dev/stdout
