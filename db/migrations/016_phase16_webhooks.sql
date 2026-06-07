-- Migration 016 : Webhooks sortants pour partenaires humanitaires

CREATE TABLE webhooks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name   TEXT        NOT NULL,
  url           TEXT        NOT NULL,
  secret        TEXT        NOT NULL,          -- Clé HMAC-SHA256 pour signature X-Sinaur-Signature
  events        TEXT[]      NOT NULL DEFAULT '{"alert.published"}',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  last_fired_at TIMESTAMPTZ,
  last_status   SMALLINT,                      -- Dernier code HTTP reçu
  failure_count INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhooks_active_idx ON webhooks (is_active) WHERE is_active = TRUE;

CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Log des appels sortants (debug + audit)
CREATE TABLE webhook_deliveries (
  id          BIGSERIAL   PRIMARY KEY,
  webhook_id  UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event       TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  status_code SMALLINT,
  duration_ms INT,
  error       TEXT,
  fired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_deliveries_wh_idx ON webhook_deliveries (webhook_id, fired_at DESC);

COMMENT ON TABLE webhooks IS
  'Webhooks sortants : notifie les partenaires humanitaires (OCHA, UNHCR, MSF…) lors des alertes.';
