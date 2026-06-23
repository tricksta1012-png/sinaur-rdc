-- Migration 027 — Table de veille des pathogènes émergents
-- Séparée des épidémies confirmées (epidemic_zone/epidemic_timeseries)
-- Un signal dans cette table n'est PAS une épidémie déclarée.
-- Il devient une alerte seulement après corroboration (sources_count >= 3)
-- et validation humaine.

CREATE TABLE IF NOT EXISTS emergence_veille (
  id                      SERIAL       PRIMARY KEY,
  pathogene               TEXT         NOT NULL,
  localisation            TEXT,
  transmission_interhumaine BOOLEAN,
  pertinence_rdc          TEXT         NOT NULL DEFAULT 'faible',
    CONSTRAINT pertinence_rdc_check CHECK (pertinence_rdc IN ('faible', 'modérée', 'élevée')),
  sources_count           INTEGER      NOT NULL DEFAULT 1,
  statut                  TEXT         NOT NULL DEFAULT 'SIGNAL_ISOLE',
    CONSTRAINT statut_check CHECK (statut IN ('SIGNAL_ISOLE', 'A_SURVEILLER', 'EMERGENCE_CORROBOREE')),
  premiere_detection      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  derniere_mention        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  detail                  JSONB        NOT NULL DEFAULT '{}',
  traite                  BOOLEAN      NOT NULL DEFAULT false,
  traite_par              TEXT,
  traite_le               TIMESTAMPTZ,
  note_validateur         TEXT
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_emergence_statut   ON emergence_veille (statut)    WHERE traite = false;
CREATE INDEX IF NOT EXISTS idx_emergence_pathogene ON emergence_veille (pathogene) WHERE traite = false;
CREATE INDEX IF NOT EXISTS idx_emergence_pertinence ON emergence_veille (pertinence_rdc) WHERE traite = false;

-- Commentaires métier
COMMENT ON TABLE emergence_veille IS
  'Signaux de pathogènes inconnus détectés par le DetecteurEmergence. '
  'statut SIGNAL_ISOLE = 1 source, prudence. '
  'A_SURVEILLER = 2 sources. '
  'EMERGENCE_CORROBOREE = 3+ sources, nécessite validation humaine. '
  'Ne jamais alimenter epidemic_zone depuis cette table sans validation.';
