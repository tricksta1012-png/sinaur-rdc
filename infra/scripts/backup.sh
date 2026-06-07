#!/usr/bin/env bash
# backup.sh — Sauvegarde PostgreSQL SINAUR-RDC
#
# Usage : ./backup.sh [daily|weekly]
# Prérequis : pg_dump accessible, variables d'env configurées
#
# Variables d'environnement requises :
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, PGPASSWORD
#   BACKUP_DIR (défaut: /var/backups/sinaur-rdc)
#   BACKUP_RETENTION_DAILY  (défaut: 7)
#   BACKUP_RETENTION_WEEKLY (défaut: 4)
#   OFFSITE_RSYNC_TARGET    (optionnel: user@host:/path/to/backups)

set -euo pipefail

BACKUP_TYPE="${1:-daily}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sinaur-rdc}"
DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-sinaur_rdc}"
POSTGRES_USER="${POSTGRES_USER:-sinaur}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${POSTGRES_DB}_${BACKUP_TYPE}_${TIMESTAMP}.sql.gz"

mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}"

TARGET_DIR="${DAILY_DIR}"
[[ "${BACKUP_TYPE}" == "weekly" ]] && TARGET_DIR="${WEEKLY_DIR}"

BACKUP_FILE="${TARGET_DIR}/${FILENAME}"

echo "[$(date -Iseconds)] Démarrage backup ${BACKUP_TYPE} → ${BACKUP_FILE}"

pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=custom \
  --compress=9 \
  --no-password \
  | gzip > "${BACKUP_FILE}"

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[$(date -Iseconds)] Backup terminé : ${BACKUP_FILE} (${BACKUP_SIZE})"

# ── Vérification intégrité ────────────────────────────────────────────────────
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "[ERROR] Fichier de backup corrompu : ${BACKUP_FILE}" >&2
  exit 1
fi

# ── Rotation (suppression des anciens backups) ────────────────────────────────
if [[ "${BACKUP_TYPE}" == "daily" ]]; then
  find "${DAILY_DIR}" -name "*.sql.gz" -mtime "+${RETENTION_DAILY}" -delete
  echo "[$(date -Iseconds)] Rotation daily : conservé ${RETENTION_DAILY} jours"
elif [[ "${BACKUP_TYPE}" == "weekly" ]]; then
  # Garder seulement les N plus récents
  ls -t "${WEEKLY_DIR}"/*.sql.gz 2>/dev/null | tail -n "+$((RETENTION_WEEKLY + 1))" | xargs -r rm --
  echo "[$(date -Iseconds)] Rotation weekly : conservé ${RETENTION_WEEKLY} semaines"
fi

# ── Transfert hors-site (optionnel) ──────────────────────────────────────────
if [[ -n "${OFFSITE_RSYNC_TARGET:-}" ]]; then
  echo "[$(date -Iseconds)] Transfert hors-site vers ${OFFSITE_RSYNC_TARGET}..."
  rsync -az --delete "${BACKUP_DIR}/" "${OFFSITE_RSYNC_TARGET}/"
  echo "[$(date -Iseconds)] Transfert hors-site terminé"
fi

echo "[$(date -Iseconds)] Backup ${BACKUP_TYPE} SUCCÈS"
