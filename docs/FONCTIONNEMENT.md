# SINAUR-RDC — Documentation technique

**Système National Intelligent d'Alerte, d'Urgence et de Réponse aux Sinistres de la RDC**

---

## Vue d'ensemble

SINAUR-RDC est une plateforme de gestion des catastrophes pour la République Démocratique du Congo, alignée sur les 4 piliers **EW4All** (Early Warnings for All) de l'ONU :

1. **Connaissance des risques** — ingestion de données multi-sources, modèles prédictifs IA
2. **Observation & prévision** — monitoring météo, hydrologique, sismique en temps réel
3. **Diffusion & communication** — alertes CAP 1.2, push FCM, SMS, USSD, WhatsApp
4. **Préparation & réponse** — registre des sinistrés, stocks humanitaires, coordination des crises

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  apps/web (React)  │  apps/mobile (Expo)  │  apps/command-center │
│  Backoffice RBAC   │  Agents terrain      │  Décideurs nationaux  │
│  :5173             │  Android / iOS       │  :5175                │
└──────────┬─────────┴──────────┬───────────┴──────────┬───────────┘
           │                   │                       │
           └───────────────────▼───────────────────────┘
                        ┌──────────────┐
                        │   apps/api   │  Fastify + TypeScript
                        │   :3000      │  JWT RS256, RBAC géo
                        └──────┬───────┘
           ┌───────────────────┼────────────────────────┐
           ▼                   ▼                        ▼
   ┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐
   │  PostgreSQL  │   │  services/        │   │  services/      │
   │  + PostGIS   │   │  ai-prediction    │   │  alerting       │
   │  (Neon.tech) │   │  :8001 (Python)   │   │  :3001          │
   └──────────────┘   └──────────────────┘   └─────────────────┘
           │          ┌──────────────────┐   ┌─────────────────┐
           │          │  services/        │   │  services/      │
           │          │  ingestion        │   │  sync-gateway   │
           │          │  (connecteurs)    │   │  :3003          │
           │          └──────────────────┘   └─────────────────┘
           │          ┌──────────────────┐
           └──────────│  Redis (cache,   │
                      │  pub/sub, queue) │
                      └──────────────────┘
```

---

## Pile technique

| Couche | Technologie |
|---|---|
| Web / Backoffice | React 18 + TypeScript + Vite + TanStack Query + Tailwind |
| Mobile | React Native (Expo) + stockage chiffré |
| API Backend | Node.js + Fastify + TypeScript |
| IA / ML | Python 3.11 + FastAPI + scikit-learn (GradientBoosting) |
| Base de données | PostgreSQL 16 + PostGIS (hébergé sur Neon.tech) |
| Cache / Files | Redis 7 |
| Cartographie | OpenStreetMap + MapLibre GL |
| Auth | JWT RS256 + OTP SMS + RBAC géographique |
| Push notifications | Firebase Cloud Messaging (projet : sinaur-rdc) |
| Monorepo | pnpm + Turborepo |

---

## Flux de données — événement catastrophe

```
Citoyen / Agent terrain
        │  POST /events
        ▼
  ┌─────────────┐
  │   apps/api  │──── déduplication (hash 24h) ────► 409 si doublon
  └──────┬──────┘
         │ INSERT disaster_events (status='reported')
         │ broadcastNewEvent() ──► WebSocket (décideurs en périmètre)
         │ SMS accusé de réception ──► sms_queue
         ▼
  ┌──────────────────┐
  │  moderation_queue│  Score de priorité selon source
  └──────┬───────────┘  (citizen=3, field_agent=5)
         │
         ▼ PATCH /events/:id/validate
  ┌──────────────┐
  │  Validateur  │──── status → 'validated' / 'rejected'
  └──────┬───────┘     audit_log enregistré
         │
         ▼ status → 'active'
  ┌────────────────────┐
  │  services/alerting │──► CAP 1.2 (alertes officielles)
  └──────┬─────────────┘──► Push FCM (RESOURCE_ROLES + scope géo)
         │               ──► sms_queue (gestionnaires de zone)
         │               ──► WebSocket temps réel
         │               ──► Webhooks sortants (HMAC-SHA256)
         ▼
  ┌──────────────────────────┐
  │  services/sync-gateway   │──► apps/mobile (offline-first)
  └──────────────────────────┘
```

---

## Ingestion automatique (sources externes)

Le service `services/ingestion` tourne en fond et collecte des données de plusieurs sources toutes les heures.

| Connecteur | Source | Données |
|---|---|---|
| **GDACS** | gdacs.org/xml/rss.xml | Catastrophes mondiales filtrées RDC (GeoRSS) |
| **ReliefWeb** | api.reliefweb.int | Rapports humanitaires OCHA |
| **FEWS NET** | fews.net | Alertes alimentaires et déplacements |
| **Open-Meteo** | open-meteo.com | Données météo (précipitations, températures) |

### Pipeline d'ingestion

```
Source externe
      │  fetch (HTTP)
      ▼
 Normalisation ──► NormalizedEvent
      │
      ▼
 Déduplication ──► hash SHA-256 (source + hazardType + pcode + date)
      │              ──► SKIP si doublon
      ▼
 INSERT canonical_events
      │
      ▼  (si source officielle + sévérité ≥ Moderate)
 INSERT disaster_events (status='under_review')
```

---

## Agents IA

Trois agents IA tournent dans `services/ai-prediction` (FastAPI :8001).

### Agent 1 — Veille automatique (`/veille`)

Surveille en continu les flux d'ingestion et les données météo pour détecter des signaux faibles avant qu'une catastrophe ne soit déclarée.

- **Entrées :** données canonical_events (48h glissantes), données météo Open-Meteo
- **Sortie :** événements de veille signalés dans `veille_events` avec score d'anomalie
- **Déclenchement :** cron toutes les heures + appel API `POST /veille/scan`

### Agent 2 — Prédiction des risques (`/predictions`)

Modèles GradientBoosting (un par type d'aléa) qui calculent un score de risque 0–100 pour chaque P-code sur 3 horizons temporels.

- **Horizons :** 7 jours / 30 jours / 90 jours
- **Aléas couverts :** inondation, glissement, déplacement, crise humanitaire, épidémie, sécheresse, incendie, conflit
- **Explicabilité :** contribution de chaque feature (approximation Shapley) — obligatoire §5
- **Niveaux :** `low` · `medium` · `high` · `critical`
- **Validation humaine requise** pour `critical` (alerte CAP bloquée jusqu'à validation)

```
Accès API (via apps/api) :
  GET  /predictions/risks?horizon=7&province=CD10
  GET  /predictions/risk-map/:horizon
  POST /predictions/alerts/:id/validate   (décideurs uniquement)
  POST /predictions/alerts/:id/reject
  GET  /predictions/history/:pcode
```

### Agent 3 — Détection de fraude (`/antifraud`)

Analyse les signalements citoyens pour détecter les faux positifs, les doublons suspects et les campagnes de désinformation.

- **Règles :** fréquence de signalement par utilisateur, cohérence géographique, similarité textuelle
- **Score :** `clean` · `suspicious` · `fraudulent`
- **Action :** élève le score de priorité de modération si `suspicious`, bloque si `fraudulent`

---

## Alertes (CAP 1.2)

Toutes les alertes officielles respectent la norme **CAP 1.2** (ITU-T X.1303).

```
POST /alerts  (validateurs + admins)
      │
      ├──► INSERT alerts (table)
      │    champs CAP : identifier, sender, sent, status, msgType,
      │                  scope, category, event, urgency, severity,
      │                  certainty, headline, description, instruction
      │
      ├──► services/alerting
      │      ├── Push FCM ──► tokens des rôles RESOURCE_ROLES dans la zone
      │      ├── sms_queue ──► numéros des gestionnaires de zone
      │      └── Webhooks ──► POST HMAC-SHA256 aux abonnés externes
      │
      └──► GET /public/feed.atom  (flux Atom public, anonymisé)
```

---

## Rôles & RBAC géographique

| Rôle | Périmètre | Droits |
|---|---|---|
| `system_admin` | National | Tout |
| `national_decision_maker` | National | Lecture + validation + crises |
| `provincial_coordinator` | Province(s) | Lecture + validation locale |
| `territory_admin` | Territoire(s) | Lecture + validation locale |
| `local_validator` | Zone locale | Validation événements |
| `field_agent` | Assigné | Signalement + lecture |
| `citizen` | — | Signalement uniquement |

Le RBAC géographique s'appuie sur les **P-codes OCHA COD-AB** (26 provinces + sous-niveaux). Chaque utilisateur a un tableau `geographic_scope_pcodes` — une alerte ou un événement lui est visible seulement si son P-code chevauche la zone.

---

## Standards implémentés

| Standard | Usage |
|---|---|
| **CAP 1.2** (ITU-T X.1303) | Toutes les alertes officielles |
| **P-codes OCHA COD-AB** | Découpage administratif RDC (26 provinces + sous-niveaux) |
| **GLIDE numbers** | Identification unique des catastrophes (`FL-2024-000001-COD`) |
| **HXL** | Exports de données pour l'écosystème humanitaire OCHA |
| **GeoJSON / SRID 4326** | Toutes les géométries PostGIS |
| **JWT RS256** | Authentification (access 15 min + refresh 7 jours) |
| **HMAC-SHA256** | Signature des webhooks sortants |

---

## Modules fonctionnels

| Module | Description | Accès |
|---|---|---|
| **Signalement** | Formulaire web + mobile, offline-first, déduplication 24h | Tous rôles |
| **Carte** | MapLibre GL, marqueurs par gravité, filtres, mode historique (70 catastrophes 2000-2025) | Tous |
| **Événements** | Liste paginée avec détails complets, filtres multi-critères, source cliquable | Tous |
| **Alertes CAP** | Création, validation humaine (critical), diffusion multi-canal | Validateurs+ |
| **Crises** | Cycle de vie GLIDE, SitReps OCHA, kanban de coordination | Décideurs+ |
| **Registre** | Sinistrés, validation, déduplication biométrique, QR codes aides | Validateurs+ |
| **Stocks** | Dépôts humanitaires, inventaire, mouvements, alertes seuil minimum | Admins+ |
| **Demandes** | Affectation ressources ↔ crises, workflow approbation | Admins+ |
| **Backoffice admin** | CRUD utilisateurs, journal d'audit filtrable + export CSV | system_admin |
| **Portail public** | Alertes actives anonymisées, flux Atom, exports HXL | Anonyme |

---

## Offline & synchronisation

L'app mobile et le backoffice web supportent le mode hors ligne via `services/sync-gateway` (:3003).

- **Signalement offline :** stocké localement (chiffré), synchronisé à la reconnexion
- **Conflits :** résolution last-write-wins avec horodatage `client_created_at`
- **Delta sync :** seuls les changements depuis le dernier `cursor` sont transférés
- **USSD :** fallback pour téléphones basiques sans data (`services/ussd` :3002)

---

## Observabilité

| Outil | URL (prod) | Métriques |
|---|---|---|
| **Prometheus** | :9090 | Latence API, erreurs, files SMS, alertes CAP |
| **Grafana** | :3500 | Dashboard `sinaur-overview` — KPIs opérationnels |
| **Health check** | `/health` | DB + service IA, version, timestamp |

---

## Démarrage rapide

```bash
# 1. Prérequis : Docker, Node.js 20+, pnpm 9+
docker compose up postgres redis -d

# 2. Migrations + seeds
pnpm db:migrate
pnpm db:seed

# 3. Tout démarrer
pnpm dev
```

**URLs locales :**
- API : http://localhost:3000 (Swagger : http://localhost:3000/docs)
- Backoffice : http://localhost:5173
- Command Center : http://localhost:5175
- Portail public : http://localhost:5174

**Comptes démo :**

| Email | Mot de passe | Rôle |
|---|---|---|
| admin@sinaur-rdc.cd | demo1234 | Administrateur système |
| decision@sinaur-rdc.cd | demo1234 | Décideur national |
| gouverneur.kinshasa@rdc.cd | demo1234 | Admin territoire (Kinshasa) |
| agent.goma@sinaur-rdc.cd | demo1234 | Agent terrain (Nord-Kivu) |

---

## Sécurité

Les données concernent des personnes vulnérables. Mesures en vigueur :

- **Chiffrement transit :** TLS 1.3 (Nginx reverse proxy)
- **Chiffrement repos :** stockage mobile chiffré (Expo SecureStore)
- **Anonymisation :** portail public sans PII — noms, téléphones, coordonnées GPS précises masqués
- **Audit trail :** toutes les actions sensibles dans `audit_logs` (immuable)
- **RBAC géographique :** isolation des données par périmètre géographique
- **Rate limiting :** 100 req/min par IP sur l'API
- **Signalement vulnérabilités :** security@sinaur-rdc.cd

Voir `docs/adr/ADR-003-securite.md` pour les décisions architecturales de sécurité.
