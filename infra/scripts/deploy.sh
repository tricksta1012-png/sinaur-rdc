#!/usr/bin/env bash
# deploy.sh — Déploiement zéro-interruption SINAUR-RDC
#
# Usage : IMAGE_TAG=v1.2.0 ./deploy.sh [--dry-run]
#
# Variables requises :
#   IMAGE_TAG       — tag à déployer (ex: v1.2.0 ou sha-abc1234)
#   REGISTRY        — registry Docker (défaut: ghcr.io)
#   IMAGE_OWNER     — propriétaire de l'image (défaut: sinaur-rdc)
#   COMPOSE_FILE    — fichier compose à utiliser (défaut: docker-compose.prod.yml)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMAGE_TAG="${IMAGE_TAG:-}"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_OWNER="${IMAGE_OWNER:-sinaur-rdc}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.prod.yml}"

if [[ -z "${IMAGE_TAG}" ]]; then
  echo "[ERROR] IMAGE_TAG est requis. Ex: IMAGE_TAG=v1.2.0 ./deploy.sh" >&2
  exit 1
fi

log() { echo "[$(date -Iseconds)] $*"; }

log "Déploiement SINAUR-RDC ${IMAGE_TAG}"
log "Registry : ${REGISTRY}/${IMAGE_OWNER}"
log "Compose  : ${COMPOSE_FILE}"
$DRY_RUN && log "MODE DRY-RUN — aucune modification appliquée"

SERVICES=(api sync-gateway alerting ussd ai-prediction ingestion command-center public)

# ── 1. Pré-télécharger les nouvelles images ───────────────────────────────────
log "Étape 1/5 : téléchargement des images..."
for svc in "${SERVICES[@]}"; do
  IMAGE="${REGISTRY}/${IMAGE_OWNER}/sinaur-rdc-${svc}:${IMAGE_TAG}"
  if $DRY_RUN; then
    log "  [dry-run] docker pull ${IMAGE}"
  else
    log "  Pulling ${IMAGE}..."
    docker pull "${IMAGE}" || log "  ⚠ Image non trouvée pour ${svc}, skip"
  fi
done

# ── 2. Backup avant déploiement ───────────────────────────────────────────────
log "Étape 2/5 : backup pré-déploiement..."
if $DRY_RUN; then
  log "  [dry-run] ${SCRIPT_DIR}/backup.sh pre-deploy"
else
  BACKUP_TYPE=pre-deploy "${SCRIPT_DIR}/backup.sh" daily || log "⚠ Backup échoué, poursuite quand même"
fi

# ── 3. Mise à jour service par service ────────────────────────────────────────
log "Étape 3/5 : mise à jour des services..."

COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"
export IMAGE_TAG REGISTRY IMAGE_OWNER

for svc in "${SERVICES[@]}"; do
  log "  Mise à jour ${svc}..."
  if $DRY_RUN; then
    log "  [dry-run] ${COMPOSE_CMD} up -d --no-deps ${svc}"
  else
    ${COMPOSE_CMD} up -d --no-deps "${svc}"
    # Attendre que le service soit sain (max 60s)
    WAITED=0
    while [[ $WAITED -lt 60 ]]; do
      STATUS=$(docker inspect --format='{{.State.Health.Status}}' "sinaur-${svc}" 2>/dev/null || echo "none")
      if [[ "${STATUS}" == "healthy" || "${STATUS}" == "none" ]]; then
        break
      fi
      sleep 3
      WAITED=$((WAITED + 3))
    done
    log "  ${svc} → déployé (${IMAGE_TAG})"
  fi
done

# ── 4. Appliquer les migrations DB ────────────────────────────────────────────
log "Étape 4/5 : migrations DB..."
if $DRY_RUN; then
  log "  [dry-run] docker exec sinaur-api node dist/db/migrate.js"
else
  docker exec sinaur-api node dist/db/migrate.js || log "⚠ Migration échouée"
fi

# ── 5. Healthcheck final ──────────────────────────────────────────────────────
log "Étape 5/5 : healthcheck final..."
sleep 5
if $DRY_RUN; then
  log "  [dry-run] ${SCRIPT_DIR}/healthcheck.sh"
else
  "${SCRIPT_DIR}/healthcheck.sh" && log "✓ Déploiement ${IMAGE_TAG} SUCCÈS" || {
    log "✗ Healthcheck ÉCHEC — rollback recommandé"
    exit 1
  }
fi
