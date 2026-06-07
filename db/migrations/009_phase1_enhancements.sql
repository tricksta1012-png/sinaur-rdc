-- Migration 009: Améliorations Phase 1
-- File de modération, signalements en attente hors-ligne, notifications

-- File de modération pour les signalements citoyens
CREATE TABLE moderation_queue (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID        NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  assigned_to   UUID        REFERENCES users(id),
  priority      SMALLINT    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  reason        TEXT,
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID        REFERENCES users(id),
  resolution    TEXT        CHECK (resolution IN ('approved', 'rejected', 'merged', 'escalated')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Empreinte de déduplication des signalements citoyens
-- (hash sur type + zone + fenêtre de 24h)
CREATE TABLE event_dedup_hashes (
  hash          TEXT        PRIMARY KEY,
  event_id      UUID        NOT NULL REFERENCES disaster_events(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Suivi de lecture des alertes par utilisateur (push / web)
CREATE TABLE alert_reads (
  user_id       UUID        NOT NULL REFERENCES users(id),
  alert_id      UUID        NOT NULL REFERENCES cap_alerts(id),
  read_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, alert_id)
);

-- File d'envoi SMS (pour accusé de réception et alertes sortantes)
CREATE TABLE sms_queue (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  to_phone      TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  attempts      SMALLINT    NOT NULL DEFAULT 0,
  last_error    TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vue : statistiques provinciales agrégées (rafraîchie manuellement ou par cron)
CREATE MATERIALIZED VIEW province_stats AS
SELECT
  ad.pcode,
  ad.name_fr AS province_name,
  COUNT(de.id)                                                     AS total_events,
  COUNT(de.id) FILTER (WHERE de.status = 'active')                AS active_events,
  COUNT(de.id) FILTER (WHERE de.severity IN ('Severe','Extreme')) AS severe_events,
  COUNT(de.id) FILTER (WHERE de.start_date >= NOW() - INTERVAL '7 days') AS events_7d,
  COALESCE(SUM(de.estimated_affected), 0)                         AS total_affected,
  MAX(de.start_date)                                               AS last_event_at
FROM admin_divisions ad
LEFT JOIN disaster_events de
  ON (de.location_pcode = ad.pcode OR ad.pcode = ANY(de.affected_pcodes))
  AND de.deleted_at IS NULL
WHERE ad.level = 1 AND ad.is_active = TRUE
GROUP BY ad.pcode, ad.name_fr;

CREATE UNIQUE INDEX province_stats_pcode_idx ON province_stats (pcode);

-- Vue : tendance journalière des 30 derniers jours
CREATE VIEW events_daily_trend AS
SELECT
  date_trunc('day', start_date)::date AS day,
  hazard_type,
  COUNT(*) AS count
FROM disaster_events
WHERE start_date >= NOW() - INTERVAL '30 days'
  AND deleted_at IS NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

CREATE INDEX moderation_queue_event_idx ON moderation_queue (event_id);
CREATE INDEX moderation_queue_unresolved_idx ON moderation_queue (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX event_dedup_hashes_expires_idx ON event_dedup_hashes (expires_at);
CREATE INDEX sms_queue_pending_idx ON sms_queue (status, scheduled_at) WHERE status = 'pending';

CREATE TRIGGER moderation_queue_updated_at
  BEFORE UPDATE ON moderation_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
