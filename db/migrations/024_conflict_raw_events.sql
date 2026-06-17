-- Migration 024: Tables persistence événements conflit multi-sources
-- conflict_event_raw  : événements bruts par source (UNIQUE source+external_id)
-- conflict_event_corroborated : clusters consolidés avec score de corroboration
-- Indexes GiST pour les colonnes géospatiales

CREATE TABLE IF NOT EXISTS conflict_event_raw (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                TEXT NOT NULL,
  external_id           TEXT NOT NULL,
  province              TEXT NOT NULL,
  p_code                TEXT,
  territoire            TEXT,
  event_type            TEXT NOT NULL DEFAULT 'conflict',
  event_date            TIMESTAMPTZ NOT NULL,
  severity              INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  displacement_risk     NUMERIC(4,3) NOT NULL DEFAULT 0,
  location              GEOMETRY(Point, 4326),
  fatalities_low        INTEGER,
  fatalities_high       INTEGER,
  actors_raw            JSONB NOT NULL DEFAULT '[]',
  raw_notes             TEXT,
  source_url            TEXT,
  source_reliability    NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  needs_corroboration   BOOLEAN NOT NULL DEFAULT FALSE,
  raw_payload           JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conflict_event_raw_source_external_uq UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS conflict_event_raw_location_idx
  ON conflict_event_raw USING GIST (location)
  WHERE location IS NOT NULL;

CREATE INDEX IF NOT EXISTS conflict_event_raw_province_date_idx
  ON conflict_event_raw (province, event_date DESC);

CREATE INDEX IF NOT EXISTS conflict_event_raw_source_idx
  ON conflict_event_raw (source);

CREATE INDEX IF NOT EXISTS conflict_event_raw_event_type_idx
  ON conflict_event_raw (event_type);

-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflict_event_corroborated (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_hash          TEXT NOT NULL UNIQUE,
  province              TEXT NOT NULL,
  event_type            TEXT NOT NULL DEFAULT 'conflict',
  event_date            TIMESTAMPTZ NOT NULL,
  severity              INTEGER NOT NULL DEFAULT 1,
  displacement_risk     NUMERIC(4,3) NOT NULL DEFAULT 0,
  sources_count         INTEGER NOT NULL DEFAULT 1,
  sources_list          JSONB NOT NULL DEFAULT '[]',
  corroboration_score   NUMERIC(4,3) NOT NULL DEFAULT 0,
  corroboration_detail  TEXT,
  academic_concordance  BOOLEAN NOT NULL DEFAULT FALSE,
  needs_corroboration   BOOLEAN NOT NULL DEFAULT FALSE,
  contradictions        JSONB NOT NULL DEFAULT '[]',
  fatalities_reported   INTEGER,
  fatalities_low        INTEGER,
  fatalities_high       INTEGER,
  actors_consolidated   JSONB NOT NULL DEFAULT '[]',
  coordinates           JSONB,
  raw_event_ids         JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conflict_event_corroborated_province_idx
  ON conflict_event_corroborated (province, event_date DESC);

CREATE INDEX IF NOT EXISTS conflict_event_corroborated_score_idx
  ON conflict_event_corroborated (corroboration_score DESC);

CREATE TRIGGER conflict_event_corroborated_updated_at
  BEFORE UPDATE ON conflict_event_corroborated
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
