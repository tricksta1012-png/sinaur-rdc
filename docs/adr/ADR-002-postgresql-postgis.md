# ADR-002 — PostgreSQL 16 + PostGIS comme base de données principale

**Date :** 2026-06-07  
**Statut :** Accepté

## Contexte

SINAUR-RDC doit stocker et interroger des données géospatiales complexes : limites administratives des 26 provinces + sous-niveaux, positions d'incidents, zones d'alerte, registre de sinistrés avec localisation. Les besoins incluent : reverse geocoding (point → P-code), requêtes « dans une zone », calculs de distance.

## Décision

- **PostgreSQL 16** avec l'extension **PostGIS** (SRID 4326).
- Géométries stockées en `GEOMETRY(POINT/MULTIPOLYGON, 4326)`.
- Index spatiaux GIST sur toutes les colonnes géométriques.
- Vue matérialisée `current_risk_scores` pour les scores IA (rafraîchie par le service Python).
- Extension `pg_trgm` pour la recherche approximative (déduplication du registre sinistrés).

## Alternatives rejetées

- **Firestore** : pas de requêtes géospatiales complexes, pas de jointures relationnelles nécessaires pour la chaîne de validation, pas de PostGIS.
- **MongoDB** : PostGIS est plus mature et performant pour les requêtes géospatiales sur des polygones complexes.

## Conséquences

- (+) Requêtes géospatiales de production : `ST_Contains`, `ST_Within`, `ST_Distance`.
- (+) Déduplication du registre via `pg_trgm` (noms approchants).
- (+) Audit log inviolable (INSERT ONLY via règles PostgreSQL).
- (-) Nécessite Docker ou infrastructure PostgreSQL (pas de serverless simple).
- (-) Import COD-AB à exécuter manuellement au premier déploiement.
