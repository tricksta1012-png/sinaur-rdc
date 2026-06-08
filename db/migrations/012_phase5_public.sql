-- Migration 012 : portail public anonymisé + sécurité

-- Colonne is_public sur disaster_events (contrôle ce qui est visible publiquement)
ALTER TABLE disaster_events ADD COLUMN IF NOT EXISTS
  is_public BOOLEAN NOT NULL DEFAULT TRUE;

-- Vue matérialisée : statistiques par province, aucune donnée personnelle
CREATE MATERIALIZED VIEW public_stats AS
SELECT
  d.pcode,
  d.name_fr,
  d.name_local,
  d.level,
  COALESCE(COUNT(DISTINCT e.id) FILTER (
    WHERE e.created_at >= NOW() - INTERVAL '30 days' AND e.is_public = TRUE
  ), 0)::int AS events_30d,
  COALESCE(COUNT(DISTINCT e.id) FILTER (
    WHERE e.created_at >= NOW() - INTERVAL '7 days' AND e.is_public = TRUE
  ), 0)::int AS events_7d,
  COALESCE(COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'Actual'), 0)::int AS active_alerts,
  MAX(e.created_at) AS last_event_at
FROM admin_divisions d
LEFT JOIN disaster_events e ON e.location_pcode LIKE d.pcode || '%'
LEFT JOIN cap_alerts a      ON a.info->>'areaCode' = d.pcode
WHERE d.level = 1
GROUP BY d.pcode, d.name_fr, d.name_local, d.level;

CREATE UNIQUE INDEX public_stats_pcode_idx ON public_stats (pcode);

-- Agrégats quotidiens anonymisés pour les graphiques de tendance
CREATE TABLE event_daily_stats (
  stat_date      DATE        NOT NULL,
  hazard_type    hazard_type NOT NULL,
  event_count    INT         NOT NULL DEFAULT 0,
  province_count INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, hazard_type)
);

-- Remplissage initial des 30 derniers jours
INSERT INTO event_daily_stats (stat_date, hazard_type, event_count, province_count)
SELECT
  DATE(created_at),
  hazard_type,
  COUNT(*)::int,
  COUNT(DISTINCT location_pcode)::int
FROM disaster_events
WHERE created_at >= NOW() - INTERVAL '30 days' AND is_public = TRUE
GROUP BY DATE(created_at), hazard_type
ON CONFLICT DO NOTHING;

-- Mise à jour des stats quotidiennes à chaque nouvel événement
CREATE OR REPLACE FUNCTION update_event_daily_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_daily_stats (stat_date, hazard_type, event_count, province_count)
  SELECT
    CURRENT_DATE,
    NEW.hazard_type,
    COUNT(*)::int,
    COUNT(DISTINCT location_pcode)::int
  FROM disaster_events
  WHERE DATE(created_at) = CURRENT_DATE
    AND hazard_type = NEW.hazard_type
    AND is_public = TRUE
  ON CONFLICT (stat_date, hazard_type) DO UPDATE
    SET event_count    = EXCLUDED.event_count,
        province_count = EXCLUDED.province_count;
  RETURN NEW;
END;
$$;

CREATE TRIGGER disaster_events_daily_stats_trigger
  AFTER INSERT OR UPDATE OF is_public ON disaster_events
  FOR EACH ROW EXECUTE FUNCTION update_event_daily_stats();

-- Journal des événements de sécurité
CREATE TABLE security_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT        NOT NULL,  -- 'auth_failed' | 'rate_limited' | 'forbidden' | 'suspicious_input'
  ip_address  INET,
  user_agent  TEXT,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  resource    TEXT,
  details     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX security_events_type_idx    ON security_events (event_type, created_at DESC);
CREATE INDEX security_events_ip_idx      ON security_events (ip_address,  created_at DESC);
CREATE INDEX security_events_created_idx ON security_events (created_at DESC);

-- Purge automatique après 90 jours (§9 sécurité)
CREATE OR REPLACE FUNCTION purge_old_security_events()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM security_events WHERE created_at < NOW() - INTERVAL '90 days';
$$;

COMMENT ON MATERIALIZED VIEW public_stats IS
  'Statistiques agrégées par province — aucune donnée personnelle. '
  'Rafraîchir via : REFRESH MATERIALIZED VIEW CONCURRENTLY public_stats;';

COMMENT ON TABLE event_daily_stats IS
  'Agrégats quotidiens anonymisés (type de risque × nombre événements). '
  'Source des graphiques de tendance du portail public.';

COMMENT ON TABLE security_events IS
  'Audit sécurité : auth échouées, accès refusés, activité suspecte. '
  'Rétention 90 jours minimum selon §9 spec sécurité. Purge via purge_old_security_events().';
