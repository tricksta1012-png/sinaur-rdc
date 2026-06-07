-- Migration 003: Utilisateurs et RBAC
-- Rôles : citizen, field_agent, local_validator, territory_admin,
--          humanitarian_partner, national_decision_maker, system_admin

CREATE TYPE user_role AS ENUM (
  'citizen',
  'field_agent',
  'local_validator',
  'territory_admin',
  'humanitarian_partner',
  'national_decision_maker',
  'system_admin'
);

CREATE TABLE users (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT        UNIQUE,
  phone                    TEXT        UNIQUE,
  display_name             TEXT        NOT NULL,
  password_hash            TEXT,
  role                     user_role   NOT NULL DEFAULT 'citizen',
  -- Périmètre géographique : liste de P-codes où l'utilisateur a autorité
  -- Vide = portée nationale (pour system_admin, national_decision_maker)
  geographic_scope_pcodes  TEXT[]      NOT NULL DEFAULT '{}',
  is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
  is_pseudonymous          BOOLEAN     NOT NULL DEFAULT FALSE,
  last_login_at            TIMESTAMPTZ,
  fcm_tokens               TEXT[]      NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  CONSTRAINT users_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Tokens de rafraîchissement JWT
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OTP pour authentification par SMS
CREATE TABLE otp_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  attempts    SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Journal d'audit inviolable (INSERT ONLY — pas d'UPDATE/DELETE)
CREATE TABLE audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  event_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id     UUID        REFERENCES users(id),
  action      TEXT        NOT NULL,
  resource    TEXT        NOT NULL,
  resource_id TEXT,
  ip_address  INET,
  user_agent  TEXT,
  details     JSONB
);

CREATE INDEX users_email_idx          ON users (email) WHERE email IS NOT NULL;
CREATE INDEX users_phone_idx          ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX users_role_idx           ON users (role);
CREATE INDEX users_active_idx         ON users (is_active) WHERE is_active = TRUE;
CREATE INDEX refresh_tokens_user_idx  ON refresh_tokens (user_id);
CREATE INDEX otp_codes_phone_idx      ON otp_codes (phone, expires_at);
CREATE INDEX audit_log_user_idx       ON audit_log (user_id, event_at DESC);
CREATE INDEX audit_log_resource_idx   ON audit_log (resource, resource_id, event_at DESC);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Sécurité : interdire la modification de l'audit log
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
