-- Migration 020: Provincial coordinator role + IDP checkpoints
-- Adds provincial_coordinator role and idp_checkpoints/idp_flows tables.
-- Note: audit_log already exists from migration 003_users_rbac.sql.

-- ── 1. Add provincial_coordinator to user_role enum ───────────────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'provincial_coordinator';

-- ── 2. IDP Checkpoints ─────────────────────────────────────────────────────────
-- Named checkpoints (routes, borders, transit sites)
CREATE TABLE IF NOT EXISTS idp_checkpoints (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT         NOT NULL,
  province_pcode  TEXT         NOT NULL,
  province_name   TEXT         NOT NULL,
  checkpoint_type TEXT         NOT NULL DEFAULT 'route'
                               CHECK (checkpoint_type IN ('route', 'border', 'transit_site', 'reception_center')),
  location_point  GEOMETRY(Point, 4326),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idp_checkpoints_province_idx ON idp_checkpoints (province_pcode);

-- ── 4. IDP Flows ───────────────────────────────────────────────────────────────
-- Directional flux registrations at each checkpoint
CREATE TABLE IF NOT EXISTS idp_flows (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id       UUID         REFERENCES idp_checkpoints(id) ON DELETE SET NULL,
  checkpoint_name     TEXT         NOT NULL,  -- denormalized for easy query
  province_pcode      TEXT         NOT NULL,
  direction           TEXT         NOT NULL CHECK (direction IN ('entrant', 'sortant')),
  count               INTEGER      NOT NULL CHECK (count >= 0),
  flow_date           DATE         NOT NULL DEFAULT CURRENT_DATE,
  origin_province     TEXT,        -- where people are coming from (if known)
  destination         TEXT,        -- where they are going (if known)
  notes               TEXT,
  recorded_by_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idp_flows_province_idx    ON idp_flows (province_pcode, flow_date DESC);
CREATE INDEX IF NOT EXISTS idp_flows_checkpoint_idx  ON idp_flows (checkpoint_id, flow_date DESC);
CREATE INDEX IF NOT EXISTS idp_flows_date_idx        ON idp_flows (flow_date DESC);
