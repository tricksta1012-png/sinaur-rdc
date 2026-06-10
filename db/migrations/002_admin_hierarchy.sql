-- Migration 002: Hiérarchie administrative RDC (P-codes OCHA COD-AB)
-- Niveaux : 0=Pays, 1=Province, 2=Ville/Territoire, 3=Commune/Secteur/Chefferie,
--           4=Groupement, 5=Quartier/Village, 6=Localité

CREATE TABLE admin_divisions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pcode         TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  name_fr       TEXT        NOT NULL,
  name_local    TEXT,
  level         SMALLINT    NOT NULL CHECK (level BETWEEN 0 AND 6),
  parent_pcode  TEXT        REFERENCES admin_divisions(pcode),
  parent_id     UUID        REFERENCES admin_divisions(id),
  centroid      JSONB,   -- GeoJSON Point { type, coordinates }
  geometry      JSONB,   -- GeoJSON MultiPolygon
  bbox          FLOAT8[4],  -- [west, south, east, north]
  population    INTEGER,
  area_km2      FLOAT8,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour navigation hiérarchique
CREATE INDEX admin_divisions_level_idx       ON admin_divisions (level);
CREATE INDEX admin_divisions_parent_pcode_idx ON admin_divisions (parent_pcode);
CREATE INDEX admin_divisions_pcode_idx       ON admin_divisions (pcode);

-- Index de recherche full-text
CREATE INDEX admin_divisions_name_trgm_idx ON admin_divisions USING GIN (name_fr gin_trgm_ops);

CREATE TRIGGER admin_divisions_updated_at
  BEFORE UPDATE ON admin_divisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE admin_divisions IS
  'Référentiel géographique officiel RDC — P-codes OCHA COD-AB. '
  'Source : https://data.humdata.org/dataset/cod-ab-cod . '
  'Ne pas modifier manuellement : alimenté par le script d''import COD-AB.';
