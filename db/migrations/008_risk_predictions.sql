-- Migration 008: Prévisions de risque (sorties du service IA)

CREATE TYPE risk_horizon AS ENUM ('7d', '30d', '90d');

CREATE TABLE risk_predictions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  pcode           TEXT          NOT NULL REFERENCES admin_divisions(pcode),
  hazard_type     hazard_type   NOT NULL,
  horizon         risk_horizon  NOT NULL,
  score           SMALLINT      NOT NULL CHECK (score BETWEEN 0 AND 100),
  level           TEXT          NOT NULL CHECK (level IN ('low', 'medium', 'high', 'critical')),
  model_version   TEXT          NOT NULL,
  predicted_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valid_from      TIMESTAMPTZ   NOT NULL,
  valid_until     TIMESTAMPTZ   NOT NULL,
  -- Explicabilité : facteurs contributifs (obligatoire)
  contributing_factors JSONB    NOT NULL DEFAULT '[]',
  uncertainty     FLOAT8        NOT NULL CHECK (uncertainty BETWEEN 0 AND 1),
  -- Performance a posteriori
  actual_occurred BOOLEAN,
  evaluated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Vue matérialisée : dernier score de risque par zone (rafraîchie par le service IA)
CREATE MATERIALIZED VIEW current_risk_scores AS
  SELECT DISTINCT ON (pcode, hazard_type, horizon)
    pcode, hazard_type, horizon, score, level,
    uncertainty, contributing_factors, predicted_at, valid_until
  FROM risk_predictions
  WHERE valid_until > NOW()
  ORDER BY pcode, hazard_type, horizon, predicted_at DESC;

CREATE UNIQUE INDEX current_risk_scores_idx
  ON current_risk_scores (pcode, hazard_type, horizon);

CREATE INDEX risk_predictions_pcode_idx      ON risk_predictions (pcode, hazard_type, horizon);
CREATE INDEX risk_predictions_predicted_idx  ON risk_predictions (predicted_at DESC);
CREATE INDEX risk_predictions_valid_idx      ON risk_predictions (valid_from, valid_until);

COMMENT ON TABLE risk_predictions IS
  'Prévisions du service IA. Chaque prédiction expose les facteurs contributifs '
  '(contributing_factors) pour permettre aux décideurs de comprendre POURQUOI '
  'une zone est signalée à risque. Les alertes critiques nécessitent une validation '
  'humaine avant diffusion (is_issued_by_ai + validated_by dans cap_alerts).';
