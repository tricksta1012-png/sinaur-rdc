-- Migration 022 — Tables de surveillance épidémique par zone de santé
-- Séparées des risk_predictions (qui font du scoring au niveau province)

CREATE TABLE IF NOT EXISTS epidemic_zone (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  maladie               TEXT        NOT NULL,
  souche                TEXT,
  zone_sante            TEXT        NOT NULL,
  territoire            TEXT        NOT NULL,
  province              TEXT        NOT NULL,
  p_code                TEXT        NOT NULL,
  coordinates           GEOMETRY(POINT, 4326),
  cas_confirmes         INTEGER     NOT NULL DEFAULT 0,
  cas_suspects          INTEGER     NOT NULL DEFAULT 0,
  deces_confirmes       INTEGER     NOT NULL DEFAULT 0,
  deces_suspects        INTEGER     NOT NULL DEFAULT 0,
  statut                TEXT        NOT NULL DEFAULT 'ACTIF',
  date_premier_cas      DATE        NOT NULL,
  derniere_mise_a_jour  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  groupes_armes_actifs  JSONB       NOT NULL DEFAULT '{}',
  acces_humanitaire     TEXT        NOT NULL DEFAULT 'BON',
  source                TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS epidemic_timeseries (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  maladie                  TEXT        NOT NULL,
  souche                   TEXT,
  date_rapport             DATE        NOT NULL,
  cas_confirmes_cumul      INTEGER     NOT NULL DEFAULT 0,
  cas_suspects_cumul       INTEGER     NOT NULL DEFAULT 0,
  deces_confirmes_cumul    INTEGER     NOT NULL DEFAULT 0,
  deces_suspects_cumul     INTEGER     NOT NULL DEFAULT 0,
  nouvelles_zones          INTEGER     NOT NULL DEFAULT 0,
  source                   TEXT        NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epzone_maladie        ON epidemic_zone(maladie);
CREATE INDEX IF NOT EXISTS idx_epzone_province       ON epidemic_zone(province);
CREATE INDEX IF NOT EXISTS idx_epzone_statut         ON epidemic_zone(statut);
CREATE INDEX IF NOT EXISTS idx_epzone_coords         ON epidemic_zone USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx_epts_maladie_date     ON epidemic_timeseries(maladie, date_rapport);
