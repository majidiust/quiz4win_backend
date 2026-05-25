#!/bin/bash
# Daily backup:
#   1. pg_dump in custom format (-Fc) — restorable with pg_restore.
#   2. gzip and write to /var/backups/quiz4win/.
#   3. Upload to S3-compatible storage (DigitalOcean Spaces) under
#      "$S3_BUCKET/$S3_BACKUP_PREFIX/YYYY-MM-DD/quiz4win-<ts>.dump.gz".
#   4. Run consistency check.
#   5. Prune local + remote backups older than $BACKUP_RETENTION_DAYS.
#
# All output goes to stdout/stderr — when invoked from cron we also
# tee to /var/log/db-maintainer/backup.log so it survives a restart.

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET:?S3_SECRET is required}"

S3_REGION="${S3_REGION:-us-east-1}"
S3_BACKUP_PREFIX="${S3_BACKUP_PREFIX:-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/quiz4win}"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET"
export AWS_DEFAULT_REGION="$S3_REGION"
export AWS_EC2_METADATA_DISABLED=true

log() { printf '[backup] %s\n' "$*"; }

main() {
  mkdir -p "$BACKUP_DIR"
  local stamp date_dir file local_path remote_path
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  date_dir=$(date -u +%F)
  file="quiz4win-${stamp}.dump.gz"
  local_path="$BACKUP_DIR/$file"
  remote_path="s3://$S3_BUCKET/$S3_BACKUP_PREFIX/$date_dir/$file"

  log "running pg_dump → $local_path"
  pg_dump "$SUPABASE_DB_URL" \
      --format=custom \
      --no-owner \
      --no-privileges \
    | gzip -c > "$local_path"
  local size
  size=$(stat -c %s "$local_path")
  log "dump size: $(numfmt --to=iec --suffix=B "$size" 2>/dev/null || echo "$size bytes")"

  if [ "$size" -lt 1024 ]; then
    log "FAIL: dump is suspiciously small (<1 KiB)"
    rm -f "$local_path"
    exit 1
  fi

  log "uploading → $remote_path"
  aws --endpoint-url "$S3_ENDPOINT" s3 cp \
      "$local_path" "$remote_path" \
      --only-show-errors

  log "verifying upload"
  aws --endpoint-url "$S3_ENDPOINT" s3 ls "$remote_path" >/dev/null \
    || { log "FAIL: uploaded object not found"; exit 1; }

  log "running consistency check"
  /opt/db-maintainer/consistency.sh

  log "pruning local backups older than ${BACKUP_RETENTION_DAYS}d"
  find "$BACKUP_DIR" -type f -name '*.dump.gz' \
       -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete || true

  log "pruning remote backups older than ${BACKUP_RETENTION_DAYS}d"
  local cutoff
  cutoff=$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%F 2>/dev/null \
           || date -u -v "-${BACKUP_RETENTION_DAYS}d" +%F)
  # List date-prefixed folders and delete those strictly before the cutoff.
  aws --endpoint-url "$S3_ENDPOINT" s3 ls \
      "s3://$S3_BUCKET/$S3_BACKUP_PREFIX/" \
    | awk '{print $2}' \
    | sed 's:/$::' \
    | while read -r d; do
        case "$d" in
          [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9])
            if [ "$d" \< "$cutoff" ]; then
              log "  delete s3://$S3_BUCKET/$S3_BACKUP_PREFIX/$d/"
              aws --endpoint-url "$S3_ENDPOINT" s3 rm \
                  "s3://$S3_BUCKET/$S3_BACKUP_PREFIX/$d/" \
                  --recursive --only-show-errors || true
            fi
            ;;
        esac
      done

  log "done"
}

main "$@"
