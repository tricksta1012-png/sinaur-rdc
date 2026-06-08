-- Phase 8 — Observabilité & Production
-- Snapshot périodique de la file d'alertes pour trending historique
-- (la profondeur temps-réel vient de Prometheus, ceci sert le backfill BI)

CREATE TABLE IF NOT EXISTS alert_queue_snapshots (
  id         BIGSERIAL PRIMARY KEY,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  depth      INT         NOT NULL,
  by_severity JSONB      NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alert_queue_snapshots_sampled_at
  ON alert_queue_snapshots (sampled_at DESC);

-- Purge auto : garder 90 jours
CREATE OR REPLACE FUNCTION purge_old_alert_snapshots() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM alert_queue_snapshots WHERE sampled_at < NOW() - INTERVAL '90 days';
END;
$$;

-- Vue pour compter la file courante
CREATE OR REPLACE VIEW v_alert_queue_depth AS
SELECT
  COUNT(*) FILTER (WHERE status = 'Draft')                                                       AS total,
  COUNT(*) FILTER (WHERE status = 'Draft' AND info->0->>'severity' = 'Extreme')                  AS extreme,
  COUNT(*) FILTER (WHERE status = 'Draft' AND info->0->>'severity' = 'Severe')                   AS severe,
  COUNT(*) FILTER (WHERE status = 'Draft' AND info->0->>'severity' = 'Moderate')                 AS moderate
FROM cap_alerts
WHERE sent > NOW() - INTERVAL '48 hours';
