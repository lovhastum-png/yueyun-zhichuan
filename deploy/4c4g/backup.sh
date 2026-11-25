#!/usr/bin/env bash
# ============================================================
# 越韵智传 · 备份脚本（数据库 + 用户产物）
# ------------------------------------------------------------
# 用法：
#   sudo bash deploy/4c4g/backup.sh              # 备份到 /var/backups/yueyun
#   BACKUP_DIR=/data/bak KEEP=14 sudo -E bash deploy/4c4g/backup.sh
#
# 建议加入 crontab（每天凌晨 3 点）：
#   0 3 * * * /bin/bash /opt/yueyun/deploy/4c4g/backup.sh >> /var/log/yueyun-backup.log 2>&1
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/yueyun}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/yueyun}"
KEEP="${KEEP:-7}"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

ENV_FILE="$APP_DIR/.env"
[[ -f "$ENV_FILE" ]] || { echo "找不到 $ENV_FILE" >&2; exit 1; }

DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
DB_NAME="${DB_NAME:-yueyun_db}"

echo "[1/3] 导出数据库 $DB_NAME …"
mysqldump --protocol=socket -uroot \
  --single-transaction --quick --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[2/3] 打包用户产物（上传文件 / 课程 PDF）…"
tar -czf "$BACKUP_DIR/files-$STAMP.tar.gz" \
  -C "$APP_DIR" \
  --exclude='uploads/tmp/*' \
  uploads data/course-pdf 2>/dev/null || echo "  （无可打包目录，跳过）"

echo "[3/3] 清理超过 $KEEP 份的历史备份 …"
ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/files-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "完成，备份目录：$BACKUP_DIR"
du -sh "$BACKUP_DIR"
