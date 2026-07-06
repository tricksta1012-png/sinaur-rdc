-- Migration 041 : Table pivot evenement_flux + collecte prioritaire
-- Tous les agents (Renseignement, GDACS, Épidémie, Terrain) alimentent
-- cette table. Toutes les pages lisent depuis cette table.
-- Fiabilité visible = garde-fou visuel (confirmé vs à corroborer).

-- ── Table principale ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evenement_flux (
  id                SERIAL PRIMARY KEY,

  -- Origine
  source_agent      TEXT NOT NULL,
    -- RENSEIGNEMENT | GDACS | EPIDEMIE | TERRAIN | ALERTE_PRECOCE | CATASTROPHE
  type_evenement    TEXT NOT NULL,
    -- CONFLIT | CATASTROPHE | EPIDEMIE | SECURITE | HUMANITAIRE | AUTRE
  titre             TEXT NOT NULL,
  description       TEXT,

  -- Géolocalisation
  province_pcode    TEXT REFERENCES admin_divisions(pcode) ON DELETE SET NULL,
  territoire_pcode  TEXT,
  lat               DOUBLE PRECISION,
  lon               DOUBLE PRECISION,

  -- Fiabilité (VISIBLE dans l'interface partout)
  fiabilite         NUMERIC(3,2) DEFAULT 0.50
    CHECK (fiabilite BETWEEN 0 AND 1),
  statut_verification TEXT NOT NULL DEFAULT 'A_CORROBORER'
    CHECK (statut_verification IN ('A_CORROBORER','PROBABLE','CORROBORE','INFIRME')),
  sources           JSONB    DEFAULT '[]',
  nb_sources        INTEGER  DEFAULT 1,

  -- Gravité & impact
  gravite           TEXT NOT NULL DEFAULT 'NORMALE'
    CHECK (gravite IN ('NORMALE','ELEVEE','CRITIQUE')),
  impacte_statut    BOOLEAN  DEFAULT false,
    -- true seulement si CORROBORE|PROBABLE ET ELEVEE|CRITIQUE → colore la province

  -- Source d'origine
  source_url        TEXT,
  source_externe_id TEXT,  -- clé de déduplication (par source_agent)

  -- Horodatage
  date_evenement    TIMESTAMPTZ,
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  maj_le            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Déduplication par source
CREATE UNIQUE INDEX IF NOT EXISTS flux_dedup_idx
  ON evenement_flux(source_agent, source_externe_id)
  WHERE source_externe_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS flux_province_idx ON evenement_flux(province_pcode);
CREATE INDEX IF NOT EXISTS flux_statut_idx   ON evenement_flux(statut_verification);
CREATE INDEX IF NOT EXISTS flux_date_idx     ON evenement_flux(date_evenement DESC);
CREATE INDEX IF NOT EXISTS flux_type_idx     ON evenement_flux(type_evenement);
CREATE INDEX IF NOT EXISTS flux_gravite_idx  ON evenement_flux(gravite) WHERE gravite IN ('ELEVEE','CRITIQUE');

-- ── source_collecte : collecte rapide + cache ────────────────────────────────

ALTER TABLE source_collecte
  ADD COLUMN IF NOT EXISTS priorite TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (priorite IN ('PRIORITAIRE','STANDARD','LENTE')),
  ADD COLUMN IF NOT EXISTS dernier_item_traite TEXT;
    -- dernier external_id traité → cache anti-retraitement

-- Sources prioritaires → collecte 5 min
UPDATE source_collecte SET priorite = 'PRIORITAIRE'
WHERE connector_id IN ('radio_okapi','kmp_rss','kmp_youtube','acled_deep')
   OR (categorie IN ('CONFLIT','SECURITE') AND frequence_minutes <= 180);

-- Sources lentes → collecte 6h
UPDATE source_collecte SET priorite = 'LENTE'
WHERE frequence_minutes >= 720
   OR connector_id IN ('ucdp','ocha_hdx','fews_net','views','gdacs_cat');

COMMENT ON TABLE evenement_flux IS
  'Table pivot SINAUR-RDC — tous les événements de tous les agents convergent ici. '
  'Cartographie, Surveillance Conflits, Salle Ops lisent cette table. '
  'impacte_statut=true seulement si corroboré ET grave (évite les faux positifs).';
