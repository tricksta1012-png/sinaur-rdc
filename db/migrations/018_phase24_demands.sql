-- Phase 24 — Demandes d'affectation ressources ↔ sinistres

CREATE TYPE demand_status AS ENUM ('pending', 'approved', 'rejected', 'fulfilled');

-- Demandes de ressources liées à une crise
CREATE TABLE resource_demands (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  crisis_id          UUID          NOT NULL REFERENCES crisis_events(id) ON DELETE CASCADE,
  depot_id           UUID          REFERENCES resource_depots(id),
  stock_id           UUID          REFERENCES resource_stocks(id),
  resource_type      resource_type NOT NULL,
  resource_name      TEXT          NOT NULL,
  unit               TEXT          NOT NULL,
  quantity_needed    NUMERIC(14,2) NOT NULL CHECK (quantity_needed > 0),
  quantity_allocated NUMERIC(14,2),
  urgency            TEXT          NOT NULL DEFAULT 'normal'
                                   CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  status             demand_status NOT NULL DEFAULT 'pending',
  notes              TEXT,
  requested_by       UUID          REFERENCES users(id),
  reviewed_by        UUID          REFERENCES users(id),
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON resource_demands (crisis_id);
CREATE INDEX ON resource_demands (status);
CREATE INDEX ON resource_demands (depot_id);
