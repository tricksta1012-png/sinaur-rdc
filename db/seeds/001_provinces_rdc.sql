-- Seed 001: 26 Provinces de la RDC (niveau 1)
-- P-codes OCHA COD-AB — données de démonstration
-- Source officielle : https://data.humdata.org/dataset/cod-ab-cod

INSERT INTO admin_divisions (pcode, name, name_fr, level, parent_pcode, population, is_active)
VALUES
  -- Pays
  ('COD', 'République Démocratique du Congo', 'République Démocratique du Congo', 0, NULL, 99010000, TRUE),

  -- 26 Provinces (level 1) — données approximatives pour le seed
  ('CD01', 'Kinshasa',          'Kinshasa',          1, 'COD', 15628085, TRUE),
  ('CD02', 'Kongo-Central',     'Kongo-Central',     1, 'COD',  6077440, TRUE),
  ('CD03', 'Kwango',            'Kwango',             1, 'COD',  3041637, TRUE),
  ('CD04', 'Kwilu',             'Kwilu',              1, 'COD',  6021153, TRUE),
  ('CD05', 'Mai-Ndombe',        'Maï-Ndombe',         1, 'COD',  2239674, TRUE),
  ('CD06', 'Kasai',             'Kasaï',              1, 'COD',  3626382, TRUE),
  ('CD07', 'Kasai-Central',     'Kasaï-Central',      1, 'COD',  4764970, TRUE),
  ('CD08', 'Kasai-Oriental',    'Kasaï-Oriental',     1, 'COD',  4060476, TRUE),
  ('CD09', 'Lomami',            'Lomami',             1, 'COD',  3404485, TRUE),
  ('CD10', 'Sankuru',           'Sankuru',            1, 'COD',  1847041, TRUE),
  ('CD11', 'Maniema',           'Maniema',            1, 'COD',  2616568, TRUE),
  ('CD12', 'Sud-Kivu',          'Sud-Kivu',           1, 'COD',  7202977, TRUE),
  ('CD13', 'Mwaro',             'Mwaro',              1, 'COD',   299960, TRUE),
  ('CD14', 'Nord-Kivu',         'Nord-Kivu',          1, 'COD',  7779621, TRUE),
  ('CD15', 'Ituri',             'Ituri',              1, 'COD',  5558617, TRUE),
  ('CD16', 'Haut-Uele',         'Haut-Uélé',          1, 'COD',  2387893, TRUE),
  ('CD17', 'Tshopo',            'Tshopo',             1, 'COD',  3069555, TRUE),
  ('CD18', 'Bas-Uele',          'Bas-Uélé',           1, 'COD',  1494706, TRUE),
  ('CD19', 'Nord-Ubangi',       'Nord-Ubangi',        1, 'COD',  2261136, TRUE),
  ('CD20', 'Mongala',           'Mongala',            1, 'COD',  2130296, TRUE),
  ('CD21', 'Sud-Ubangi',        'Sud-Ubangi',         1, 'COD',  5063608, TRUE),
  ('CD22', 'Equateur',          'Équateur',           1, 'COD',  2512061, TRUE),
  ('CD23', 'Tshuapa',           'Tshuapa',            1, 'COD',  2017809, TRUE),
  ('CD24', 'Tanganyika',        'Tanganyika',         1, 'COD',  2720000, TRUE),
  ('CD25', 'Haut-Lomami',       'Haut-Lomami',        1, 'COD',  3600000, TRUE),
  ('CD26', 'Lualaba',           'Lualaba',            1, 'COD',  3100000, TRUE),
  ('CD27', 'Haut-Katanga',      'Haut-Katanga',       1, 'COD',  6110000, TRUE)
ON CONFLICT (pcode) DO NOTHING;

-- NOTE: Les coordonnées géographiques (centroid, geometry) seront importées
-- séparément via le script d'import COD-AB depuis HDX :
--   pnpm --filter @sinaur/api db:import-cod-ab
-- Source : https://data.humdata.org/dataset/cod-ab-cod
