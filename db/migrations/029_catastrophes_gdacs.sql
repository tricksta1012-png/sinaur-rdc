-- Migration 029 — Table des catastrophes naturelles (flux GDACS)
-- GDACS = Global Disaster Alert and Coordination System (ONU + Commission européenne)
-- Séparée de crisis_events : une catastrophe_naturelle peut ou non générer une crise SINAUR.
-- La remontée en crise se fait par l'AgentCatastrophes (Orange/Red sur sol RDC seulement).

CREATE TABLE IF NOT EXISTS catastrophe_naturelle (
  id                   SERIAL        PRIMARY KEY,
  gdacs_id             TEXT          NOT NULL UNIQUE,   -- identifiant GDACS (évite les doublons)
  type_code            TEXT          NOT NULL,           -- EQ, TC, FL, VO, DR, WF, TS
  type_label           TEXT          NOT NULL,
  hazard_type          TEXT          NOT NULL,           -- valeur de l'enum hazard_type PostgreSQL
  titre                TEXT          NOT NULL,
  pays                 TEXT,
  province_pcode       TEXT          REFERENCES admin_divisions(pcode),  -- null si hors RDC
  niveau_alerte_gdacs  TEXT          NOT NULL DEFAULT 'Green',
    CONSTRAINT niveau_gdacs_check CHECK (niveau_alerte_gdacs IN ('Green', 'Orange', 'Red')),
  statut_sinaur        TEXT          NOT NULL DEFAULT 'VIGILANCE',
    CONSTRAINT statut_sinaur_check CHECK (statut_sinaur IN ('VIGILANCE', 'ALERTE', 'CRISE')),
  severite             NUMERIC,
  population_affectee  INTEGER,
  coordinates          GEOMETRY(POINT, 4326),
  date_debut           TIMESTAMPTZ,
  date_maj             TIMESTAMPTZ,
  source_url           TEXT,
  actif                BOOLEAN       NOT NULL DEFAULT true,
  cree_le              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index géospatial pour les requêtes de proximité (Nyiragongo, etc.)
CREATE INDEX IF NOT EXISTS idx_catastrophe_geo     ON catastrophe_naturelle USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx_catastrophe_actif   ON catastrophe_naturelle(actif) WHERE actif = true;
CREATE INDEX IF NOT EXISTS idx_catastrophe_niveau  ON catastrophe_naturelle(niveau_alerte_gdacs) WHERE actif = true;
CREATE INDEX IF NOT EXISTS idx_catastrophe_province ON catastrophe_naturelle(province_pcode) WHERE province_pcode IS NOT NULL;

COMMENT ON TABLE catastrophe_naturelle IS
  'Événements GDACS filtrés pour la RDC et les pays voisins. '
  'Seuls les événements Orange/Red sur sol RDC génèrent une crise SINAUR (via AgentCatastrophes). '
  'Les événements voisins restent en veille pour le contexte régional.';
