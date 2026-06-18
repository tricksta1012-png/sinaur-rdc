-- Migration 028: Tables de gestion collaborative des rues et voies nommées

CREATE TABLE IF NOT EXISTS rue (
  id                 SERIAL PRIMARY KEY,
  nom                TEXT NOT NULL,
  noms_alternatifs   TEXT[] DEFAULT '{}',
  type_voie          TEXT NOT NULL DEFAULT 'rue'
                       CHECK (type_voie IN ('rue', 'avenue', 'boulevard', 'route', 'chemin', 'impasse', 'allée', 'passage', 'autre')),
  quartier_pcode     TEXT,
  commune_pcode      TEXT,
  geometry           GEOMETRY(LINESTRING, 4326),
  centroid           GEOMETRY(POINT, 4326),
  source             TEXT NOT NULL DEFAULT 'AGENT_TERRAIN'
                       CHECK (source IN ('AGENT_TERRAIN', 'OSM', 'VALIDATION_CROISEE')),
  osm_id             BIGINT,
  statut_validation  TEXT NOT NULL DEFAULT 'PROPOSE'
                       CHECK (statut_validation IN ('PROPOSE', 'VALIDE', 'REJETE')),
  cree_par           TEXT,
  cree_le            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valide_par         TEXT,
  valide_le          TIMESTAMPTZ,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS rue_commune_pcode_idx     ON rue(commune_pcode)     WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS rue_quartier_pcode_idx    ON rue(quartier_pcode)    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS rue_statut_idx            ON rue(statut_validation) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS rue_nom_idx               ON rue(nom)               WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS rue_geometry_idx          ON rue USING GIST(geometry);
CREATE INDEX IF NOT EXISTS rue_centroid_idx          ON rue USING GIST(centroid);

-- ── Historique des modifications ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rue_history (
  id           SERIAL PRIMARY KEY,
  rue_id       INTEGER NOT NULL REFERENCES rue(id) ON DELETE CASCADE,
  action       TEXT NOT NULL
                 CHECK (action IN ('AJOUT', 'RENOMMAGE', 'CORRECTION_TRACE', 'VALIDATION', 'REJET', 'SUPPRESSION')),
  ancien_nom   TEXT,
  nouveau_nom  TEXT,
  modifie_par  TEXT NOT NULL,
  modifie_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  motif        TEXT
);

CREATE INDEX IF NOT EXISTS rue_history_rue_id_idx ON rue_history(rue_id);
CREATE INDEX IF NOT EXISTS rue_history_date_idx   ON rue_history(modifie_le DESC);

-- ── Signalements terrain ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rue_signalement (
  id           SERIAL PRIMARY KEY,
  rue_id       INTEGER NOT NULL REFERENCES rue(id) ON DELETE CASCADE,
  probleme     TEXT NOT NULL,
  suggestion   TEXT,
  signale_par  TEXT NOT NULL,
  signale_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  statut       TEXT NOT NULL DEFAULT 'A_TRAITER'
                 CHECK (statut IN ('A_TRAITER', 'TRAITE', 'IGNORE'))
);

CREATE INDEX IF NOT EXISTS rue_signalement_rue_id_idx ON rue_signalement(rue_id);
CREATE INDEX IF NOT EXISTS rue_signalement_statut_idx ON rue_signalement(statut);
