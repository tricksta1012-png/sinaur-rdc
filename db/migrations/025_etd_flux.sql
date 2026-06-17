-- Migration 025: flux_message — circulation bidirectionnelle de l'information
-- Flux ASCENDANT  : terrain → ETD → province → central
-- Flux DESCENDANT : central → province → ETD → population
-- Couvre toute la chaîne administrative du village jusqu'au pouvoir central.

CREATE TABLE IF NOT EXISTS flux_message (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Type de document circulant
  type_flux                 TEXT NOT NULL CHECK (
    type_flux IN ('SIGNALEMENT','ALERTE','RAPPORT','DIRECTIVE','RESSOURCE')
  ),
  direction                 TEXT NOT NULL CHECK (direction IN ('ASCENDANT','DESCENDANT')),
  -- Référence optionnelle à un objet existant (crise, événement, alerte…)
  element_id                TEXT,
  element_type              TEXT,
  -- Niveaux hiérarchiques : 1=central, 2=province, 6=ETD, 8=groupement, 10=village
  niveau_origine            INT  NOT NULL CHECK (niveau_origine BETWEEN 1 AND 10),
  niveau_destination        INT  NOT NULL CHECK (niveau_destination BETWEEN 1 AND 10),
  entite_origine_pcode      TEXT,
  entite_destination_pcode  TEXT NOT NULL,
  -- Contenu structuré du message (résumé, texte, montants, ressources…)
  contenu                   JSONB NOT NULL DEFAULT '{}',
  priorite                  INT  NOT NULL DEFAULT 1 CHECK (priorite BETWEEN 1 AND 5),
  -- Cycle de vie : TRANSMIS → RECU → ACCUSE_RECEPTION → EN_COURS → EXECUTE
  statut                    TEXT NOT NULL DEFAULT 'TRANSMIS' CHECK (
    statut IN ('TRANSMIS','RECU','ACCUSE_RECEPTION','EN_COURS','EXECUTE')
  ),
  accuse_reception_le       TIMESTAMPTZ,
  execute_le                TIMESTAMPTZ,
  created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recherche par entité destinataire + statut (cas d'usage principal)
CREATE INDEX IF NOT EXISTS idx_flux_dest_statut
  ON flux_message(entite_destination_pcode, statut);

-- Tri chronologique par direction
CREATE INDEX IF NOT EXISTS idx_flux_dir_date
  ON flux_message(direction, created_at DESC);

-- Recherche par entité origine
CREATE INDEX IF NOT EXISTS idx_flux_orig_pcode
  ON flux_message(entite_origine_pcode, direction);

-- Messages urgents non exécutés (tableau de bord)
CREATE INDEX IF NOT EXISTS idx_flux_urgents
  ON flux_message(priorite DESC, created_at DESC)
  WHERE statut NOT IN ('EXECUTE');
