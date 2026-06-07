-- Migration 001: Extensions PostgreSQL requises
-- PostGIS pour les données géospatiales (SRID 4326)
-- pgcrypto pour gen_random_uuid()
-- pg_trgm pour la recherche approximative (déduplication registre)

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Fonction utilitaire : horodatage automatique
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
