-- Seed 002: Utilisateurs de démonstration
-- Mot de passe: demo1234 (bcrypt coût 12)
-- Ces comptes sont pour l'environnement de dev/demo uniquement.

-- Hash bcrypt de "demo1234" (coût 12) — généré une fois pour la cohérence des seeds
-- Pour regénérer: node -e "require('bcrypt').hash('demo1234',12).then(console.log)"
DO $$
DECLARE
  pw TEXT := '$2b$12$AUBAeQUdD0hZWKb5kXiziucJkGirLOq1ItXJduynRPGyhMziK/uYG';
BEGIN
  INSERT INTO users (email, phone, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES
    ('admin@sinaur-rdc.cd',        NULL,           'Administrateur Système',        'system_admin',              '{}',       pw, TRUE),
    ('decision@sinaur-rdc.cd',     NULL,           'Ministre Affaires Sociales',    'national_decision_maker',   '{}',       pw, TRUE),
    ('gouverneur.kinshasa@rdc.cd', NULL,           'Gouverneur de Kinshasa',        'territory_admin',           '{CD10}',   pw, TRUE),
    ('gouverneur.kivu@rdc.cd',     NULL,           'Gouverneur Nord-Kivu',          'territory_admin',           '{CD61}',   pw, TRUE),
    ('agent.goma@sinaur-rdc.cd',   '+243810000001','Agent Terrain — Goma',          'field_agent',               '{CD61}',   pw, TRUE),
    ('agent.kinshasa@sinaur-rdc.cd','+243810000002','Agent Terrain — Kinshasa',     'field_agent',               '{CD10}',   pw, TRUE),
    ('ocha@un.org',                NULL,           'OCHA RDC',                      'humanitarian_partner',      '{}',       pw, TRUE),
    ('unicef@un.org',              NULL,           'UNICEF RDC',                    'humanitarian_partner',      '{}',       pw, TRUE),
    ('validateur.goma@rdc.cd',     '+243820000001','Validateur Local — Goma',       'local_validator',           '{CD61}',   pw, TRUE),
    (NULL,                         '+243830000001','Citoyen Test (Anonyme)',         'citizen',                   '{CD10}',   pw, TRUE)
  ON CONFLICT DO NOTHING;
END $$;
