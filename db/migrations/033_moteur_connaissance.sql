-- Migration 033 — Moteur de Connaissance Évolutif SINAUR-RDC
-- Graphe de connaissance : entités, relations, journal d'apprentissage

CREATE TABLE IF NOT EXISTS kb_entite (
  id                  SERIAL PRIMARY KEY,
  type_entite         TEXT NOT NULL CHECK (type_entite IN ('GROUPE_ARME','PERSONNE','LIEU','EVENEMENT','EPIDEMIE','AUTRE')),
  nom                 TEXT NOT NULL,
  noms_alternatifs    TEXT[]  DEFAULT '{}',
  description         TEXT,

  -- Fiabilité
  niveau_confiance    NUMERIC(4,3) DEFAULT 0.5 CHECK (niveau_confiance BETWEEN 0 AND 1),
  statut_connaissance TEXT    DEFAULT 'EMERGENT' CHECK (statut_connaissance IN ('EMERGENT','A_CONFIRMER','ETABLI')),
  nb_mentions         INT     DEFAULT 1,
  sources             JSONB   DEFAULT '[]',

  -- Temporalité
  premiere_mention    TIMESTAMPTZ DEFAULT NOW(),
  derniere_mention    TIMESTAMPTZ DEFAULT NOW(),
  actif               BOOLEAN DEFAULT true,

  -- Géographie
  pcode               TEXT,
  coordinates         GEOMETRY(POINT, 4326),

  -- Attributs flexibles
  attributs           JSONB DEFAULT '{}',

  cree_le             TIMESTAMPTZ DEFAULT NOW(),
  maj_le              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_entite_type_idx    ON kb_entite(type_entite);
CREATE INDEX IF NOT EXISTS kb_entite_statut_idx  ON kb_entite(statut_connaissance);
CREATE INDEX IF NOT EXISTS kb_entite_actif_idx   ON kb_entite(actif);
CREATE INDEX IF NOT EXISTS kb_entite_nom_trgm    ON kb_entite USING GIN (nom gin_trgm_ops);
CREATE INDEX IF NOT EXISTS kb_entite_fts         ON kb_entite USING GIN (to_tsvector('french', nom));


CREATE TABLE IF NOT EXISTS kb_relation (
  id               SERIAL PRIMARY KEY,
  source_id        INT NOT NULL REFERENCES kb_entite(id) ON DELETE CASCADE,
  cible_id         INT NOT NULL REFERENCES kb_entite(id) ON DELETE CASCADE,
  type_relation    TEXT NOT NULL CHECK (type_relation IN (
                     'OPERE_DANS','DIRIGE','AFFRONTE','FACTION_DE','LIE_A',
                     'IMPLIQUE_DANS','ALLIE_DE','RIVAL_DE','SUCCEDE_A'
                   )),
  niveau_confiance NUMERIC(4,3) DEFAULT 0.5,
  sources          JSONB DEFAULT '[]',
  depuis           DATE,
  jusqua           DATE,
  actif            BOOLEAN DEFAULT true,
  cree_le          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, cible_id, type_relation)
);

CREATE INDEX IF NOT EXISTS kb_relation_source_idx ON kb_relation(source_id);
CREATE INDEX IF NOT EXISTS kb_relation_cible_idx  ON kb_relation(cible_id);
CREATE INDEX IF NOT EXISTS kb_relation_type_idx   ON kb_relation(type_relation);


CREATE TABLE IF NOT EXISTS kb_apprentissage (
  id              SERIAL PRIMARY KEY,
  entite_id       INT REFERENCES kb_entite(id) ON DELETE SET NULL,
  type_action     TEXT NOT NULL CHECK (type_action IN ('DECOUVERTE','ENRICHISSEMENT','RELATION','CONFIRMATION','CORRECTION')),
  detail          TEXT NOT NULL,
  source          TEXT,
  agent           TEXT DEFAULT 'connaissance',
  confiance_avant NUMERIC(4,3),
  confiance_apres NUMERIC(4,3),
  date_appris     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_apprentissage_entite_idx ON kb_apprentissage(entite_id);
CREATE INDEX IF NOT EXISTS kb_apprentissage_date_idx   ON kb_apprentissage(date_appris DESC);
