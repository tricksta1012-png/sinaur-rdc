-- Migration 006: Registre national des sinistrés
-- Inclut : chaîne de validation anti-fraude, déduplication, protection des données sensibles

CREATE TYPE beneficiary_status AS ENUM (
  'pending', 'under_validation', 'validated', 'rejected', 'duplicate'
);

CREATE TYPE vulnerability_level AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE validation_step AS ENUM (
  'neighborhood_chief', 'village_chief', 'mayor', 'territory_admin', 'humanitarian_partner'
);

CREATE TABLE beneficiaries (
  id                      UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number     TEXT                NOT NULL UNIQUE,
  qr_code_data            TEXT                NOT NULL UNIQUE,
  status                  beneficiary_status  NOT NULL DEFAULT 'pending',

  -- Chef de ménage
  head_first_name         TEXT                NOT NULL,
  head_last_name          TEXT                NOT NULL,
  head_birth_date         DATE,
  head_gender             CHAR(1)             CHECK (head_gender IN ('M', 'F', 'O')),

  -- Membres du ménage (JSON pour flexibilité, tout en gardant les infos structurées)
  household_members       JSONB               NOT NULL DEFAULT '[]',
  household_size          SMALLINT            NOT NULL DEFAULT 1,

  vulnerability_level     vulnerability_level NOT NULL DEFAULT 'medium',
  vulnerability_factors   TEXT[]              NOT NULL DEFAULT '{}',

  disaster_type           hazard_type         NOT NULL,
  disaster_event_id       UUID                REFERENCES disaster_events(id),

  -- Localisation actuelle (obfusquée si sensible)
  location_pcode          TEXT                NOT NULL REFERENCES admin_divisions(pcode),
  location_name           TEXT                NOT NULL,
  location_accuracy       TEXT                NOT NULL DEFAULT 'pcode',
  location_point          GEOMETRY(POINT, 4326),

  -- Localisation d'origine
  origin_pcode            TEXT                REFERENCES admin_divisions(pcode),
  origin_name             TEXT,

  -- Validation hiérarchique
  validation_chain        JSONB               NOT NULL DEFAULT '[]',
  current_validation_step validation_step,

  registered_by_id        UUID                NOT NULL REFERENCES users(id),
  registered_at           TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  -- Déduplication
  duplicate_of            UUID                REFERENCES beneficiaries(id),
  duplicate_confidence    confidence_level,
  deduplication_fingerprint TEXT,

  notes                   TEXT,

  -- Protection données sensibles
  is_sensitive            BOOLEAN             NOT NULL DEFAULT FALSE,
  location_obfuscated     BOOLEAN             NOT NULL DEFAULT FALSE,

  sync_status             TEXT                NOT NULL DEFAULT 'synced',
  client_created_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

-- Index pour déduplication approximative (noms + date de naissance)
CREATE INDEX beneficiaries_head_name_trgm_idx
  ON beneficiaries USING GIN ((head_first_name || ' ' || head_last_name) gin_trgm_ops);
CREATE INDEX beneficiaries_head_birth_idx    ON beneficiaries (head_birth_date);
CREATE INDEX beneficiaries_location_pcode_idx ON beneficiaries (location_pcode);
CREATE INDEX beneficiaries_location_point_idx ON beneficiaries USING GIST (location_point);
CREATE INDEX beneficiaries_event_idx          ON beneficiaries (disaster_event_id);
CREATE INDEX beneficiaries_status_idx         ON beneficiaries (status);
CREATE INDEX beneficiaries_fingerprint_idx    ON beneficiaries (deduplication_fingerprint);

CREATE TRIGGER beneficiaries_updated_at
  BEFORE UPDATE ON beneficiaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON COLUMN beneficiaries.deduplication_fingerprint IS
  'Hash sur (prénom normalisé, nom normalisé, date de naissance, pcode origine) '
  'pour détection rapide de doublons exacts. Les doublons approximatifs passent '
  'par la recherche pg_trgm avec revue humaine obligatoire avant fusion.';

COMMENT ON COLUMN beneficiaries.location_obfuscated IS
  'Si TRUE, la localisation précise est masquée dans les vues non-opérationnelles '
  'pour protéger les personnes fuyant un conflit actif.';
