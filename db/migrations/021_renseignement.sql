-- Migration 021: Tables renseignement militaire (Agent 10)

CREATE TABLE IF NOT EXISTS intel_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    title         TEXT NOT NULL,
    date          TIMESTAMPTZ,
    content       TEXT,
    url           TEXT,
    reliability   REAL DEFAULT 0.7,
    category      TEXT NOT NULL DEFAULT 'AUTRE',
    p_code        TEXT REFERENCES admin_divisions(pcode) ON DELETE SET NULL,
    province      TEXT,
    territoire    TEXT,
    actor_names   TEXT[],
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS intel_province_assessments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    p_code              TEXT NOT NULL,
    province            TEXT NOT NULL,
    threat_level        INT NOT NULL CHECK (threat_level BETWEEN 1 AND 5),
    threat_label        TEXT NOT NULL,
    justification       TEXT,
    humanitarian_access TEXT,
    recommended_actions TEXT[],
    safe_corridors      TEXT[],
    active_actors       TEXT[],
    sources             TEXT[],
    confidence          REAL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intel_bulletins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start    TIMESTAMPTZ,
    period_end      TIMESTAMPTZ,
    critical_count  INT DEFAULT 0,
    high_count      INT DEFAULT 0,
    summary         TEXT,
    payload         JSONB
);

CREATE INDEX IF NOT EXISTS intel_events_p_code_idx     ON intel_events (p_code);
CREATE INDEX IF NOT EXISTS intel_events_category_idx   ON intel_events (category);
CREATE INDEX IF NOT EXISTS intel_events_date_idx       ON intel_events (date DESC);
CREATE INDEX IF NOT EXISTS intel_assessments_pcode_idx ON intel_province_assessments (p_code);
CREATE INDEX IF NOT EXISTS intel_assessments_level_idx ON intel_province_assessments (threat_level DESC);
