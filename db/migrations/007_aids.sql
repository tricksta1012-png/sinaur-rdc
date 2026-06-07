-- Migration 007: Gestion des aides humanitaires avec traçabilité QR

CREATE TYPE aid_type AS ENUM (
  'food', 'medicine', 'shelter', 'school_kit', 'hygiene_kit',
  'cash_transfer', 'nfi', 'water_sanitation', 'protection', 'other'
);

CREATE TYPE aid_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');

CREATE TABLE aid_distributions (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_event_id             UUID        REFERENCES disaster_events(id),
  aid_type                      aid_type    NOT NULL,
  description                   TEXT        NOT NULL DEFAULT '',
  quantity                      FLOAT8      NOT NULL,
  unit                          TEXT        NOT NULL,
  status                        aid_status  NOT NULL DEFAULT 'planned',
  target_pcodes                 TEXT[]      NOT NULL DEFAULT '{}',
  planned_date                  TIMESTAMPTZ NOT NULL,
  completed_date                TIMESTAMPTZ,
  organization_name             TEXT        NOT NULL,
  responsible_agent_id          UUID        NOT NULL REFERENCES users(id),
  total_beneficiaries_targeted  INTEGER     NOT NULL DEFAULT 0,
  total_beneficiaries_served    INTEGER     NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE aid_receipts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id   UUID        NOT NULL REFERENCES aid_distributions(id),
  beneficiary_id    UUID        NOT NULL REFERENCES beneficiaries(id),
  qr_code_scanned   TEXT        NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  distributed_by_id UUID        NOT NULL REFERENCES users(id),
  digital_signature TEXT        NOT NULL,
  quantity          FLOAT8      NOT NULL DEFAULT 1,
  notes             TEXT,
  sync_status       TEXT        NOT NULL DEFAULT 'synced',
  client_created_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Contrainte métier : un bénéficiaire ne reçoit pas deux fois la même aide
  -- pour la même distribution
  UNIQUE (distribution_id, beneficiary_id)
);

CREATE INDEX aid_distributions_event_idx    ON aid_distributions (disaster_event_id);
CREATE INDEX aid_distributions_pcodes_idx   ON aid_distributions USING GIN (target_pcodes);
CREATE INDEX aid_receipts_distribution_idx  ON aid_receipts (distribution_id);
CREATE INDEX aid_receipts_beneficiary_idx   ON aid_receipts (beneficiary_id);
CREATE INDEX aid_receipts_qr_idx            ON aid_receipts (qr_code_scanned);

CREATE TRIGGER aid_distributions_updated_at
  BEFORE UPDATE ON aid_distributions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
