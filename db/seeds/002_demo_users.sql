-- Seed 002: Utilisateurs de démonstration
-- ATTENTION: MOT DE PASSE EN CLAIR ICI POUR SEED UNIQUEMENT
-- En production, utiliser bcrypt hash. Ces comptes sont pour l'environnement de dev.

-- Hash de "demo1234" avec bcrypt (coût 12) — à générer via: bcrypt.hash('demo1234', 12)
-- Ici on stocke un placeholder ; l'API /auth/seed endpoint génère les vrais hashes

INSERT INTO users (email, phone, display_name, role, geographic_scope_pcodes, is_active)
VALUES
  ('admin@sinaur-rdc.cd',        NULL,           'Administrateur Système',        'system_admin',              '{}',       TRUE),
  ('decision@sinaur-rdc.cd',     NULL,           'Ministre Affaires Sociales',    'national_decision_maker',   '{}',       TRUE),
  ('gouverneur.kinshasa@rdc.cd', NULL,           'Gouverneur de Kinshasa',        'territory_admin',           '{CD01}',   TRUE),
  ('gouverneur.kivu@rdc.cd',     NULL,           'Gouverneur Nord-Kivu',          'territory_admin',           '{CD14}',   TRUE),
  ('agent.goma@sinaur-rdc.cd',   '+243810000001','Agent Terrain — Goma',          'field_agent',               '{CD14}',   TRUE),
  ('agent.kinshasa@sinaur-rdc.cd','+243810000002','Agent Terrain — Kinshasa',     'field_agent',               '{CD01}',   TRUE),
  ('ocha@un.org',                NULL,           'OCHA RDC',                      'humanitarian_partner',      '{}',       TRUE),
  ('unicef@un.org',              NULL,           'UNICEF RDC',                    'humanitarian_partner',      '{}',       TRUE),
  ('validateur.goma@rdc.cd',     '+243820000001','Validateur Local — Goma',       'local_validator',           '{CD14}',   TRUE),
  (NULL,                         '+243830000001','Citoyen Test (Anonyme)',         'citizen',                   '{CD01}',   TRUE)
ON CONFLICT DO NOTHING;
