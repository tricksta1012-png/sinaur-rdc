-- Migration 044 — Géographie de valeur pour l'intelligence stratégique
-- Points d'intérêt qui attirent les groupes armés (mines, axes, frontières…)
-- Sert à la projection de progression armée (≠ fuite civile).

CREATE TABLE IF NOT EXISTS point_strategique (
  id                   SERIAL PRIMARY KEY,
  nom                  TEXT NOT NULL,
  type_valeur          TEXT NOT NULL,          -- MINE | AXE_COMMERCIAL | FRONTIERE | VILLE_RELAIS | AGRICOLE | BASTION
  ressource            TEXT,                   -- coltan, or, cassitérite, terres, axes...
  province_pcode       TEXT REFERENCES admin_divisions(pcode) ON DELETE SET NULL,
  province_nom         TEXT,
  coordinates          GEOMETRY(POINT, 4326),
  valeur_strategique   NUMERIC(3,2) DEFAULT 0.50,  -- 0.00–1.00
  groupes_interesses   TEXT[]  DEFAULT '{}',
  notes                TEXT,
  actif                BOOLEAN DEFAULT TRUE,
  cree_le              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS point_strategique_geo_idx
  ON point_strategique USING GIST (coordinates);

CREATE INDEX IF NOT EXISTS point_strategique_groupes_idx
  ON point_strategique USING GIN (groupes_interesses);

-- ── Données initiales — à enrichir via rapports terrain ──────────────────────

INSERT INTO point_strategique
  (nom, type_valeur, ressource, province_pcode, province_nom, coordinates, valeur_strategique, groupes_interesses, notes)
VALUES
  -- M23 / AFC — Nord-Kivu
  ('Rubaya (coltan)',         'MINE',          'coltan',       'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.13, -1.57), 4326), 0.95,
   ARRAY['M23/AFC'], 'Zone minière coltan de haute valeur. Sous contrôle M23 depuis 2022.'),

  ('Axe Goma–Rutshuru',      'AXE_COMMERCIAL', 'corridor',    'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.23, -1.30), 4326), 0.90,
   ARRAY['M23/AFC'], 'Route commerciale principale Nord-Kivu. Contrôle = revenus taxation + mobilité.'),

  ('Goma (ville)',            'VILLE_RELAIS',  NULL,           'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.23, -1.68), 4326), 0.90,
   ARRAY['M23/AFC'], 'Capital provincial, nœud humanitaire et commercial. Pris en janvier 2025.'),

  ('Minova–Sake (corridor)',  'AXE_COMMERCIAL', 'corridor',    'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.05, -1.90), 4326), 0.75,
   ARRAY['M23/AFC'], 'Axe de ravitaillement et de progression vers le Sud-Kivu.'),

  ('Poste-frontière Bunagana','FRONTIERE',     NULL,           'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.70, -1.26), 4326), 0.85,
   ARRAY['M23/AFC'], 'Frontière avec l''Ouganda. Revenus douaniers et passage d''armement.'),

  ('Kiwanja–Rutshuru',       'VILLE_RELAIS',  NULL,           'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.44, -1.18), 4326), 0.80,
   ARRAY['M23/AFC'], 'Villes-relais du Nord-Kivu, contrôle administratif et territorial.'),

  -- CODECO — Ituri (or)
  ('Zones aurifères Djugu',   'MINE',          'or',           'CD54', 'Ituri',
   ST_SetSRID(ST_MakePoint(30.28, 1.92), 4326), 0.88,
   ARRAY['CODECO'], 'Sites d''orpaillage en Ituri, enjeux Lendu/Hema. Haute conflictualité 2019–2021.'),

  ('Bunia (ville)',            'VILLE_RELAIS',  NULL,          'CD54', 'Ituri',
   ST_SetSRID(ST_MakePoint(30.23, 1.57), 4326), 0.70,
   ARRAY['CODECO', 'ADF'], 'Chef-lieu Ituri. Enjeu de contrôle administratif et accès humanitaire.'),

  ('Zones aurifères Mahagi',  'MINE',          'or',           'CD54', 'Ituri',
   ST_SetSRID(ST_MakePoint(30.99, 2.29), 4326), 0.78,
   ARRAY['CODECO'], 'Orpaillage artisanal, dimension intercommunautaire Lendu.'),

  -- ADF — Beni / Grand Nord
  ('Forêt Beni–Mambasa',     'BASTION',        'refuge',      'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(28.95, 0.50), 4326), 0.85,
   ARRAY['ADF'], 'Zone refuge forestière ADF. Incursions, pas de contrôle territorial fixe.'),

  ('Beni ville',              'VILLE_RELAIS',  NULL,           'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(29.47, 0.49), 4326), 0.72,
   ARRAY['ADF'], 'Ville cible des attaques ADF. Massacres réguliers depuis 2014.'),

  -- Mobondo — Maï-Ndombe / Kwilu / accès Kinshasa
  ('Maluku (accès Kinshasa)', 'VILLE_RELAIS',  'terres',       'CD10', 'Kinshasa',
   ST_SetSRID(ST_MakePoint(15.58, -4.03), 4326), 0.72,
   ARRAY['Mobondo'], 'Seul groupe dont l''expansion atteint la périphérie de Kinshasa. Conflit foncier Teke-Yaka.'),

  ('Kwamouth',                'VILLE_RELAIS',  'terres',       'CD23', 'Maï-Ndombe',
   ST_SetSRID(ST_MakePoint(16.19, -3.17), 4326), 0.78,
   ARRAY['Mobondo'], 'Épicentre du conflit Mobondo. Terres coutumières Teke vs Yaka.'),

  ('Axe Kwamouth–Kimvula',   'AXE_COMMERCIAL', 'corridor',    'CD20', 'Kongo-Central',
   ST_SetSRID(ST_MakePoint(15.50, -5.50), 4326), 0.65,
   ARRAY['Mobondo'], 'Extension vers Kongo-Central. Kimvula = zone d''expansion 2024.'),

  -- FDLR — Kivus
  ('Walikale (mines)',        'MINE',           'cassitérite', 'CD61', 'Nord-Kivu',
   ST_SetSRID(ST_MakePoint(28.04, -1.43), 4326), 0.75,
   ARRAY['FDLR-FOCA'], 'Zone minière cassitérite. FDLR taxe les mineurs artisanaux.'),

  ('Shabunda',                'BASTION',        NULL,          'CD62', 'Sud-Kivu',
   ST_SetSRID(ST_MakePoint(27.34, -2.68), 4326), 0.70,
   ARRAY['FDLR-FOCA'], 'Territoire refuge FDLR en forêt équatoriale du Sud-Kivu.')

ON CONFLICT DO NOTHING;
