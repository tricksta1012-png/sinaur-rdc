-- Migration 045 — Score de gravité numérique pour evenement_flux
-- Ajoute gravite_score (0-100), ampleur, guerre_signalee.
-- Compatible avec la logique existante (gravite TEXT reste la source de vérité UI).

ALTER TABLE evenement_flux
  ADD COLUMN IF NOT EXISTS ampleur       INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gravite_score INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guerre_signalee BOOLEAN DEFAULT false;

-- Backfill : convertir le texte existant en score approximatif
UPDATE evenement_flux
SET gravite_score = CASE
  WHEN gravite = 'CRITIQUE' THEN 75
  WHEN gravite = 'ELEVEE'   THEN 55
  ELSE 25
END
WHERE gravite_score = 0;

CREATE INDEX IF NOT EXISTS flux_gravite_score_idx
  ON evenement_flux(gravite_score DESC);

COMMENT ON COLUMN evenement_flux.gravite_score IS
  'Score 0-100 : combinaison TYPE (poids) × AMPLEUR (log) × FIABILITÉ. '
  '≥80 CRITIQUE, ≥60 ÉLEVÉE, ≥40 MODÉRÉE.';
COMMENT ON COLUMN evenement_flux.ampleur IS
  'Nombre de personnes affectées ou intensité (victimes, cas confirmés, etc.).';
COMMENT ON COLUMN evenement_flux.guerre_signalee IS
  'true si cet événement signale une activité de guerre active (sévérité 4-5).';
