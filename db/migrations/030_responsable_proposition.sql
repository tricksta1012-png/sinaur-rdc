-- Table des propositions détectées par l'agent veille presse
CREATE TABLE IF NOT EXISTS responsable_proposition (
  id              SERIAL PRIMARY KEY,
  pcode           TEXT REFERENCES admin_divisions(pcode),  -- null si ENTITE_INTROUVABLE
  entite_nom      TEXT,              -- nom brut détecté dans l'article
  personne        TEXT NOT NULL,
  fonction        TEXT,
  type_acte       TEXT,              -- 'Arrêté ministériel', 'Ordonnance', 'Presse'
  date_acte       DATE,
  interimaire     BOOLEAN DEFAULT false,
  remplace        TEXT,
  source          TEXT,              -- identifiant de la source presse
  url_article     TEXT,
  confiance       NUMERIC,           -- 0.0–1.0, confiance de l'IA
  statut_rapprochement TEXT DEFAULT 'CERTAIN',
    CONSTRAINT srp_check CHECK (statut_rapprochement IN ('CERTAIN','AMBIGU','ENTITE_INTROUVABLE')),
  candidats       JSONB,             -- si AMBIGU, liste [{pcode, name, level}]
  statut          TEXT DEFAULT 'A_VALIDER',
    CONSTRAINT sp_check CHECK (statut IN ('A_VALIDER','VALIDE','REJETE')),
  valide_par      TEXT,
  valide_le       TIMESTAMPTZ,
  detecte_le      TIMESTAMPTZ DEFAULT NOW(),
  detail          JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_rp_statut    ON responsable_proposition(statut) WHERE statut = 'A_VALIDER';
CREATE INDEX IF NOT EXISTS idx_rp_pcode     ON responsable_proposition(pcode) WHERE pcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rp_detecte   ON responsable_proposition(detecte_le DESC);

-- Table des arrêtés/documents de nomination
CREATE TABLE IF NOT EXISTS responsable_arrete (
  id           SERIAL PRIMARY KEY,
  pcode        TEXT REFERENCES admin_divisions(pcode),
  personne     TEXT,
  type_acte    TEXT,
  numero_acte  TEXT,
  date_acte    DATE,
  autorite     TEXT,
  document_url TEXT,
  source       TEXT,
  ajoute_le    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ra_pcode ON responsable_arrete(pcode);
