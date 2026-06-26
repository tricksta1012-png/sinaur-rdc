-- Migration 034: Prévisions de conflit VIEWS + évaluation a posteriori

-- Prévisions par grille PRIO-GRID (55×55km), rattachées aux provinces RDC
CREATE TABLE IF NOT EXISTS prevision_conflit (
  id               SERIAL       PRIMARY KEY,
  source           TEXT         NOT NULL DEFAULT 'VIEWS',
  province_pcode   TEXT,                  -- COD-AB (CD61, CD62…)
  pred_pcode       TEXT,                  -- format prédiction (CD-NK, CD-SK…)
  province_nom     TEXT,
  zone_grid        TEXT         NOT NULL, -- identifiant PRIO-GRID
  coordinates      GEOMETRY(POINT, 4326),
  morts_predites   NUMERIC,               -- fatalities best-estimate (total)
  probabilite      NUMERIC,               -- probabilité de conflit [0-1]
  horizon_mois     INT          NOT NULL, -- horizon en mois depuis maintenant
  mois_cible       DATE         NOT NULL, -- mois auquel s'applique la prévision
  type_violence    TEXT         NOT NULL DEFAULT 'total',
    -- 'state_based' | 'non_state' | 'one_sided' | 'total'
  evaluee          BOOLEAN      NOT NULL DEFAULT false,
  recupere_le      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (source, zone_grid, mois_cible, type_violence)
);

CREATE INDEX IF NOT EXISTS prevision_conflit_province_idx
  ON prevision_conflit (province_pcode, horizon_mois);
CREATE INDEX IF NOT EXISTS prevision_conflit_pred_pcode_idx
  ON prevision_conflit (pred_pcode, horizon_mois);
CREATE INDEX IF NOT EXISTS prevision_conflit_mois_idx
  ON prevision_conflit (mois_cible);
CREATE INDEX IF NOT EXISTS prevision_conflit_geo_idx
  ON prevision_conflit USING GIST (coordinates)
  WHERE coordinates IS NOT NULL;

-- Évaluation a posteriori : prévision vs réalité
CREATE TABLE IF NOT EXISTS evaluation_prediction (
  id                  SERIAL      PRIMARY KEY,
  prevision_source    TEXT        NOT NULL,
  province_pcode      TEXT,
  pred_pcode          TEXT,
  mois_cible          DATE        NOT NULL,
  morts_predites      NUMERIC,
  morts_reels         NUMERIC,
  incidents_reels     INT,
  erreur_absolue      NUMERIC,
  prediction_correcte BOOLEAN,
  methode_evaluation  TEXT,       -- 'threshold_5' | 'continuous_mae' | …
  evaluee_le          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evaluation_pred_province_idx
  ON evaluation_prediction (province_pcode, mois_cible);

COMMENT ON TABLE prevision_conflit IS
  'Prévisions de conflit par grille PRIO-GRID (55×55km) issues de VIEWS '
  '(Uppsala University / PRIO). Prévisions, pas des incidents réels. '
  'Rattachées aux provinces RDC par bounding-box approximatif.';

COMMENT ON TABLE evaluation_prediction IS
  'Évaluation a posteriori des prévisions : compare ce qui était prédit '
  'à ce qui est arrivé réellement (incidents ACLED/UCDP). '
  'Alimente le tableau de bord de fiabilité (principe VIEWS de transparence).';
