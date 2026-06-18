-- Migration 026 : Cartographie administrative — responsables + statut de situation
-- Ajouter colonnes responsable + statut à admin_divisions

ALTER TABLE admin_divisions
  ADD COLUMN IF NOT EXISTS responsable_nom     TEXT,
  ADD COLUMN IF NOT EXISTS responsable_titre   TEXT,
  ADD COLUMN IF NOT EXISTS responsable_contact TEXT,
  ADD COLUMN IF NOT EXISTS statut_situation    TEXT DEFAULT 'NORMAL'
    CHECK (statut_situation IN ('NORMAL', 'VIGILANCE', 'ALERTE', 'CRISE'));

CREATE INDEX IF NOT EXISTS admin_divisions_statut_idx ON admin_divisions(statut_situation);

-- Seed responsables pour les provinces avec comptes existants (demo)
UPDATE admin_divisions SET responsable_nom = 'Gouverneur Kinshasa',
  responsable_titre = 'Gouverneur', responsable_contact = 'gouverneur.kinshasa@rdc.cd'
WHERE pcode = 'CD10' AND level = 1;

UPDATE admin_divisions SET responsable_nom = 'Gouverneur Nord-Kivu',
  responsable_titre = 'Gouverneur', responsable_contact = 'gouverneur.kivu@rdc.cd'
WHERE pcode = 'CD61' AND level = 1;
