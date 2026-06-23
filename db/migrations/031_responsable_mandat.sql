-- Historique des mandats successifs pour chaque entité administrative
CREATE TABLE IF NOT EXISTS responsable_mandat (
  id          SERIAL PRIMARY KEY,
  pcode       TEXT NOT NULL REFERENCES admin_divisions(pcode),
  personne    TEXT NOT NULL,
  fonction    TEXT,
  date_debut  DATE,
  date_fin    DATE,                -- NULL = mandat en cours
  interimaire BOOLEAN DEFAULT false,
  source      TEXT,
  url_source  TEXT,
  confiance   NUMERIC,
  statut      TEXT NOT NULL DEFAULT 'HISTORIQUE',
    CONSTRAINT mandat_statut_check CHECK (statut IN ('HISTORIQUE','ACTUEL','A_VALIDER')),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mandat_pcode   ON responsable_mandat(pcode);
CREATE INDEX IF NOT EXISTS idx_mandat_actuel  ON responsable_mandat(pcode) WHERE statut = 'ACTUEL';

-- Traçabilité de l'origine et du consentement du contact
ALTER TABLE admin_divisions
  ADD COLUMN IF NOT EXISTS contact_origine    TEXT,
  ADD COLUMN IF NOT EXISTS contact_verifie    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_verifie_le TIMESTAMPTZ;

COMMENT ON TABLE responsable_mandat IS
  'Succession chronologique des responsables pour chaque entité administrative. '
  'Alimentée par l''agent veille presse (historique) et par la validation des propositions.';
