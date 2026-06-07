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
- Portail public : http://localhost:5174
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

## Sécurité

Les données concernent des personnes vulnérables. Voir `docs/adr/ADR-003-securite.md`.  
Signaler une vulnérabilité : security@sinaur-rdc.cd

## Licence

Usage gouvernemental et humanitaire — République Démocratique du Congo  
© 2026 SINAUR-RDC
