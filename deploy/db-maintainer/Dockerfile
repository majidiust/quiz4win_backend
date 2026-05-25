# Quiz4Win — db-maintainer
#
# Single-purpose container that:
#   1. Applies pending SQL migrations from /migrations on startup.
#   2. Runs a daily pg_dump, gzips it, and uploads to the S3 bucket
#      (DigitalOcean Spaces) under "$S3_BACKUP_PREFIX/YYYY-MM-DD.sql.gz".
#   3. Runs a lightweight consistency check after every migration and
#      every backup.
#   4. Prunes backups older than $BACKUP_RETENTION_DAYS days.
#
# All actions log to stdout/stderr so `docker compose logs db-maintainer`
# shows the full history.

FROM postgres:16-alpine

# postgres:16-alpine ships psql + pg_dump.
# aws-cli (community repo) is used for S3-compatible uploads (Spaces).
# tini gives us PID 1 signal handling so crond exits cleanly on SIGTERM.
RUN apk add --no-cache \
        bash \
        coreutils \
        findutils \
        gzip \
        tini \
        ca-certificates \
        aws-cli

WORKDIR /opt/db-maintainer

COPY entrypoint.sh   /opt/db-maintainer/entrypoint.sh
COPY migrate.sh      /opt/db-maintainer/migrate.sh
COPY backup.sh       /opt/db-maintainer/backup.sh
COPY consistency.sh  /opt/db-maintainer/consistency.sh

RUN chmod +x /opt/db-maintainer/*.sh \
    && mkdir -p /var/backups/quiz4win /var/log/db-maintainer

ENTRYPOINT ["/sbin/tini", "--", "/opt/db-maintainer/entrypoint.sh"]
