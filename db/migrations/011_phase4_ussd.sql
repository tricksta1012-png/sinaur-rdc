-- Migration 011 : USSD et SMS log — accès sans smartphone

CREATE TABLE ussd_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT        NOT NULL UNIQUE, -- ID fourni par le carrier
  phone_number    TEXT        NOT NULL,
  locale          TEXT        NOT NULL DEFAULT 'fr',
  current_step    TEXT        NOT NULL DEFAULT 'main',
  session_data    JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  -- Expire après 5 minutes d'inactivité (nettoyage par cron)
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

CREATE INDEX ussd_sessions_phone_idx  ON ussd_sessions (phone_number);
CREATE INDEX ussd_sessions_expiry_idx ON ussd_sessions (expires_at);

CREATE TRIGGER ussd_sessions_updated_at
  BEFORE UPDATE ON ussd_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Rapports soumis via USSD (créent aussi des canonical_events)
CREATE TABLE ussd_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT        REFERENCES ussd_sessions(session_id) ON DELETE SET NULL,
  phone_number    TEXT        NOT NULL,
  hazard_type     hazard_type NOT NULL,
  location_pcode  TEXT        REFERENCES admin_divisions(pcode),
  location_free   TEXT,       -- Texte libre si pcode non reconnu
  description     TEXT,
  locale          TEXT        NOT NULL DEFAULT 'fr',
  source_ref      TEXT,       -- Référence courte (USSD-XXXXXX)
  disaster_event_id UUID      REFERENCES disaster_events(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ussd_reports_phone_idx ON ussd_reports (phone_number);
CREATE INDEX ussd_reports_hazard_idx ON ussd_reports (hazard_type);

-- Abonnements SMS aux alertes par zone
CREATE TABLE sms_alert_subscriptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number    TEXT        NOT NULL,
  location_pcode  TEXT        NOT NULL REFERENCES admin_divisions(pcode),
  locale          TEXT        NOT NULL DEFAULT 'fr',
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  UNIQUE (phone_number, location_pcode)
);

CREATE INDEX sms_subscriptions_pcode_idx ON sms_alert_subscriptions (location_pcode) WHERE active = TRUE;
CREATE INDEX sms_subscriptions_phone_idx ON sms_alert_subscriptions (phone_number);

COMMENT ON TABLE ussd_sessions IS
  'Sessions USSD en cours — TTL 5min. Nettoyées par le service USSD.';

COMMENT ON TABLE ussd_reports IS
  'Rapports d''événements soumis via USSD (*777*SINAUR#). '
  'Offre un accès aux personnes sans smartphone ni connexion data.';

COMMENT ON TABLE sms_alert_subscriptions IS
  'Abonnements SMS pour recevoir les alertes officielles par zone géographique. '
  'Permet d''atteindre les populations sans smartphone.';
