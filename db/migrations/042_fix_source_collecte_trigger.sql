-- Migration 042 : Correction trigger source_collecte + priorités collecte rapide
-- Le trigger source_collecte_updated_at appelait update_updated_at() qui référence
-- NEW.updated_at, mais la colonne est mis_a_jour_le → erreur lors des UPDATE.
-- On remplace le trigger par une fonction dédiée.

-- Fonction dédiée pour source_collecte
CREATE OR REPLACE FUNCTION update_source_collecte_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.mis_a_jour_le = NOW();
  RETURN NEW;
END;
$$;

-- Remplacer le trigger défaillant
DROP TRIGGER IF EXISTS source_collecte_updated_at ON source_collecte;
CREATE TRIGGER source_collecte_updated_at
  BEFORE UPDATE ON source_collecte
  FOR EACH ROW EXECUTE FUNCTION update_source_collecte_ts();

-- Réappliquer les priorités qui avaient échoué en migration 041
UPDATE source_collecte SET priorite = 'PRIORITAIRE'
WHERE connector_id IN ('radio_okapi','kmp_rss','kmp_youtube','acled_deep')
   OR (categorie IN ('CONFLIT','SECURITE') AND frequence_minutes <= 180);

UPDATE source_collecte SET priorite = 'LENTE'
WHERE frequence_minutes >= 720
   OR connector_id IN ('ucdp','ocha_hdx','fews_net','views','gdacs_cat');
