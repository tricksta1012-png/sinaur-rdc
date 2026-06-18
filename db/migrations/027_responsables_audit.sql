CREATE TABLE IF NOT EXISTS responsable_history (
  id          SERIAL PRIMARY KEY,
  pcode       TEXT NOT NULL,
  entity_name TEXT,
  ancien_nom  TEXT, ancien_titre TEXT, ancien_contact TEXT,
  nouveau_nom TEXT, nouveau_titre TEXT, nouveau_contact TEXT,
  modifie_par TEXT NOT NULL,
  modifie_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_info TEXT,
  action      TEXT NOT NULL CHECK (action IN ('CREATION','MODIFICATION','SUPPRESSION'))
);
CREATE INDEX IF NOT EXISTS responsable_history_pcode_idx ON responsable_history(pcode);
CREATE INDEX IF NOT EXISTS responsable_history_date_idx ON responsable_history(modifie_le DESC);

ALTER TABLE admin_divisions
  ADD COLUMN IF NOT EXISTS responsable_source  TEXT,
  ADD COLUMN IF NOT EXISTS responsable_maj_par TEXT,
  ADD COLUMN IF NOT EXISTS responsable_maj_le  TIMESTAMPTZ;
