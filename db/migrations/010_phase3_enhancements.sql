-- Migration 010 : améliorations Phase 3 — registre & distributions
-- Vue consolidée registre, index perf, contrainte validation

-- Vue publique anonymisée des bénéficiaires (sans données personnelles)
-- Conforme §9 : anonymisation stricte pour tout flux public
CREATE VIEW beneficiary_stats_by_zone AS
SELECT
  location_pcode,
  disaster_type,
  status,
  vulnerability_level,
  COUNT(*)                                       AS total,
  SUM(household_size)                            AS total_persons,
  SUM(CASE WHEN vulnerability_level IN ('high','critical') THEN 1 ELSE 0 END) AS high_vulnerability_count
FROM beneficiaries
WHERE deleted_at IS NULL
GROUP BY location_pcode, disaster_type, status, vulnerability_level;

-- Vue matérialisée pour les stats du tableau de bord distribution
CREATE MATERIALIZED VIEW distribution_stats AS
SELECT
  d.id                                                      AS distribution_id,
  d.aid_type,
  d.status,
  d.planned_date,
  d.organization_name,
  UNNEST(d.target_pcodes)                                   AS pcode,
  COUNT(r.id)                                               AS receipts_count,
  COALESCE(SUM(r.quantity), 0)                              AS total_quantity_distributed,
  d.total_beneficiaries_targeted,
  ROUND(
    COUNT(r.id)::numeric / NULLIF(d.total_beneficiaries_targeted, 0) * 100, 1
  )                                                         AS completion_pct
FROM aid_distributions d
LEFT JOIN aid_receipts r ON r.distribution_id = d.id
GROUP BY d.id, d.aid_type, d.status, d.planned_date,
         d.organization_name, d.total_beneficiaries_targeted;

CREATE UNIQUE INDEX distribution_stats_id_pcode_idx
  ON distribution_stats (distribution_id, pcode);

-- Colonne pour invalider les tokens QR périmés (révocation QR)
ALTER TABLE beneficiaries
  ADD COLUMN IF NOT EXISTS qr_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_version    SMALLINT NOT NULL DEFAULT 1;

-- Index sur qr_code_data pour validation rapide au scan
CREATE INDEX IF NOT EXISTS beneficiaries_qr_idx ON beneficiaries (qr_code_data);

-- Colonnes pour audit trail sur les distributions
ALTER TABLE aid_distributions
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS notes         TEXT;

-- Matérialiser les totaux distribués pour éviter les COUNT() lents
CREATE OR REPLACE FUNCTION refresh_distribution_stats() RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY distribution_stats;
END;
$$;

-- Trigger pour incrémenter total_beneficiaries_served à chaque reçu
CREATE OR REPLACE FUNCTION increment_distribution_served()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE aid_distributions
  SET total_beneficiaries_served = total_beneficiaries_served + 1
  WHERE id = NEW.distribution_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aid_receipts_increment_served
  AFTER INSERT ON aid_receipts
  FOR EACH ROW EXECUTE FUNCTION increment_distribution_served();

COMMENT ON VIEW beneficiary_stats_by_zone IS
  'Données agrégées anonymisées — aucune donnée personnelle. '
  'Seule cette vue doit être exposée aux partenaires externes (§9 spec).';
