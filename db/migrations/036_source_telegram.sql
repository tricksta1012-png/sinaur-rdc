-- Migration 036 : sources Telegram dans source_collecte
-- Ajoute les canaux Telegram publics surveillés par le connecteur veille.

INSERT INTO source_collecte
    (nom, type_source, categorie, agent, connector_id, url, config, fiabilite, langue, frequence_minutes, actif, statut_sante, note)
VALUES
    ('Radio Okapi (Telegram)',
     'RESEAU_SOCIAL', 'CONFLIT_SECURITE', 'veille', 'telegram',
     'https://t.me/s/RadioOkapi',
     '{"channel": "RadioOkapi", "mode": "web_preview"}'::jsonb,
     0.85, 'fr', 90, true, 'UNKNOWN',
     'Radio Okapi — radio ONU/RDC, actualités et sécurité'),

    ('Actualité.cd (Telegram)',
     'RESEAU_SOCIAL', 'GENERAL', 'veille', 'telegram',
     'https://t.me/s/actualite_cd',
     '{"channel": "actualite_cd", "mode": "web_preview"}'::jsonb,
     0.80, 'fr', 90, true, 'UNKNOWN',
     'Actualité.cd — portail national RDC'),

    ('7SUR7.CD (Telegram)',
     'RESEAU_SOCIAL', 'GENERAL', 'veille', 'telegram',
     'https://t.me/s/7surSeptCD',
     '{"channel": "7surSeptCD", "mode": "web_preview"}'::jsonb,
     0.75, 'fr', 90, true, 'UNKNOWN',
     '7sur7.cd — actualité politique et sécuritaire'),

    ('Congo Actualité (Telegram)',
     'RESEAU_SOCIAL', 'CONFLIT_SECURITE', 'veille', 'telegram',
     'https://t.me/s/congoactualite',
     '{"channel": "congoactualite", "mode": "web_preview"}'::jsonb,
     0.72, 'fr', 90, true, 'UNKNOWN',
     'Congo Actualité — analyse conflit Est RDC'),

    ('Kivu Security Tracker (Telegram)',
     'RESEAU_SOCIAL', 'CONFLIT_SECURITE', 'veille', 'telegram',
     'https://t.me/s/kivusecurity',
     '{"channel": "kivusecurity", "mode": "web_preview"}'::jsonb,
     0.88, 'en', 90, true, 'UNKNOWN',
     'Kivu Security Tracker — incidents sécuritaires Est RDC géoréférencés'),

    ('RFI Afrique (Telegram)',
     'RESEAU_SOCIAL', 'GENERAL', 'veille', 'telegram',
     'https://t.me/s/RFI_Afrique',
     '{"channel": "RFI_Afrique", "mode": "web_preview"}'::jsonb,
     0.85, 'fr', 90, true, 'UNKNOWN',
     'RFI Afrique — couverture internationale Afrique centrale')

ON CONFLICT (nom, type_source) DO NOTHING;
