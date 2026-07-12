-- Migration 043 — Base de Connaissance Analytique (RAG)
-- Bibliothèque documentaire + fragments avec embeddings vectoriels (pgvector)
-- Fonctionne en mode dégradé (trigram) si VOYAGE_API_KEY absent.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Documents analytiques de référence ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_document (
  id              SERIAL PRIMARY KEY,
  titre           TEXT NOT NULL,
  type_document   TEXT NOT NULL DEFAULT 'RAPPORT',  -- RAPPORT|ANALYSE|FICHE_GROUPE|NOTE_TERRAIN
  source          TEXT          DEFAULT 'INTERNE',
  url             TEXT,
  date_publication DATE,
  fiabilite       NUMERIC(3,2)  DEFAULT 0.70,
  themes          TEXT[]        DEFAULT '{}',
  contenu_brut    TEXT,
  nb_fragments    INT           DEFAULT 0,
  indexe_le       TIMESTAMPTZ,
  ajoute_le       TIMESTAMPTZ   DEFAULT NOW(),
  ajoute_par      TEXT          DEFAULT 'system'
);

-- ── Fragments avec embeddings (nullable — fonctionne sans API) ───────────────
CREATE TABLE IF NOT EXISTS kb_fragment (
  id              SERIAL PRIMARY KEY,
  document_id     INT REFERENCES kb_document(id) ON DELETE CASCADE,
  contenu         TEXT NOT NULL,
  embedding       vector(1536),   -- NULL si pas de VOYAGE_API_KEY
  position_ordre  INT             DEFAULT 0,
  themes          TEXT[]          DEFAULT '{}'
);
-- Index vectoriel (ivfflat) — ignoré si embedding NULL
CREATE INDEX IF NOT EXISTS kb_fragment_embedding_idx
  ON kb_fragment USING ivfflat (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
-- Index trigram pour la recherche en mode dégradé
CREATE INDEX IF NOT EXISTS kb_fragment_contenu_trgm_idx
  ON kb_fragment USING gin (contenu gin_trgm_ops);

-- ── Analyses RAG produites par l'agent ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_analyse (
  id                  SERIAL PRIMARY KEY,
  evenement_id        TEXT,                     -- id source (libre)
  evenement_titre     TEXT NOT NULL,
  evenement_desc      TEXT,
  source_agent        TEXT          DEFAULT 'conflit',
  analyse_brute       TEXT,                     -- réponse brute du LLM
  sources_utilisees   TEXT[]        DEFAULT '{}',
  pertinence_max      NUMERIC(4,3)  DEFAULT 0,
  fragments_utilises  INT[]         DEFAULT '{}',
  created_at          TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kb_analyse_evenement_idx ON kb_analyse (evenement_id);
CREATE INDEX IF NOT EXISTS kb_analyse_created_idx   ON kb_analyse (created_at DESC);
