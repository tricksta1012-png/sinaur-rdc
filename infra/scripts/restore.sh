#!/usr/bin/env bash
# restore.sh — Restauration PostgreSQL SINAUR-RDC depuis un backup
#
# Usage : ./restore.sh <fichier_backup.sql.gz>
# ATTENTION : écrase la base de données existante.
#
# Variables d'environnement requises :
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, PGPASSWORD

set -euo pipefail

BACKUP_FILE="${1:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <fichier_backup.sql.gz>" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[ERROR] Fichier introuvable : ${BACKUP_FILE}" >&2
  exit 1
fi

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-sinaur_rdc}"
POSTGRES_USER="${POSTGRES_USER:-sinaur}"

echo "[$(date -Iseconds)] Restauration de ${BACKUP_FILE} → ${POSTGRES_DB}"
echo ""
read -r -p "ATTENTION : cette opération écrase ${POSTGRES_DB}. Continuer ? [oui/NON] " confirm
if [[ "${confirm}" != "oui" ]]; then
  echo "Annulé."
  exit 0
fi

# Vérifier l'intégrité du fichier
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "[ERROR] Fichier corrompu : ${BACKUP_FILE}" >&2
  exit 1
fi

# Fermer les connexions actives
psql \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname=postgres \
  --no-password \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
  > /dev/null

# Supprimer et recréer la base
psql \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname=postgres \
  --no-password \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};" \
  -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};"

# Restaurer
gunzip -c "${BACKUP_FILE}" | pg_restore \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --no-password \
  --verbose \
  --exit-on-error

echo ""
echo "[$(date -Iseconds)] Restauration SUCCÈS — ${POSTGRES_DB} restauré depuis ${BACKUP_FILE}"
