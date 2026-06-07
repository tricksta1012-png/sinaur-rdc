# ADR-001 — Monorepo avec pnpm Workspaces + Turborepo

**Date :** 2026-06-07  
**Statut :** Accepté

## Contexte

SINAUR-RDC comprend plusieurs applications (web, mobile, API, services IA, ingestion, alerting) qui partagent des types TypeScript, des utilitaires géospatiaux et des traductions. Une organisation monorepo permet de partager le code sans duplication et de garantir la cohérence des types à travers les couches.

## Décision

- **pnpm Workspaces** pour la gestion des dépendances et des packages locaux.
- **Turborepo** pour l'orchestration des builds (cache, parallélisme, dépendances de build).
- Packages partagés dans `packages/` : `shared-types`, `geo`, `ui`, `i18n`.
- Scripts racine délèguent aux workspaces via `pnpm --filter`.

## Conséquences

- (+) Types partagés garantissent la cohérence API ↔ frontend ↔ mobile.
- (+) Import COD-AB et standards (CAP, P-codes) centralisés.
- (+) CI peut tester uniquement les packages affectés par un changement (Turborepo cache).
- (-) Complexité initiale de configuration (tsconfig paths, moduleResolution).
