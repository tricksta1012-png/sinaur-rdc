-- Migration 014 : sync-gateway — registre des appareils, journal des conflits

CREATE TABLE sync_devices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT        NOT NULL UNIQUE,   -- UUID généré côté mobile
  platform        TEXT        NOT NULL DEFAULT 'android', -- android | ios | other
  app_version     TEXT,
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  push_token      TEXT,                           -- FCM token pour push-sync
  last_sync_at    TIMESTAMPTZ,
  last_sync_types TEXT[],                         -- types syncrés lors du dernier sync
  total_syncs     INT         NOT NULL DEFAULT 0,
  location_scope  TEXT[],                         -- p-codes de travail de l'agent
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sync_devices_user_idx     ON sync_devices (user_id);
CREATE INDEX sync_devices_push_idx     ON sync_devices (push_token) WHERE push_token IS NOT NULL;

CREATE TRIGGER sync_devices_updated_at
  BEFORE UPDATE ON sync_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Journal des conflits de sync détectés lors du push
CREATE TABLE sync_conflicts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT        NOT NULL,
  conflict_type   TEXT        NOT NULL,           -- 'duplicate' | 'version_mismatch' | 'schema_error'
  resource_type   TEXT        NOT NULL,           -- 'event' | 'beneficiary' | 'receipt'
  client_payload  JSONB       NOT NULL DEFAULT '{}',
  server_record   JSONB,                          -- enregistrement serveur conflictuel
  resolution      TEXT        NOT NULL DEFAULT 'pending', -- 'pending' | 'server_wins' | 'client_wins' | 'merged'
  resolved_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sync_conflicts_device_idx     ON sync_conflicts (device_id, created_at DESC);
CREATE INDEX sync_conflicts_pending_idx    ON sync_conflicts (resolution) WHERE resolution = 'pending';

-- Log de toutes les sessions de sync (pour analytics et debug)
CREATE TABLE sync_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT        NOT NULL,
  sync_type       TEXT        NOT NULL,           -- 'pull' | 'push' | 'full'
  since           TIMESTAMPTZ,
  items_received  INT         NOT NULL DEFAULT 0,
  items_pushed    INT         NOT NULL DEFAULT 0,
  conflicts       INT         NOT NULL DEFAULT 0,
  duration_ms     INT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sync_sessions_device_idx ON sync_sessions (device_id, created_at DESC);

COMMENT ON TABLE sync_devices IS
  'Registre des appareils mobiles. Un appareil = un agent terrain identifié par deviceId.';

COMMENT ON TABLE sync_conflicts IS
  'Conflits de synchronisation détectés lors du push depuis le mobile. '
  'Les conflits pending sont présentés au supervisor pour résolution.';

COMMENT ON TABLE sync_sessions IS
  'Historique des sessions de synchronisation pour monitoring et debug.';
