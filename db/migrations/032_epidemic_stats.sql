-- 032_epidemic_stats.sql
-- Statistiques épidémiques de référence — valeurs de repli quand epidemic_zone est vide

CREATE TABLE IF NOT EXISTS epidemic_stats (
  maladie        TEXT PRIMARY KEY,
  zones_actives  INTEGER      NOT NULL DEFAULT 0,
  cas_confirmes  INTEGER      NOT NULL DEFAULT 0,
  deces          INTEGER      NOT NULL DEFAULT 0,
  date_maj       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  source         TEXT         NOT NULL DEFAULT 'INSP/OMS'
);

INSERT INTO epidemic_stats (maladie, zones_actives, cas_confirmes, deces, date_maj, source)
VALUES
  ('CHOLERA',   18,      4820,    89, '2026-06-01', 'INSP/OMS'),
  ('MPOX',       8,      1240,    23, '2026-06-01', 'INSP/OMS'),
  ('ROUGEOLE',  34,     12400,   234, '2026-06-01', 'INSP/OMS'),
  ('MENINGITE',  4,       320,    48, '2026-06-01', 'INSP/OMS'),
  ('PALUDISME', 145,   890000, 12400, '2026-06-01', 'INSP/OMS')
ON CONFLICT (maladie) DO UPDATE SET
  zones_actives = EXCLUDED.zones_actives,
  cas_confirmes = EXCLUDED.cas_confirmes,
  deces         = EXCLUDED.deces,
  date_maj      = EXCLUDED.date_maj,
  source        = EXCLUDED.source;
