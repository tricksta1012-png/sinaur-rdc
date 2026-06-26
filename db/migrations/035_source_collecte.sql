-- Migration 035: Registre central des sources de collecte
-- Permet d'ajouter/configurer des sources sans recoder.

CREATE TABLE IF NOT EXISTS source_collecte (
  id               SERIAL       PRIMARY KEY,
  nom              TEXT         NOT NULL,
  type_source      TEXT         NOT NULL,
    -- RSS | API | WEB | RESEAU_SOCIAL | DOCUMENT
  categorie        TEXT,
    -- CONFLIT | EPIDEMIE | CATASTROPHE | SECURITE | METEO | HUMANITAIRE |
    -- SECURITE_ALIMENTAIRE | DROITS_HUMAINS | PREVISION | MEDIA | GENERAL
  agent            TEXT,              -- agent propriétaire (veille, conflit…)
  connector_id     TEXT,              -- source_id du connecteur VeilleAgent si applicable
  url              TEXT,
  config           JSONB        NOT NULL DEFAULT '{}',
    -- Paramètres spécifiques : {api_key, endpoint, params, selectors, canaux_publics…}
  fiabilite        NUMERIC(3,2) NOT NULL DEFAULT 0.70
    CHECK (fiabilite BETWEEN 0 AND 1),
  langue           TEXT         NOT NULL DEFAULT 'fr',
  frequence_minutes INT         NOT NULL DEFAULT 360,
  actif            BOOLEAN      NOT NULL DEFAULT true,
  statut_sante     TEXT         NOT NULL DEFAULT 'UNKNOWN'
    CHECK (statut_sante IN ('OK','DEGRADED','ERROR','UNKNOWN','RATE_LIMITED','DISABLED')),
  derniere_collecte TIMESTAMPTZ,
  prochaine_collecte TIMESTAMPTZ,
  ajoute_par       TEXT,
  note             TEXT,
  cree_le          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  mis_a_jour_le    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS source_collecte_nom_type_idx
  ON source_collecte (nom, type_source);
CREATE INDEX IF NOT EXISTS source_collecte_agent_idx
  ON source_collecte (agent) WHERE actif = true;
CREATE INDEX IF NOT EXISTS source_collecte_categorie_idx
  ON source_collecte (categorie) WHERE actif = true;

-- Trigger mis_a_jour_le
CREATE TRIGGER source_collecte_updated_at
  BEFORE UPDATE ON source_collecte
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Pré-remplissage ────────────────────────────────────────────────────────────

INSERT INTO source_collecte
  (nom, type_source, categorie, agent, connector_id, url, fiabilite, frequence_minutes, actif, statut_sante)
VALUES
  -- VeilleAgent connectors (dynamiques)
  ('ReliefWeb',               'API',  'CATASTROPHE',          'veille', 'reliefweb',             'https://api.reliefweb.int/v1/reports',          0.88, 180,  true, 'UNKNOWN'),
  ('Open-Meteo',              'API',  'METEO',                'veille', 'open_meteo',             'https://api.open-meteo.com/v1/forecast',         0.85, 360,  true, 'UNKNOWN'),
  ('FEWS NET',                'API',  'SECURITE_ALIMENTAIRE', 'veille', 'fews_net',               'https://fdw.fews.net/api',                       0.90, 1440, true, 'UNKNOWN'),
  ('OCHA HDX',                'API',  'HUMANITAIRE',          'veille', 'ocha_hdx',               'https://data.humdata.org/api/3',                 0.92, 720,  true, 'UNKNOWN'),
  ('MettelSat',               'API',  'TELECOMMUNICATIONS',   'veille', 'mettelsat',              'https://api.mettelsat.cd',                       0.80, 60,   true, 'UNKNOWN'),
  ('NASA FIRMS',              'API',  'FEUX',                 'veille', 'firms',                  'https://firms.modaps.eosdis.nasa.gov/api',       0.82, 180,  true, 'UNKNOWN'),
  ('ReliefWeb Conflits',      'API',  'CONFLIT',              'veille', 'reliefweb_conflict',     'https://api.reliefweb.int/v1/reports',           0.85, 180,  true, 'UNKNOWN'),
  ('UCDP GED',                'API',  'CONFLIT',              'veille', 'ucdp',                   'https://ucdpapi.pcr.uu.se/api/gedevents',        0.94, 1440, true, 'UNKNOWN'),
  ('GDELT',                   'API',  'MEDIA_CONFLIT',        'veille', 'gdelt',                  'https://api.gdeltproject.org/api/v2',            0.72, 360,  true, 'UNKNOWN'),
  ('Kivu Security Tracker',   'WEB',  'CONFLIT',              'veille', 'kivu_security_tracker',  'https://kivusecurity.org',                       0.88, 720,  true, 'UNKNOWN'),
  ('OHCHR',                   'WEB',  'DROITS_HUMAINS',       'veille', 'ohchr',                  'https://reliefweb.int/organization/ohchr',       0.90, 1440, true, 'UNKNOWN'),
  ('ACLED',                   'API',  'CONFLIT',              'veille', 'acled',                  'https://api.acleddata.com/acled/read',           0.92, 360,  true, 'UNKNOWN'),
  -- Sources renseignement
  ('Radio Okapi',             'RSS',  'SECURITE',             'renseignement', 'radio_okapi',     'https://www.radiookapi.net/feed',                0.85, 120,  true, 'UNKNOWN'),
  ('ACLED Renseignement',     'API',  'CONFLIT',              'renseignement', 'acled_deep',      'https://api.acleddata.com/acled/read',           0.92, 120,  true, 'UNKNOWN'),
  ('Kivu Morning Post RSS',   'RSS',  'SECURITE',             'renseignement', 'kmp_rss',         'https://kivumornningpost.com/feed',              0.80, 120,  true, 'UNKNOWN'),
  ('Kivu Morning Post YouTube','WEB', 'SECURITE',             'renseignement', 'kmp_youtube',     'https://www.youtube.com/@kivumornningpost',      0.75, 120,  true, 'UNKNOWN'),
  ('Presse congolaise',       'RSS',  'GENERAL',              'renseignement', 'presse_rdc',      'https://congo-autrement.com/feed',               0.70, 120,  true, 'UNKNOWN'),
  ('Telesud (renseignement)', 'WEB',  'GENERAL',              'renseignement', 'telesud_rens',    'https://www.telesud.com/',                       0.67, 120,  true, 'UNKNOWN'),
  -- Sources conflit
  ('Presse + BBC/France24',   'RSS',  'CONFLIT',              'conflit', 'presse_media',          'https://www.france24.com/fr/afrique/rss',        0.75, 120,  true, 'UNKNOWN'),
  ('Telesud (conflits)',      'WEB',  'CONFLIT',              'conflit', 'telesud_conf',           'https://www.telesud.com/',                       0.67, 120,  true, 'UNKNOWN'),
  ('VIEWS (Uppsala/PRIO)',    'API',  'PREVISION',            'conflit', 'views',                  'https://api.viewsforecasting.org',               0.90, 10080,true, 'UNKNOWN'),
  -- Sources épidémie
  ('OMS Disease Outbreaks',   'RSS',  'EPIDEMIE',             'epidemie', 'oms_don',              'https://www.who.int/feeds/entity/en/news/RSS.xml',0.97, 240, true, 'UNKNOWN'),
  ('ProMED Mail',             'RSS',  'EPIDEMIE',             'epidemie', 'promedmail',            'https://promedmail.org/promed-post/?feed=rss',   0.88, 240,  true, 'UNKNOWN'),
  ('Africa CDC',              'WEB',  'EPIDEMIE',             'epidemie', 'africa_cdc',            'https://africacdc.org',                          0.90, 720,  true, 'UNKNOWN'),
  ('ReliefWeb Santé',         'API',  'EPIDEMIE',             'epidemie', 'reliefweb_sante',       'https://api.reliefweb.int/v1/reports',           0.88, 240,  true, 'UNKNOWN'),
  ('Telesud (santé)',         'WEB',  'EPIDEMIE',             'epidemie', 'telesud_epi',           'https://www.telesud.com/',                       0.67, 240,  true, 'UNKNOWN'),
  -- Sources catastrophes
  ('GDACS',                   'API',  'CATASTROPHE',          'catastrophes', 'gdacs_cat',         'https://www.gdacs.org/gdacsapi/api',             0.93, 30,   true, 'UNKNOWN')
ON CONFLICT (nom, type_source) DO NOTHING;

COMMENT ON TABLE source_collecte IS
  'Registre central de toutes les sources de collecte SINAUR-RDC. '
  'Ajouter une source = insérer une ligne ici (pas de code à modifier). '
  'Les connecteurs VeilleAgent sont identifiés par connector_id.';
