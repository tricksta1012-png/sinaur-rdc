-- Phase 19 — Ressources & Stocks humanitaires

CREATE TYPE resource_type AS ENUM (
  'food', 'water', 'medicine', 'shelter_kit', 'nfi',
  'hygiene_kit', 'fuel', 'equipment', 'other'
);

CREATE TYPE movement_type AS ENUM ('in', 'out', 'transfer', 'adjustment');

-- Dépôts / entrepôts humanitaires
CREATE TABLE resource_depots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  pcode         TEXT NOT NULL,
  address       TEXT,
  manager_id    UUID REFERENCES users(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stocks disponibles par dépôt
CREATE TABLE resource_stocks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id             UUID NOT NULL REFERENCES resource_depots(id) ON DELETE CASCADE,
  resource_type        resource_type NOT NULL,
  resource_name        TEXT NOT NULL,
  unit                 TEXT NOT NULL,
  quantity_available   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  quantity_reserved    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  minimum_threshold    NUMERIC(14,2) NOT NULL DEFAULT 0,
  crisis_id            UUID REFERENCES crises(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (depot_id, resource_name)
);

-- Mouvements de stock (entrées, sorties, transferts, ajustements)
CREATE TABLE resource_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id        UUID NOT NULL REFERENCES resource_depots(id),
  stock_id        UUID NOT NULL REFERENCES resource_stocks(id),
  movement_type   movement_type NOT NULL,
  quantity        NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  reason          TEXT,
  reference_id    UUID, -- lien optionnel vers distribution ou crise
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON resource_depots (pcode);
CREATE INDEX ON resource_stocks (depot_id);
CREATE INDEX ON resource_stocks (resource_type);
CREATE INDEX ON resource_movements (depot_id, created_at DESC);
CREATE INDEX ON resource_movements (stock_id, created_at DESC);
