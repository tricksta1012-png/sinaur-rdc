-- Migration 004: Événements de catastrophe + événements canoniques (ingestion)

CREATE TYPE hazard_type AS ENUM (
  'flood', 'landslide', 'mass_displacement', 'humanitarian_crisis',
  'health_epidemic', 'volcanic_eruption', 'drought', 'fire',
  'conflict', 'earthquake', 'other'
);

CREATE TYPE event_status AS ENUM (
  'reported', 'under_review', 'validated', 'active', 'resolved', 'rejected'
);

CREATE TYPE event_source AS ENUM (
  'citizen', 'field_agent', 'ai_prediction', 'reliefweb',
  'fews_net', 'mettelsat', 'ocha', 'official', 'other'
);

CREATE TYPE alert_severity AS ENUM ('Minor', 'Moderate', 'Severe', 'Extreme', 'Unknown');
CREATE TYPE confidence_level AS ENUM ('low', 'medium', 'high', 'confirmed');

CREATE TABLE disaster_events (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT          NOT NULL,
  description         TEXT          NOT NULL DEFAULT '',
  hazard_type         hazard_type   NOT NULL,
  status              event_status  NOT NULL DEFAULT 'reported',
  severity            alert_severity NOT NULL DEFAULT 'Unknown',
  confidence          confidence_level NOT NULL DEFAULT 'low',
  source              event_source  NOT NULL,
  source_url          TEXT,
  source_ref          TEXT,
  glide_number        TEXT,
  location_pcode      TEXT          NOT NULL REFERENCES admin_divisions(pcode),
  location_name       TEXT          NOT NULL,
  location_level      SMALLINT      NOT NULL,
  location_accuracy   TEXT          NOT NULL DEFAULT 'pcode',
  location_point      GEOMETRY(POINT, 4326),
  affected_pcodes     TEXT[]        NOT NULL DEFAULT '{}',
  estimated_affected  INTEGER,
  reported_by_id      UUID          REFERENCES users(id),
  validated_by_id     UUID          REFERENCES users(id),
  validated_at        TIMESTAMPTZ,
  start_date          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  end_date            TIMESTAMPTZ,
  tags                TEXT[]        NOT NULL DEFAULT '{}',
  is_flagged_sensitive BOOLEAN      NOT NULL DEFAULT FALSE,
  sync_status         TEXT          NOT NULL DEFAULT 'synced',
  client_created_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE event_media (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  media_type   TEXT        NOT NULL CHECK (media_type IN ('photo', 'video', 'audio', 'document')),
  url          TEXT        NOT NULL,
  thumbnail_url TEXT,
  uploaded_by  UUID        NOT NULL REFERENCES users(id),
  file_size_bytes BIGINT,
  mime_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table d'ingestion : événements bruts normalisés depuis sources externes
CREATE TABLE canonical_events (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id            TEXT          NOT NULL,
  source               event_source  NOT NULL,
  fetched_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  normalized_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  hazard_type          hazard_type   NOT NULL,
  title                TEXT          NOT NULL,
  description          TEXT          NOT NULL DEFAULT '',
  location_pcode       TEXT          REFERENCES admin_divisions(pcode),
  location_point       GEOMETRY(POINT, 4326),
  start_date           TIMESTAMPTZ   NOT NULL,
  severity             alert_severity NOT NULL DEFAULT 'Unknown',
  confidence           confidence_level NOT NULL DEFAULT 'low',
  glide_number         TEXT,
  source_url           TEXT,
  raw_payload          JSONB         NOT NULL DEFAULT '{}',
  is_duplicate         BOOLEAN       NOT NULL DEFAULT FALSE,
  deduplication_hash   TEXT          NOT NULL,
  matched_event_id     UUID          REFERENCES disaster_events(id),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX disaster_events_location_point_idx ON disaster_events USING GIST (location_point);
CREATE INDEX disaster_events_pcode_idx          ON disaster_events (location_pcode);
CREATE INDEX disaster_events_hazard_idx         ON disaster_events (hazard_type, status);
CREATE INDEX disaster_events_start_date_idx     ON disaster_events (start_date DESC);
CREATE INDEX disaster_events_affected_pcodes_idx ON disaster_events USING GIN (affected_pcodes);
CREATE INDEX canonical_events_hash_idx          ON canonical_events (deduplication_hash);
CREATE INDEX canonical_events_source_idx        ON canonical_events (source, source_id);

CREATE TRIGGER disaster_events_updated_at
  BEFORE UPDATE ON disaster_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
