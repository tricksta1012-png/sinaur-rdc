-- Migration 037 : Registre des médias locaux RDC
-- Répertoire des radios, TV, journaux et médias web par province,
-- avec rattachement aux collectifs (FRPC, CORACON, RATECO…) et score de fiabilité.

CREATE TABLE IF NOT EXISTS media_local (
  id               SERIAL       PRIMARY KEY,
  nom              TEXT         NOT NULL,
  type_media       TEXT         NOT NULL DEFAULT 'radio',
    -- radio | tv | journal | web | agence | autre
  province_pcode   TEXT,
    -- pcode niveau 1 (ex: CD61 = Nord-Kivu) ; NULL = national
  territoire_pcode TEXT,
    -- pcode niveau 2 ou 3 si connu
  collectif        TEXT,
    -- FRPC | CORACON | RATECO | ARCO | CJI | AEJIK | AFEMEK | PAMOJA | autre
  url              TEXT,
  type_acces       TEXT         NOT NULL DEFAULT 'web',
    -- rss | web | facebook | telegram | manuel
  fiabilite        NUMERIC(3,2) NOT NULL DEFAULT 0.60
    CHECK (fiabilite BETWEEN 0.00 AND 1.00),
  notes_fiabilite  TEXT,
    -- POURQUOI ce score : indépendance, charte déontologique, historique, etc.
  statut           TEXT         NOT NULL DEFAULT 'ACTIF'
    CHECK (statut IN ('ACTIF', 'SUSPENDU', 'DETRUIT', 'COMPROMIS', 'INCONNU')),
    -- COMPROMIS = sous contrôle armé ou propagande confirmée
  langue           TEXT         NOT NULL DEFAULT 'fr',
  contact          TEXT,
  notes            TEXT,
  ajoute_par       TEXT,
  cree_le          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  mis_a_jour_le    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_local_province_idx   ON media_local (province_pcode);
CREATE INDEX IF NOT EXISTS media_local_statut_idx     ON media_local (statut);
CREATE INDEX IF NOT EXISTS media_local_collectif_idx  ON media_local (collectif);
CREATE INDEX IF NOT EXISTS media_local_type_idx       ON media_local (type_media);

CREATE OR REPLACE FUNCTION update_mis_a_jour_le()
RETURNS TRIGGER AS $$
BEGIN
  NEW.mis_a_jour_le = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_local_updated_at ON media_local;
CREATE TRIGGER media_local_updated_at
  BEFORE UPDATE ON media_local
  FOR EACH ROW EXECUTE FUNCTION update_mis_a_jour_le();

-- ── Pré-remplissage — médias identifiés dans le document stratégique ──────────

INSERT INTO media_local
  (nom, type_media, province_pcode, territoire_pcode, collectif, url, type_acces,
   fiabilite, notes_fiabilite, statut, langue, notes)
VALUES
  ('Radio Okapi',
   'radio', NULL, NULL, NULL,
   'https://www.radiookapi.net/feed', 'rss',
   0.85,
   'Radio ONU — indépendance éditoriale garantie, couverture nationale avec correspondants par territoire, RSS disponible. Source pivot pour corroborer les autres.',
   'ACTIF', 'fr',
   'Réseau national. Rubrique par territoire. À intégrer EN PREMIER.'),

  ('RTCT — Radio Télévision Communautaire Tayna',
   'radio', 'CD61', NULL, NULL,
   'https://www.radiotayna.com', 'web',
   0.60,
   'Radio communautaire active à Goma, Nord-Kivu. Statut éditorial à vérifier dans le contexte de la crise 2024.',
   'INCONNU', 'fr',
   'Siège Goma. À évaluer — vérifier indépendance vis-à-vis des acteurs armés.'),

  ('Radio Ngoma ya Amani',
   'radio', 'CD62', NULL, NULL,
   NULL, 'manuel',
   0.60,
   'Radio communautaire zone Fizi/Baraka (Sud-Kivu). URL à confirmer.',
   'INCONNU', 'sw',
   'Zone Fizi/Baraka. URL non encore trouvée.'),

  ('Radio Mukangi',
   'radio', 'CD62', NULL, NULL,
   NULL, 'manuel',
   0.60,
   'Radio communautaire zone Baraka (Sud-Kivu). URL à confirmer.',
   'INCONNU', 'sw',
   'Zone Baraka. URL non encore trouvée.'),

  ('Kivu Morning Post',
   'web', 'CD61', NULL, NULL,
   'https://kivumornningpost.com/feed', 'rss',
   0.80,
   'Web-journal d''investigation spécialisé Nord-Kivu. RSS disponible. Couverture sécuritaire sérieuse.',
   'ACTIF', 'fr',
   NULL)

ON CONFLICT DO NOTHING;

COMMENT ON TABLE media_local IS
  'Registre des médias locaux RDC par province. '
  'Statut COMPROMIS = média sous contrôle armé ou propagande — ne pas utiliser comme source. '
  'Score fiabilité : 0.75-0.90 = établi+indépendant, 0.50-0.70 = sérieux mais limité, 0.30-0.45 = proche d''un acteur.';
