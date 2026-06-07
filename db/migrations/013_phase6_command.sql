-- Migration 013 : Centre de commandement — crises GLIDE, coordination, SitReps

-- Crises identifiées par numéro GLIDE (FL-2026-000001-COD)
CREATE TABLE crisis_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  glide_number    TEXT        NOT NULL UNIQUE,
  title           TEXT        NOT NULL,
  hazard_type     hazard_type NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'contained', 'closed')),
  severity        TEXT        NOT NULL DEFAULT 'Unknown',
  start_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,
  location_pcode  TEXT        REFERENCES admin_divisions(pcode),
  affected_count  INT,
  displaced_count INT,
  deaths_count    INT,
  description     TEXT,
  response_lead   TEXT,       -- agence cheffe de file
  created_by      UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX crisis_events_status_idx   ON crisis_events (status, created_at DESC);
CREATE INDEX crisis_events_hazard_idx   ON crisis_events (hazard_type);
CREATE INDEX crisis_events_pcode_idx    ON crisis_events (location_pcode);

CREATE TRIGGER crisis_events_updated_at
  BEFORE UPDATE ON crisis_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tâches de coordination inter-agences (tableau kanban)
CREATE TABLE coordination_tasks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crisis_event_id UUID        REFERENCES crisis_events(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'todo'
                              CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority        INT         NOT NULL DEFAULT 0,  -- 0 = normal, 1 = high, 2 = urgent
  assigned_to     UUID        REFERENCES users(id) ON DELETE SET NULL,
  agency          TEXT,
  due_date        DATE,
  created_by      UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX coord_tasks_crisis_idx   ON coordination_tasks (crisis_event_id, status);
CREATE INDEX coord_tasks_assignee_idx ON coordination_tasks (assigned_to);

CREATE TRIGGER coordination_tasks_updated_at
  BEFORE UPDATE ON coordination_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Rapports de situation (SitRep format OCHA)
CREATE TABLE situation_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crisis_event_id UUID        NOT NULL REFERENCES crisis_events(id) ON DELETE CASCADE,
  report_number   INT         NOT NULL,
  title           TEXT        NOT NULL,
  period_from     DATE        NOT NULL,
  period_to       DATE        NOT NULL,
  prepared_by     UUID        REFERENCES users(id),
  -- Contenu structuré OCHA : overview, needs, response, figures, priorities, funding
  content         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'final', 'published')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (crisis_event_id, report_number)
);

CREATE INDEX sitreps_crisis_idx ON situation_reports (crisis_event_id, report_number DESC);

CREATE TRIGGER situation_reports_updated_at
  BEFORE UPDATE ON situation_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Lier un disaster_event à une crise (si pas déjà via ussd_reports)
ALTER TABLE disaster_events
  ADD COLUMN IF NOT EXISTS crisis_event_id UUID REFERENCES crisis_events(id) ON DELETE SET NULL;

CREATE INDEX disaster_events_crisis_idx ON disaster_events (crisis_event_id);

COMMENT ON TABLE crisis_events IS
  'Crises humanitaires identifiées par numéro GLIDE. '
  'Un ou plusieurs disaster_events peuvent être liés à une même crise.';

COMMENT ON TABLE coordination_tasks IS
  'Tableau kanban de coordination inter-agences. Chaque tâche est liée à une crise.';

COMMENT ON TABLE situation_reports IS
  'Rapports de situation (SitRep) format OCHA — numérotés par crise, exportables HTML/PDF.';
