# ADR-003 — Sécurité & Protection des données de personnes vulnérables

**Date :** 2026-06-07  
**Statut :** Accepté — BLOQUANT

## Contexte

Les données traitées par SINAUR-RDC concernent des déplacés, réfugiés et victimes de conflit. Une fuite de localisation peut directement mettre des vies en danger. Ce document liste les décisions de sécurité non-négociables.

## Décisions

### 1. RBAC géographique
Chaque utilisateur a un `geographic_scope_pcodes`. Un agent de Kinshasa ne peut pas accéder aux données du Nord-Kivu. L'API applique ce filtre systématiquement.

### 2. Localisation sensible — floutage
Le champ `location_obfuscated` dans la table `beneficiaries` permet de masquer la position précise dans les vues non-opérationnelles pour les personnes fuyant un conflit actif.

### 3. Audit log inviolable
La table `audit_log` a des règles PostgreSQL qui bloquent `UPDATE` et `DELETE`. Tout accès aux données personnelles est journalisé.

### 4. Anonymisation stricte pour le portail public (Module 9)
Aucune donnée permettant la réidentification ne transite via le portail public. Agrégation par zone uniquement, k-anonymat minimal.

### 5. Chiffrement
- En transit : TLS partout (API, base de données, Redis si exposé).
- Au repos : chiffrement du stockage PostgreSQL et des sauvegardes.
- Mobile : SecureStore / Android Keystore pour les données locales.

### 6. Secrets
Aucun secret (JWT_SECRET, clés API) dans le code. Tout dans `.env` (non commité) ou un gestionnaire de secrets en production.

### 7. Validation humaine obligatoire pour alertes critiques
Les alertes de niveau Extreme générées par l'IA (`is_issued_by_ai = TRUE`) ne sont pas diffusées automatiquement : elles nécessitent `validated_by_id` et `validated_at` avant diffusion.

### 8. Biométrie — optionnelle uniquement
Si implémentée ultérieurement : base légale, consentement explicite, minimisation, chiffrement. Par défaut : identité déclarée + validation communautaire.

## Responsabilité

Tout développeur modifiant le code d'accès aux données doit lire ce document. Les PR modifiant auth, RBAC ou accès au registre requièrent une revue de sécurité.
