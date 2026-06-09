# SINAUR-RDC

**Système National Intelligent d'Alerte, d'Urgence et de Réponse aux Sinistres  
de la République Démocratique du Congo**

> Observatoire national intelligent des risques et des sinistrés — aligné sur les 4 piliers **EW4All** (ONU)

---

## Architecture

```
sinaur-rdc/
├── apps/
│   ├── web/              # Frontend React + TypeScript + Vite + Tailwind
│   ├── mobile/           # App React Native (Expo) — citoyens & agents terrain
│   ├── command-center/   # Tableau de bord décideurs
│   └── api/              # Backend Fastify + TypeScript
├── services/
│   ├── ai-prediction/    # Python + FastAPI — modèles prédictifs
│   ├── ingestion/        # Connecteurs (ReliefWeb, FEWS NET, METTELSAT, météo…)
│   ├── alerting/         # CAP 1.2, SMS, USSD, WhatsApp, push FCM
│   └── sync-gateway/     # Synchronisation offline
├── packages/
│   ├── shared-types/     # Types TypeScript partagés
│   ├── geo/              # P-codes RDC + utilitaires géospatiaux
│   ├── ui/               # Composants UI partagés
│   └── i18n/             # FR + Lingala + Swahili + Kikongo + Tshiluba
├── db/
│   ├── migrations/       # PostgreSQL 16 + PostGIS — schéma complet
│   └── seeds/            # Données de démonstration
├── infra/                # Docker Compose, déploiement
└── docs/adr/             # Décisions architecturales
```

## Pile technique

| Couche | Technologie |
|---|---|
| Web | React 18 + TypeScript + Vite + TanStack Query + Tailwind |
| Mobile | React Native (Expo) + stockage chiffré |
| Backend | Node.js + Fastify + TypeScript |
| IA / ML | Python + FastAPI + scikit-learn / XGBoost |
| Base de données | PostgreSQL 16 + PostGIS |
| Cache / files | Redis 7 |
| Cartographie | OpenStreetMap + MapLibre GL |
| Auth | JWT (RS256) + OTP SMS + RBAC géographique |
| Notifications push | Firebase Cloud Messaging (projet: sinaur-rdc) |

## Standards implémentés

- **CAP 1.2** (ITU-T X.1303) — toutes les alertes officielles
- **P-codes OCHA COD-AB** — découpage administratif de la RDC (26 provinces + sous-niveaux)
- **HXL** — exports de données pour l'écosystème humanitaire
- **GLIDE numbers** — identification unique des catastrophes
- **GeoJSON / SRID 4326** — toutes les géométries PostGIS

## Démarrage rapide (développement)

### Prérequis

- Node.js 20+, pnpm 9+
- Docker & Docker Compose
- Python 3.11+ (pour le service IA)

### 1. Cloner et installer

```bash
git clone https://github.com/sinaur-rdc/sinaur-rdc.git
cd sinaur-rdc
cp .env.example .env
pnpm install
```

### 2. Démarrer la base de données

```bash
docker compose up postgres redis -d
```

### 3. Appliquer les migrations et les seeds

```bash
pnpm db:migrate
pnpm db:seed
```

### 4. Importer les limites administratives COD-AB (optionnel mais recommandé)

```bash
pnpm --filter @sinaur/api db:import-cod-ab
```

Source : https://data.humdata.org/dataset/cod-ab-cod

### 5. Lancer les applications

```bash
pnpm dev
```

- API : http://localhost:3000
- Web (backoffice) : http://localhost:5173
- Centre de commandement : http://localhost:5175
- Portail public : http://localhost:5174
- Sync Gateway : http://localhost:3003
- Prometheus : http://localhost:9090 (prod uniquement)
- Grafana : http://localhost:3500 (prod uniquement)
- Health check : http://localhost:3000/health
- Flux Atom alertes : http://localhost:3000/public/feed.atom

### Comptes de démonstration

| Email | Mot de passe | Rôle |
|---|---|---|
| admin@sinaur-rdc.cd | demo1234 | Administrateur système |
| decision@sinaur-rdc.cd | demo1234 | Décideur national |
| gouverneur.kinshasa@rdc.cd | demo1234 | Admin territoire (Kinshasa) |
| agent.goma@sinaur-rdc.cd | demo1234 | Agent terrain (Nord-Kivu) |

## Feuille de route

| Phase | Contenu | État |
|---|---|---|
| **Phase 0** — Fondations | Monorepo, types, BD, auth RBAC, P-codes, seeds | ✅ Terminé |
| **Phase 1** — MVP | Signalement web+mobile offline, carte, dashboard | ✅ Terminé |
| **Phase 2** — Alerte | Ingestion (ReliefWeb+météo), IA, CAP+push+SMS | ✅ Terminé |
| **Phase 3** — Registre | Registre sinistrés, validation, QR aides | ✅ Terminé |
| **Phase 4** — Terrain | Sync avancée, offline, USSD, Android bas de gamme | ✅ Terminé |
| **Phase 5** — Ouverture | Portail public HXL, audit sécurité | ✅ Terminé |
| **Phase 6** — Commandement | Centre ops GLIDE, kanban coordination, SitReps OCHA | ✅ Terminé |
| **Phase 7** — Sync & UI | Sync Gateway offline (port 3003), `@sinaur/ui`, CI/CD GitHub Actions | ✅ Terminé |
| **Phase 8** — Observabilité | `@sinaur/metrics` Prometheus, Grafana dashboards, `docker-compose.prod.yml` | ✅ Terminé |
| **Phase 9** — Tests & qualité | Suite Vitest : sécurité, RBAC, public routes (PII check), sync conflicts, delta | ✅ Terminé |
| **Phase 10** — Déploiement souverain | Nginx reverse proxy SSL, scripts backup/restore/deploy/healthcheck, OpenAPI | ✅ Terminé |
| **Phase 11** — Mobile complet | Auth+biométrie, carte OSM+marqueurs, deep-link notifications, cache offline | ✅ Terminé |
| **Phase 12** — Backoffice admin | Gestion utilisateurs (CRUD), journal d'audit filtrable + export CSV, RBAC sidebar | ✅ Terminé |
| **Phase 13** — Push FCM & profil | Pipeline push FCM corrige (sync_devices), GET/PATCH /users/me, ProfileScreen mobile | ✅ Terminé |
| **Phase 14** — Reset mot de passe | POST /auth/forgot-password + reset-password (OTP), ForgotPasswordPage web, lien mobile | ✅ Terminé |
| **Phase 15** — Tests phases 12-14 | Vitest : admin/users (CRUD+RBAC), auth-reset (OTP+enumeration), profile (GET+PATCH) | ✅ Terminé |
| **Phase 16** — Webhooks sortants | CRUD /admin/webhooks, HMAC-SHA256, broadcast alert.published, 10 failures → auto-disable | ✅ Terminé |
| **Phase 17** — Connecteur GDACS | GeoRSS GDACS filtre RDC, fast-xml-parser, déduplication source_url, cron 3h | ✅ Terminé |
| **Phase 18** — Release v1.0.0 | Version bump, tag git v1.0.0, déploiement souverain | ✅ Terminé |
| **Phase 19** — Stocks humanitaires | Dépôts, stocks (9 types), mouvements entrée/sortie, alertes seuil minimum, UI web | ✅ Terminé |
| **Phase 20** — Tests stocks humanitaires | Vitest : dépôts (CRUD+RBAC), stocks (upsert+validation), mouvements (in/out/transfer/adjustment+409), historique paginé, alertes seuil | ✅ Terminé |
| **Phase 21** — Dashboard stocks command center | KPIs, carte MapLibre dépôts colorés par statut, alertes seuil, détail dépôt (inventaire+barres+mouvements), nav sidebar | ✅ Terminé |
| **Phase 22** — Design backoffice web | Système de design `sn-*` (CSS components), sidebar redesign (role badge, RDC flag), refactoring complet des 8 pages | ✅ Terminé |
| **Phase 23** — Push FCM stocks critiques | Franchissement seuil minimum → `axios.post /notify/stock-low` → `sendPushStockAlert` (RESOURCE_ROLES + scope géo) | ✅ Terminé |
| **Phase 24** — Affectation ressources ↔ sinistres | `resource_demands` (pending→approved→fulfilled/rejected), RBAC approbation admin/décideur, UI onglet Demandes + modaux | ✅ Terminé |
| **Phase 25** — Page Crises backoffice | Liste/détail crises (filtres statut, GLIDE, champs complets), onglet Demandes liées, actions Maîtriser/Clôturer, modale création, RBAC rôles | ✅ Terminé |
| **Phase 26** — Tests phases 23-25 | Vitest crises.test.ts (40 tests) : GET/POST /crises, GET/PATCH /crises/:id, POST/GET/PATCH sitreps, RBAC complet, GLIDE auto-généré, 404/400/403/401 | ✅ Terminé |
| **Phase 27** — Dashboard enrichi | KPIs dynamiques crises/demandes/stocks, flux activité récente (crises+demandes), cards cliquables → /crises & /resources, barre statut opérationnel | ✅ Terminé |
| **Phase 28** — Carte historique | Seed 70 catastrophes RDC 2000-2025, mode historique carte (`?history=true`), filtre période, popup GLIDE+dates, marqueurs résolus translucides, `docs/CARTE_HISTORIQUE.md` | ✅ Terminé |

## Déploiement souverain

```bash
# 1. Copier et remplir les variables de production
cp .env.example .env.prod  # puis éditer avec les vrais secrets

# 2. Placer les certificats SSL
cp sinaur-rdc.crt infra/certs/
cp sinaur-rdc.key infra/certs/

# 3. Déployer un tag
IMAGE_TAG=v1.0.0 ./infra/scripts/deploy.sh

# 4. Vérifier l'état des services
./infra/scripts/healthcheck.sh

# 5. Sauvegarder la base de données
./infra/scripts/backup.sh daily
```

Documentation API (Swagger UI) disponible sur `/docs` en développement ou si `SWAGGER_ENABLED=true`.

## Sécurité

Les données concernent des personnes vulnérables. Voir `docs/adr/ADR-003-securite.md`.  
Signaler une vulnérabilité : security@sinaur-rdc.cd

## Licence

Usage gouvernemental et humanitaire — République Démocratique du Congo  
© 2026 SINAUR-RDC
