#!/bin/bash
# scripts/backup.sh — nightly SQLite backup for the SMS automation database.
#
# INSTALL (run once on the VPS as root):
#   cp /opt/sms-backend/scripts/backup.sh /etc/cron.daily/sms-backup
#   chmod +x /etc/cron.daily/sms-backup
#
# Or add to crontab:
#   0 3 * * * bash /opt/sms-backend/scripts/backup.sh >> /var/log/sms-backup.log 2>&1
#
# Keeps 30 days of compressed daily snapshots in /opt/sms-backend/backups/

set -euo pipefail

REMOTE="/opt/sms-backend"
DB_PATH="$REMOTE/data/automation.db"
BACKUP_DIR="$REMOTE/backups"
KEEP_DAYS=30

if [ ! -f "$DB_PATH" ]; then
    echo "[backup] $(date -Iseconds) DB not found at $DB_PATH — skipping"
    exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/automation_$STAMP.db"

# SQLite online backup API — safe while the app is writing (WAL mode).
sqlite3 "$DB_PATH" ".backup '$DEST'"
gzip -f "$DEST"

echo "[backup] $(date -Iseconds) Created $DEST.gz ($(du -sh "$DEST.gz" | cut -f1))"

# Prune old backups beyond KEEP_DAYS.
PRUNED=$(find "$BACKUP_DIR" -name "automation_*.db.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
[ "$PRUNED" -gt 0 ] && echo "[backup] Pruned $PRUNED backup(s) older than $KEEP_DAYS days"

exit 0
