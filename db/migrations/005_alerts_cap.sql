-- Migration 005: Alertes conformes CAP 1.2
-- Ref: ITU-T X.1303 / OASIS Common Alerting Protocol 1.2

CREATE TYPE cap_status AS ENUM ('Actual', 'Exercise', 'System', 'Test', 'Draft');
CREATE TYPE cap_msg_type AS ENUM ('Alert', 'Update', 'Cancel', 'Ack', 'Error');
CREATE TYPE cap_scope AS ENUM ('Public', 'Restricted', 'Private');

CREATE TABLE cap_alerts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier        TEXT          NOT NULL UNIQUE,
  sender            TEXT          NOT NULL,
  sent              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  status            cap_status    NOT NULL DEFAULT 'Actual',
  msg_type          cap_msg_type  NOT NULL DEFAULT 'Alert',
  source            TEXT,
  scope             cap_scope     NOT NULL DEFAULT 'Public',
  restriction       TEXT,
  addresses         TEXT,
  code              TEXT[],
  note              TEXT,
  "references"      TEXT,
  incidents         TEXT,
  -- Bloc <info> principal (FR), stocké en JSON pour flexibilité CAP
  info              JSONB         NOT NULL DEFAULT '[]',
  glide_number      TEXT,
  is_issued_by_ai   BOOLEAN       NOT NULL DEFAULT FALSE,
  validated_by_id   UUID          REFERENCES users(id),
  validated_at      TIMESTAMPTZ,
  related_event_id  UUID          REFERENCES disaster_events(id),
  -- Zones géographiques (dénormalisées pour requêtes rapides)
  target_pcodes     TEXT[]        NOT NULL DEFAULT '{}',
  target_geometry   JSONB,   -- GeoJSON MultiPolygon
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Livraisons d'alertes (traçabilité multicanal)
CREATE TYPE alert_channel AS ENUM ('push', 'sms', 'ussd', 'whatsapp', 'web', 'email');

CREATE TABLE alert_deliveries (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id          UUID          NOT NULL REFERENCES cap_alerts(id),
  channel           alert_channel NOT NULL,
  recipient_pcodes  TEXT[]        NOT NULL DEFAULT '{}',
  sent_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  delivered_count   INTEGER       NOT NULL DEFAULT 0,
  failed_count      INTEGER       NOT NULL DEFAULT 0,
  error_details     JSONB
);

CREATE INDEX cap_alerts_target_pcodes_idx ON cap_alerts USING GIN (target_pcodes);
CREATE INDEX cap_alerts_target_geom_idx   ON cap_alerts USING GIN  (target_geometry);
CREATE INDEX cap_alerts_sent_idx          ON cap_alerts (sent DESC);
CREATE INDEX cap_alerts_status_idx        ON cap_alerts (status, msg_type);
CREATE INDEX alert_deliveries_alert_idx   ON alert_deliveries (alert_id);

CREATE TRIGGER cap_alerts_updated_at
  BEFORE UPDATE ON cap_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
