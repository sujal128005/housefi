#!/usr/bin/env bash
# Nightly database backup for the local-db setup (Managed PostgreSQL backs itself up; skip this there).
# Dumps the database, encrypts it with a passphrase (BACKUP_PASSPHRASE), keeps 14 days on the server and, when
# s3cmd is configured for Spaces, copies it to a separate private Space.
#
#   crontab -e  →  30 21 * * *  cd /opt/housefi && deploy/backup.sh >> /var/log/housefi-backup.log 2>&1
#   (21:30 UTC = 03:00 IST)
#
# Restore: gpg -d housefi-YYYYMMDD.sql.gz.gpg | gunzip | docker compose -f deploy/docker-compose.prod.yml \
#   --env-file .env.production exec -T postgres psql -U housefi -d housefi
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE (keep a copy in your password manager)}"
DIR=${BACKUP_DIR:-/var/backups/housefi}
SPACE=${BACKUP_SPACE:-}   # e.g. s3://housefi-backups (a different Space from the uploads one)
mkdir -p "$DIR" && chmod 700 "$DIR"
FILE="$DIR/housefi-$(date -u +%Y%m%d-%H%M).sql.gz.gpg"

docker compose -f deploy/docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U housefi -d housefi --no-owner --format=plain \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" -o "$FILE"
chmod 600 "$FILE"
echo "$(date -u +%FT%TZ) backup written: $FILE ($(du -h "$FILE" | cut -f1))"

if [ -n "$SPACE" ] && command -v s3cmd >/dev/null; then
  s3cmd put --quiet "$FILE" "$SPACE/" && echo "copied to $SPACE"
fi
find "$DIR" -name 'housefi-*.sql.gz.gpg' -mtime +14 -delete
