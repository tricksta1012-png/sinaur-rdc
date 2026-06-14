-- Migration 023 — Champs création automatique des crises (AutoCrisisEngine)

ALTER TABLE crisis_events
  ADD COLUMN IF NOT EXISTS pending_validation BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confidence_score   FLOAT,
  ADD COLUMN IF NOT EXISTS sources_detection  JSONB       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS truth_filter_data  JSONB;

-- Index partiel pour récupérer rapidement les crises en attente de validation humaine
CREATE INDEX IF NOT EXISTS idx_crises_pending
  ON crisis_events(pending_validation, created_at DESC)
  WHERE pending_validation = TRUE;
