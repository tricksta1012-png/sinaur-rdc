-- =============================================================================
-- SINAUR-RDC — Seed 004: Catastrophes historiques RDC (2000-2025)
-- ~70 événements réels documentés par OCHA, ReliefWeb, EM-DAT, GDACS
-- Idempotent: INSERT ... ON CONFLICT (id) DO NOTHING
-- =============================================================================

-- ============================================================
-- ÉRUPTIONS VOLCANIQUES
-- ============================================================

INSERT INTO disaster_events (
  id, title, description, hazard_type, status, severity, confidence,
  source, source_url, glide_number,
  location_pcode, location_name, location_level, location_accuracy,
  location_point,
  estimated_affected, start_date, end_date, tags
) VALUES

-- 01 Nyiragongo 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000001',
  'Éruption du Nyiragongo — Goma 2021',
  'Le volcan Nyiragongo est entré en éruption le 22 mai 2021. Des coulées de lave ont atteint la périphérie nord de Goma, tuant au moins 32 personnes et déplaçant environ 400 000 habitants. Des séismes secondaires ont suivi plusieurs jours après l''éruption principale.',
  'volcanic_eruption', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/vo-2021-000069-cod', 'VO-2021-000069-COD',
  'CD14', 'Goma, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  400000, '2021-05-22 19:58:00+00', '2021-06-15 00:00:00+00',
  ARRAY['nyiragongo','lave','goma','deplacement','nord-kivu']
),

-- 02 Nyiragongo 2002
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000002',
  'Éruption du Nyiragongo — Goma 2002',
  'Éruption majeure du Nyiragongo le 17 janvier 2002. La lave a traversé Goma jusqu''au lac Kivu. Plus de 350 000 personnes ont fui vers Gisenyi (Rwanda). 147 personnes sont mortes, essentiellement dans des explosions de gaz au contact de la lave et du lac.',
  'volcanic_eruption', 'resolved', 'Extreme', 'high',
  'reliefweb', 'https://reliefweb.int/disaster/vo-2002-000006-cod', 'VO-2002-000006-COD',
  'CD14', 'Goma, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  350000, '2002-01-17 00:00:00+00', '2002-03-01 00:00:00+00',
  ARRAY['nyiragongo','lave','goma','2002','lac-kivu']
),

-- 03 Nyamulagira 2011
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000003',
  'Éruption du Nyamulagira — Masisi 2011',
  'Le Nyamulagira est entré en éruption le 6 novembre 2011, générant d''importants nuages de cendres et des coulées de lave dans le parc national des Virunga. Aucune victime directe signalée mais des milliers de déplacés dans les zones rurales environnantes.',
  'volcanic_eruption', 'resolved', 'Severe', 'high',
  'reliefweb', 'https://reliefweb.int/disaster/vo-2011-000190-cod', 'VO-2011-000190-COD',
  'CD14', 'Parc des Virunga, Nord-Kivu', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(28.8167, -1.4000), 4326),
  8000, '2011-11-06 00:00:00+00', '2011-12-20 00:00:00+00',
  ARRAY['nyamulagira','virunga','nord-kivu','cendres']
),

-- 04 Nyamulagira 2014
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000004',
  'Éruption du Nyamulagira — Virunga 2014',
  'Nouvelle éruption du Nyamulagira en janvier 2014 dans le parc des Virunga. Des coulées de lave ont été observées sur les flancs nord du volcan. Perturbation des activités agricoles dans les zones avoisinantes et impact sur la faune du parc.',
  'volcanic_eruption', 'resolved', 'Moderate', 'high',
  'reliefweb', NULL, NULL,
  'CD14', 'Parc des Virunga, Nord-Kivu', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(28.8167, -1.4000), 4326),
  3000, '2014-01-20 00:00:00+00', '2014-02-28 00:00:00+00',
  ARRAY['nyamulagira','virunga','nord-kivu','2014']
),

-- ============================================================
-- ÉPIDÉMIES — EBOLA
-- ============================================================

-- 05 Ebola 2018-2020 (10e épidémie, la plus meurtrière en RDC)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000005',
  'Épidémie Ebola — Nord-Kivu et Ituri 2018-2020',
  '10e épidémie de maladie à virus Ebola en RDC, la plus grave de l''histoire du pays. Déclarée le 1er août 2018 à Mangina (Nord-Kivu), elle s''est étendue à Ituri. 3 481 cas confirmés, 2 299 décès. Contexte sécuritaire extrêmement difficile (ADF, groupes armés). Réponse vaccinale rVSV-ZEBOV-GP.',
  'health_epidemic', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2018-000145-cod', 'EP-2018-000145-COD',
  'CD14', 'Mangina / Beni, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.4731, 0.4920), 4326),
  3481, '2018-08-01 00:00:00+00', '2020-06-25 00:00:00+00',
  ARRAY['ebola','mvd','nord-kivu','ituri','mangina','beni','vaccin','rvsvzebov']
),

-- 06 Ebola 2022 — Beni
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000006',
  'Épidémie Ebola — Beni 2022 (11e épidémie)',
  '11e épidémie d''Ebola en RDC, déclarée le 23 avril 2022 à Beni, Nord-Kivu. 7 cas confirmés, 5 décès. Réponse rapide grâce à l''expérience de la 10e épidémie. Fin déclarée le 4 juillet 2022.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2022-000108-cod', NULL,
  'CD14', 'Beni, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.4731, 0.4920), 4326),
  7, '2022-04-23 00:00:00+00', '2022-07-04 00:00:00+00',
  ARRAY['ebola','mvd','nord-kivu','beni','2022']
),

-- 07 Ebola 2017 — Likati (Bas-Uélé)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000007',
  'Épidémie Ebola — Likati, Bas-Uélé 2017',
  '9e épidémie d''Ebola en RDC, déclarée le 11 mai 2017 dans la zone de santé de Likati, province du Bas-Uélé. 8 cas confirmés, 4 décès. Contexte d''accès difficile dans une zone forestière reculée. Fin déclarée le 2 juillet 2017.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2017-000055-cod', 'EP-2017-000055-COD',
  'CD18', 'Likati, Bas-Uélé', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(24.0000, 3.2000), 4326),
  8, '2017-05-11 00:00:00+00', '2017-07-02 00:00:00+00',
  ARRAY['ebola','mvd','bas-uele','likati','2017']
),

-- 08 Ebola 2014 — Boende (Équateur/Tshuapa)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000008',
  'Épidémie Ebola — Boende, Tshuapa 2014',
  '7e épidémie d''Ebola en RDC, déclarée le 26 août 2014 dans la zone de santé de Watsi Kengo, territoire de Boende, province de Tshuapa. 66 cas confirmés, 49 décès. Fin déclarée le 21 novembre 2014.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2014-000110-cod', 'EP-2014-000110-COD',
  'CD23', 'Boende, Tshuapa', 1, 'city',
  ST_SetSRID(ST_MakePoint(20.8833, -0.2167), 4326),
  66, '2014-08-26 00:00:00+00', '2014-11-21 00:00:00+00',
  ARRAY['ebola','mvd','tshuapa','boende','2014']
),

-- 09 Ebola 2007 — Luebo (Kasaï)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000009',
  'Épidémie Ebola — Luebo, Kasaï 2007',
  '5e épidémie d''Ebola sous-type Zaïre en RDC, déclarée le 10 septembre 2007 dans la zone de santé de Luebo, province du Kasaï-Occidental (aujourd''hui Kasaï). 264 cas confirmés, 187 décès (létalité 71%). L''une des épidémies les plus meurtrières du pays avant 2018.',
  'health_epidemic', 'resolved', 'Extreme', 'high',
  'reliefweb', 'https://reliefweb.int/disaster/ep-2007-000128-cod', 'EP-2007-000128-COD',
  'CD06', 'Luebo, Kasaï', 1, 'city',
  ST_SetSRID(ST_MakePoint(21.4000, -5.3500), 4326),
  264, '2007-09-10 00:00:00+00', '2007-11-20 00:00:00+00',
  ARRAY['ebola','mvd','kasai','luebo','2007','letalite']
),

-- ============================================================
-- ÉPIDÉMIES — MPOX (VARIOLE DU SINGE)
-- ============================================================

-- 10 Mpox 2023 — Clade I endémique Sankuru
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000010',
  'Épidémie Mpox Clade I — Sankuru et bassin du Congo 2023',
  'Recrudescence majeure du Mpox (variole du singe) de clade I en RDC en 2023, avec le Sankuru comme épicentre historique. Plus de 14 000 cas suspectés sur l''année dans tout le pays, dont plus de 600 décès. La RDC représente plus de 90% des cas mondiaux. Déclaration de USPPI par l''OMS en août 2024.',
  'health_epidemic', 'active', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2023-000230-cod', NULL,
  'CD10', 'Sankuru (Lusambo)', 1, 'city',
  ST_SetSRID(ST_MakePoint(23.4333, -4.9667), 4326),
  14000, '2023-01-01 00:00:00+00', NULL,
  ARRAY['mpox','monkeypox','clade-i','sankuru','omsusppi','zoonose']
),

-- 11 Mpox 2024 — Clade Ib Sud-Kivu (nouvelle émergence sexuellement transmissible)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000011',
  'Épidémie Mpox Clade Ib — Sud-Kivu 2024',
  'Émergence du Mpox Clade Ib au Sud-Kivu en 2024, variante présentant une transmission interhumaine accrue notamment par voie sexuelle. Foyers identifiés à Kamituga et Kavumu. Le clade Ib s''est ensuite propagé à plusieurs pays africains voisins. Urgence de santé publique de portée internationale déclarée.',
  'health_epidemic', 'active', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2024-000208-cod', NULL,
  'CD12', 'Kamituga, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(28.1833, -3.0500), 4326),
  5000, '2024-01-01 00:00:00+00', NULL,
  ARRAY['mpox','clade-ib','sud-kivu','kamituga','transmission-sexuelle']
),

-- ============================================================
-- ÉPIDÉMIES — CHOLÉRA
-- ============================================================

-- 12 Choléra endémique 2019-2021 — plusieurs provinces
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000012',
  'Choléra endémique — Nord-Kivu 2019-2021',
  'Le choléra sévit de manière endémique en RDC, particulièrement au Nord-Kivu. Entre 2019 et 2021, plus de 20 000 cas annuels sont enregistrés dans la province. Goma et les zones de déplacement constituent des points chauds en raison du manque d''eau potable et d''assainissement.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2019-000012-cod', NULL,
  'CD14', 'Goma et zones de déplacement, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  60000, '2019-01-01 00:00:00+00', '2021-12-31 00:00:00+00',
  ARRAY['cholera','eau','assainissement','nord-kivu','goma','endemique']
),

-- 13 Choléra flambée 2022-2023 — Kasaï
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000013',
  'Flambée de choléra — Kasaï et Kasaï-Central 2022-2023',
  'Flambée de choléra dans les provinces du Kasaï et du Kasaï-Central en 2022-2023. Plus de 8 000 cas recensés. La crise est aggravée par les inondations récurrentes qui contaminent les sources d''eau. Kananga et Tshikapa sont les zones les plus touchées.',
  'health_epidemic', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD07', 'Kananga, Kasaï-Central', 1, 'city',
  ST_SetSRID(ST_MakePoint(22.4167, -5.8833), 4326),
  8000, '2022-06-01 00:00:00+00', '2023-04-30 00:00:00+00',
  ARRAY['cholera','kasai','kananga','inondations','eau-contaminee']
),

-- 14 Choléra flambée Uvira 2024
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000014',
  'Flambée de choléra — Uvira, Sud-Kivu 2024',
  'Flambée de choléra à Uvira et dans le territoire de Fizi (Sud-Kivu) en 2024, liée aux inondations du lac Tanganyika et au déplacement de populations. Plus de 2 000 cas en quelques semaines avec un taux de létalité supérieur à 2%. Réponse UNICEF et OMS déployée.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'ocha', NULL, NULL,
  'CD12', 'Uvira, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.1383, -3.3944), 4326),
  2000, '2024-03-01 00:00:00+00', '2024-06-30 00:00:00+00',
  ARRAY['cholera','uvira','sud-kivu','lac-tanganyika','2024']
),

-- ============================================================
-- ÉPIDÉMIES — AUTRES
-- ============================================================

-- 15 COVID-19 2020 — Kinshasa
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000015',
  'Pandémie COVID-19 — Kinshasa 2020',
  'La RDC a signalé son premier cas de COVID-19 le 10 mars 2020 à Kinshasa. La capitale a été l''épicentre de la pandémie dans le pays. Confinement partiel, couvre-feu, fermeture des frontières. Plus de 90 000 cas confirmés et 1 300 décès officiellement recensés sur l''ensemble du territoire national.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'official', 'https://reliefweb.int/disaster/ep-2020-000012-cod', 'EP-2020-000012-COD',
  'CD01', 'Kinshasa', 1, 'city',
  ST_SetSRID(ST_MakePoint(15.2663, -4.3219), 4326),
  90000, '2020-03-10 00:00:00+00', '2022-12-31 00:00:00+00',
  ARRAY['covid19','pandemie','coronavirus','kinshasa','sars-cov-2']
),

-- 16 Fièvre jaune 2016 — Kinshasa et Kongo-Central
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000016',
  'Épidémie de fièvre jaune — Kinshasa 2016',
  'Épidémie de fièvre jaune déclarée en 2016 à Kinshasa et dans le Kongo-Central, en lien avec l''importation de cas d''Angola. Vaste campagne de vaccination en urgence : plus de 7 millions de personnes vaccinées à Kinshasa. Pénurie mondiale de vaccins gérée par l''OMS avec fractionnement des doses.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'official', 'https://reliefweb.int/disaster/ep-2016-000053-cod', 'EP-2016-000053-COD',
  'CD01', 'Kinshasa', 1, 'city',
  ST_SetSRID(ST_MakePoint(15.2663, -4.3219), 4326),
  56000, '2016-04-01 00:00:00+00', '2016-12-01 00:00:00+00',
  ARRAY['fievre-jaune','vaccination','kinshasa','angola','aedes-aegypti']
),

-- 17 Méningite 2023 — Haut-Uélé
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000017',
  'Flambée de méningite — Haut-Uélé 2023',
  'Flambée de méningite bactérienne (méningocoque) dans la province du Haut-Uélé en 2023. Plus de 200 cas suspects et plusieurs dizaines de décès signalés, notamment dans les zones de santé de Niangara et Wamba. Réponse vaccinale et antibiothérapie déployées par le MSSP avec l''appui de l''OMS.',
  'health_epidemic', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD16', 'Niangara, Haut-Uélé', 1, 'city',
  ST_SetSRID(ST_MakePoint(27.8833, 3.6667), 4326),
  200, '2023-03-01 00:00:00+00', '2023-07-31 00:00:00+00',
  ARRAY['meningite','meningocoque','haut-uele','niangara','bacterie']
),

-- 18 Maladie inconnue Kwango 2024 ("nkumu")
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000018',
  'Maladie mystérieuse — Kwango 2024 (Panzi)',
  'Maladie non identifiée («nkumu») ayant touché plus de 300 personnes dans la zone de santé de Panzi, territoire de Kwango, en octobre-décembre 2024. Plus de 60 décès signalés. Symptômes : fièvre, maux de tête, anémie, toux. Enquête épidémiologique déployée par le MSSP et l''OMS. Hypothèses initiales : paludisme sévère + malnutrition + infection respiratoire.',
  'health_epidemic', 'resolved', 'Extreme', 'medium',
  'official', 'https://reliefweb.int/report/democratic-republic-congo/mysterious-disease-kwango', NULL,
  'CD03', 'Panzi, Kwango', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(16.9667, -4.8333), 4326),
  300, '2024-10-01 00:00:00+00', '2025-01-31 00:00:00+00',
  ARRAY['maladie-inconnue','nkumu','kwango','panzi','enquete-epidemiologique','2024']
),

-- 19 Rougeole 2020 — national (pic épidémique)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000019',
  'Épidémie de rougeole — nationale 2020',
  'La RDC a connu en 2020 la plus grande épidémie de rougeole du monde, avec plus de 300 000 cas et 6 000 décès. Le Nord-Kivu, le Maniema, le Kasaï-Central et l''Équateur ont été les provinces les plus touchées. Vaccination réactive déployée dans les zones les plus affectées.',
  'health_epidemic', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2020-000005-cod', NULL,
  'CD14', 'Nord-Kivu (épicentre national)', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  300000, '2020-01-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['rougeole','vaccination','enfants','nord-kivu','national','2020']
),

-- ============================================================
-- INONDATIONS
-- ============================================================

-- 20 Inondations Kalehe — Mai 2023 (catastrophique)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000020',
  'Inondations et glissements de terrain — Kalehe 2023',
  'Catastrophe majeure du 4-5 mai 2023 à Nyamukubi et Bushushu (territoire de Kalehe, Sud-Kivu). Des pluies torrentielles ont provoqué des crues soudaines et glissements de terrain massifs sur les rives du lac Kivu. Au moins 430 morts et 5 000 disparus selon les estimations. Des villages entiers ont été ensevelis. Plus de 7 000 familles déplacées.',
  'flood', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/fl-2023-000063-cod', 'FL-2023-000063-COD',
  'CD12', 'Kalehe (Nyamukubi-Bushushu), Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(28.9036, -2.0964), 4326),
  50000, '2023-05-04 00:00:00+00', '2023-07-31 00:00:00+00',
  ARRAY['inondation','glissement','kalehe','bushushu','nyamukubi','lac-kivu','sud-kivu','catastrophe']
),

-- 21 Inondations Uvira 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000021',
  'Inondations — Uvira, Sud-Kivu 2020',
  'Inondations sévères à Uvira en décembre 2020, causées par la montée du lac Tanganyika et des rivières Mulongwe et Ruzizi. Environ 30 000 personnes déplacées. Des milliers de maisons détruites ou endommagées. Contamination des sources d''eau potable.',
  'flood', 'resolved', 'Severe', 'high',
  'ocha', 'https://reliefweb.int/disaster/fl-2020-000260-cod', NULL,
  'CD12', 'Uvira, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.1383, -3.3944), 4326),
  30000, '2020-12-01 00:00:00+00', '2021-01-31 00:00:00+00',
  ARRAY['inondation','uvira','lac-tanganyika','ruzizi','sud-kivu','2020']
),

-- 22 Inondations Uvira 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000022',
  'Inondations — Uvira et Fizi 2022',
  'Nouvelles inondations à Uvira et dans le territoire de Fizi en 2022. La montée exceptionnelle du lac Tanganyika (+2 m par rapport au niveau normal) a submergé plusieurs quartiers d''Uvira et des villages côtiers. Plus de 15 000 personnes affectées.',
  'flood', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD12', 'Uvira et Fizi, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.1383, -3.3944), 4326),
  15000, '2022-04-01 00:00:00+00', '2022-07-31 00:00:00+00',
  ARRAY['inondation','uvira','fizi','lac-tanganyika','sud-kivu','2022']
),

-- 23 Inondations Kinshasa 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000023',
  'Inondations — Kinshasa 2022',
  'Fortes inondations à Kinshasa en mars-avril 2022, affectant les communes de Kimbanseke, Kisenso, N''Djili et Masina. Des pluies exceptionnelles ont provoqué des crues des rivières N''Djili et Kalamu. Au moins 169 morts et 16 000 familles sinistrées selon la OCHA. Destruction de logements et d''infrastructures scolaires.',
  'flood', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/fl-2022-000072-cod', NULL,
  'CD01', 'Kinshasa (Kimbanseke, Kisenso, Masina)', 1, 'city',
  ST_SetSRID(ST_MakePoint(15.3333, -4.3333), 4326),
  80000, '2022-03-15 00:00:00+00', '2022-05-31 00:00:00+00',
  ARRAY['inondation','kinshasa','kimbanseke','kisenso','ndjili','2022']
),

-- 24 Inondations Kinshasa 2023
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000024',
  'Inondations — Kinshasa 2023',
  'Inondations récurrentes à Kinshasa en 2023 lors des saisons des pluies (avril et novembre). Les communes de Limete, Mont-Ngafula et Ngaliema particulièrement touchées. Plus de 10 000 familles déplacées sur l''ensemble de la saison. Problème structurel de drainage dans la capitale.',
  'flood', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD01', 'Kinshasa (Limete, Mont-Ngafula)', 1, 'city',
  ST_SetSRID(ST_MakePoint(15.2663, -4.3219), 4326),
  50000, '2023-04-01 00:00:00+00', '2023-12-31 00:00:00+00',
  ARRAY['inondation','kinshasa','limete','mont-ngafula','drainage','2023']
),

-- 25 Inondations Kinshasa 2024
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000025',
  'Inondations — Kinshasa janvier 2024',
  'Inondations sévères à Kinshasa en janvier 2024, provoquant la mort d''au moins 58 personnes et le déplacement de 50 000 habitants. Les communes de Kimbanseke et Kingabwa parmi les plus touchées. Déclaration d''état d''urgence locale par le gouverneur de la ville-province.',
  'flood', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/fl-2024-000028-cod', NULL,
  'CD01', 'Kinshasa', 1, 'city',
  ST_SetSRID(ST_MakePoint(15.2663, -4.3219), 4326),
  50000, '2024-01-13 00:00:00+00', '2024-03-31 00:00:00+00',
  ARRAY['inondation','kinshasa','kimbanseke','kingabwa','2024','urgence']
),

-- 26 Inondations Butembo 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000026',
  'Inondations — Butembo, Nord-Kivu 2021',
  'Inondations à Butembo (Nord-Kivu) en octobre 2021 suite à des pluies diluviennes. La rivière Kimemi est sortie de son lit, détruisant plusieurs quartiers périphériques. Environ 5 000 personnes déplacées et des dizaines de maisons détruites.',
  'flood', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD14', 'Butembo, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2827, 0.1322), 4326),
  5000, '2021-10-15 00:00:00+00', '2021-11-30 00:00:00+00',
  ARRAY['inondation','butembo','nord-kivu','kimemi','2021']
),

-- 27 Inondations Butembo 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000027',
  'Inondations — Butembo, Nord-Kivu 2022',
  'Nouvelles inondations à Butembo en juin 2022. Les quartiers de Butsili et Vulamba ont été les plus affectés, avec environ 8 000 personnes déplacées. Dommages importants aux axes routiers et au système d''adduction d''eau.',
  'flood', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD14', 'Butembo, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2827, 0.1322), 4326),
  8000, '2022-06-01 00:00:00+00', '2022-07-31 00:00:00+00',
  ARRAY['inondation','butembo','nord-kivu','2022']
),

-- 28 Inondations Mbandaka 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000028',
  'Inondations — Mbandaka, Équateur 2020',
  'Inondations à Mbandaka (province de l''Équateur) en 2020 dues à la montée du fleuve Congo et de ses affluents. Des quartiers entiers submergés. Environ 20 000 personnes affectées. Accès humanitaire perturbé par les eaux.',
  'flood', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD22', 'Mbandaka, Équateur', 1, 'city',
  ST_SetSRID(ST_MakePoint(18.2833, 0.0500), 4326),
  20000, '2020-09-01 00:00:00+00', '2020-11-30 00:00:00+00',
  ARRAY['inondation','mbandaka','equateur','fleuve-congo','2020']
),

-- 29 Inondations Kalemie 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000029',
  'Inondations — Kalemie, Tanganyika 2022',
  'Inondations provoquées par la crue du lac Tanganyika à Kalemie en 2022. Le lac Tanganyika a atteint son niveau le plus haut depuis des décennies. Des milliers de personnes ont perdu leurs habitations, leurs récoltes et leurs moyens de subsistance dans le territoire de Kalemie.',
  'flood', 'resolved', 'Severe', 'high',
  'ocha', NULL, NULL,
  'CD24', 'Kalemie, Tanganyika', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.1833, -5.9333), 4326),
  25000, '2022-02-01 00:00:00+00', '2022-06-30 00:00:00+00',
  ARRAY['inondation','kalemie','tanganyika','lac-tanganyika','2022']
),

-- 30 Inondations Lubumbashi 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000030',
  'Inondations — Lubumbashi, Haut-Katanga 2021',
  'Inondations à Lubumbashi en janvier 2021 suite à des pluies exceptionnelles. La rivière Lubumbashi a débordé, affectant les communes de Katuba et Kampemba. Environ 3 000 ménages sinistrés, plusieurs morts. Problème récurrent d''urbanisation incontrôlée dans les bassins versants.',
  'flood', 'resolved', 'Moderate', 'medium',
  'official', NULL, NULL,
  'CD27', 'Lubumbashi, Haut-Katanga', 1, 'city',
  ST_SetSRID(ST_MakePoint(27.4667, -11.6667), 4326),
  15000, '2021-01-10 00:00:00+00', '2021-03-31 00:00:00+00',
  ARRAY['inondation','lubumbashi','haut-katanga','katuba','kampemba','2021']
),

-- 31 Inondations Kisangani 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000031',
  'Inondations — Kisangani, Tshopo 2021',
  'Inondations dans les quartiers riverains de Kisangani (province de la Tshopo) en 2021. La montée du fleuve Congo a submergé les communes de Makiso et Mangobo. Environ 12 000 personnes affectées, destructions de logements et de champs maraîchers.',
  'flood', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD17', 'Kisangani, Tshopo', 1, 'city',
  ST_SetSRID(ST_MakePoint(25.1833, 0.5333), 4326),
  12000, '2021-09-01 00:00:00+00', '2021-10-31 00:00:00+00',
  ARRAY['inondation','kisangani','tshopo','fleuve-congo','2021']
),

-- 32 Inondations Matadi 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000032',
  'Inondations — Matadi, Kongo-Central 2020',
  'Inondations et glissements de terrain à Matadi (Kongo-Central) en 2020. Plusieurs quartiers situés sur les versants du ravin de Matadi ont été endommagés. Au moins 10 morts et plusieurs centaines de sans-abri.',
  'flood', 'resolved', 'Moderate', 'medium',
  'official', NULL, NULL,
  'CD02', 'Matadi, Kongo-Central', 1, 'city',
  ST_SetSRID(ST_MakePoint(13.4500, -5.8167), 4326),
  3000, '2020-11-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['inondation','matadi','kongo-central','glissement','2020']
),

-- 33 Inondations Goma 2024
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000033',
  'Inondations — Goma, Nord-Kivu 2024',
  'Inondations à Goma en 2024 aggravées par l''afflux massif de déplacés (M23) qui s''installent dans des zones inondables. Des camps de déplacés surpeuplés ont été submergés. La combinaison de déplacement de masse et d''inondations a créé une urgence humanitaire complexe.',
  'flood', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD14', 'Goma, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  40000, '2024-04-01 00:00:00+00', '2024-08-31 00:00:00+00',
  ARRAY['inondation','goma','nord-kivu','deplacement','m23','camps','2024']
),

-- ============================================================
-- GLISSEMENTS DE TERRAIN
-- ============================================================

-- 34 Glissement de terrain Kalehe-Bushushu mai 2023 (voir aussi event 20)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000034',
  'Glissement de terrain — Nyamukubi, Kalehe 2023',
  'Glissement de terrain dévastateur sur le site de Nyamukubi (Kalehe) dans la nuit du 4 au 5 mai 2023. La coulée de boue a englouti des centaines de maisons. Ce glissement, combiné aux crues de rivières voisines, a causé plus de 400 morts confirmés et des milliers de disparus. C''est l''une des plus grandes catastrophes naturelles de l''histoire récente de la RDC.',
  'landslide', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ls-2023-000062-cod', 'LS-2023-000062-COD',
  'CD12', 'Nyamukubi, Kalehe, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(28.9036, -2.0964), 4326),
  40000, '2023-05-04 22:00:00+00', '2023-06-30 00:00:00+00',
  ARRAY['glissement','coulée-de-boue','nyamukubi','kalehe','sud-kivu','catastrophe','2023']
),

-- 35 Glissement de terrain Uvira 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000035',
  'Glissement de terrain — Uvira, Sud-Kivu 2020',
  'Glissement de terrain en zone périurbaine d''Uvira en 2020 à la suite de pluies intenses. Plusieurs maisons ensevelies, au moins 5 morts et une vingtaine de blessés. Les populations construisant sur des pentes instables en surplomb du lac Tanganyika restent très exposées.',
  'landslide', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD12', 'Uvira, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.1383, -3.3944), 4326),
  500, '2020-10-15 00:00:00+00', '2020-11-15 00:00:00+00',
  ARRAY['glissement','uvira','sud-kivu','pentes','lac-tanganyika','2020']
),

-- 36 Glissement de terrain Masisi 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000036',
  'Glissement de terrain — Masisi, Nord-Kivu 2022',
  'Glissement de terrain dans le territoire de Masisi (Nord-Kivu) en 2022, affectant plusieurs villages dans les hauts plateaux. Une vingtaine de morts signalés. Les collines déboisées du Kivu sont très vulnérables à ce type d''aléa lors des saisons des pluies.',
  'landslide', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD14', 'Masisi, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(28.8167, -1.4000), 4326),
  2000, '2022-09-10 00:00:00+00', '2022-10-30 00:00:00+00',
  ARRAY['glissement','masisi','nord-kivu','deforestation','2022']
),

-- 37 Glissement de terrain Rutshuru 2023
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000037',
  'Glissement de terrain — Rutshuru, Nord-Kivu 2023',
  'Glissement de terrain dans le territoire de Rutshuru (Nord-Kivu) en 2023, dans un contexte de conflit armé (M23) rendant l''accès humanitaire difficile. Des villages isolés ont été ensevelis, avec des victimes non encore comptabilisées. L''insécurité a retardé les secours.',
  'landslide', 'resolved', 'Severe', 'low',
  'ocha', NULL, NULL,
  'CD14', 'Rutshuru, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.4500, -1.1833), 4326),
  3000, '2023-09-01 00:00:00+00', '2023-10-31 00:00:00+00',
  ARRAY['glissement','rutshuru','nord-kivu','m23','acces-humanitaire','2023']
),

-- ============================================================
-- CONFLITS ET DÉPLACEMENTS
-- ============================================================

-- 38 Crise du Kasaï 2016-2017
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000038',
  'Crise sécuritaire du Kasaï — 2016-2017',
  'Violence massive déclenchée par la milice Kamuina Nsapu au Kasaï à partir d''août 2016, en réaction à la mort du chef coutumier Jean-Pierre Pandi. La crise s''est étendue aux provinces du Kasaï-Oriental, Kasaï-Central, Lomami et Sankuru. Au moins 5 000 morts civils, 1,4 million de déplacés internes et 140 fosses communes découvertes. Crimes contre l''humanité documentés.',
  'conflict', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ce-2017-000024-cod', 'CE-2017-000024-COD',
  'CD06', 'Kasaï (Tshikapa et Grand-Kasaï)', 1, 'city',
  ST_SetSRID(ST_MakePoint(20.8000, -6.4167), 4326),
  1400000, '2016-08-01 00:00:00+00', '2018-06-30 00:00:00+00',
  ARRAY['conflit','kasai','kamuina-nsapu','fosses-communes','deplacement','milice','2016']
),

-- 39 Massacres ADF — Beni 2019-2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000039',
  'Massacres ADF — territoire de Beni 2019-2020',
  'Les Forces démocratiques alliées (ADF), groupe armé islamiste ougandais basé dans le parc de Virunga, ont commis des massacres de civils dans le territoire de Beni entre 2019 et 2020. Plus de 1 000 civils tués en une seule année selon les Nations Unies. Des villages ont été incendiés et des populations entières ont fui.',
  'conflict', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ce-2019-000108-cod', NULL,
  'CD14', 'Territoire de Beni, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.4731, 0.4920), 4326),
  300000, '2019-01-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['conflit','adf','beni','massacres','nord-kivu','virunga','islamiste']
),

-- 40 Résurgence M23 2022-2023
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000040',
  'Résurgence M23 — Nord-Kivu 2022-2023',
  'Le groupe armé M23, soutenu par le Rwanda selon les Nations Unies, a repris ses offensives au Nord-Kivu à partir de novembre 2021. En 2022-2023, le M23 a progressivement pris le contrôle de vastes territoires incluant Rutshuru, Kiwanja et s''est approché de Goma. Plus de 1,5 million de personnes déplacées supplémentaires dans la province.',
  'conflict', 'active', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ce-2022-000245-cod', NULL,
  'CD14', 'Rutshuru / Kiwanja, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.3667, -1.0500), 4326),
  1500000, '2022-03-01 00:00:00+00', NULL,
  ARRAY['conflit','m23','nord-kivu','rutshuru','kiwanja','rwanda','deplacement']
),

-- 41 Conflit CODECO — Djugu, Ituri 2020-2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000041',
  'Violences CODECO — Djugu, Ituri 2020-2022',
  'La milice CODECO (Coopérative pour le développement du Congo) a mené des attaques meurtrières contre des villages lendu et hema dans le territoire de Djugu (Ituri) entre 2020 et 2022. Plus de 500 civils tués et 1,6 million de personnes déplacées dans la province au plus fort de la crise.',
  'conflict', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ce-2020-000085-cod', NULL,
  'CD15', 'Djugu, Ituri', 1, 'city',
  ST_SetSRID(ST_MakePoint(30.5000, 1.9167), 4326),
  1600000, '2020-01-01 00:00:00+00', '2022-12-31 00:00:00+00',
  ARRAY['conflit','codeco','djugu','ituri','hema','lendu','deplacement']
),

-- 42 M23 — Kiwanja-Rutshuru 2024
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000042',
  'Crise M23 — prise de Goma et Bukavu 2024-2025',
  'En janvier 2025, le M23 a pris le contrôle de Goma, capitale provinciale du Nord-Kivu, après des combats intenses. Bukavu (Sud-Kivu) est tombée en février 2025. La crise a provoqué le plus grand mouvement de déplacement de l''histoire récente de la RDC : plus de 7 millions de personnes déplacées dans l''est du pays. Catastrophe humanitaire de niveau 3 (OCHA).',
  'conflict', 'active', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/disaster/ce-2025-000012-cod', NULL,
  'CD14', 'Goma, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  7000000, '2024-10-01 00:00:00+00', NULL,
  ARRAY['conflit','m23','goma','bukavu','deplacement','urgence-niveau3','2025']
),

-- 43 Conflit Sud-Kivu — Minembwe 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000043',
  'Violences intercommunautaires — Hauts Plateaux Sud-Kivu 2021',
  'Regain de violences intercommunautaires sur les hauts plateaux de Minembwe (Sud-Kivu) en 2021 entre groupes armés Bafuliru/Babembe et éleveurs Banyamulenge. Des dizaines de villages brûlés, des centaines de morts et plus de 100 000 déplacés dans les territoires de Fizi, Uvira et Mwenga.',
  'conflict', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD12', 'Minembwe, hauts plateaux Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(28.7667, -3.5833), 4326),
  100000, '2021-01-01 00:00:00+00', '2022-06-30 00:00:00+00',
  ARRAY['conflit','minembwe','hauts-plateaux','banyamulenge','fizi','uvira','sud-kivu']
),

-- 44 Conflit Fizi 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000044',
  'Violences — Territoire de Fizi, Sud-Kivu 2022',
  'Regain de violence dans le territoire de Fizi (Sud-Kivu) en 2022, impliquant plusieurs groupes armés locaux. Des attaques contre des civils et des pillages ont provoqué le déplacement de dizaines de milliers de personnes vers Baraka et Uvira.',
  'conflict', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD12', 'Fizi, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.0983, -4.2964), 4326),
  30000, '2022-01-01 00:00:00+00', '2022-09-30 00:00:00+00',
  ARRAY['conflit','fizi','sud-kivu','groupes-armes','baraka','2022']
),

-- ============================================================
-- DÉPLACEMENTS DE MASSE
-- ============================================================

-- 45 Crise humanitaire Est-RDC 2023
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000045',
  'Crise humanitaire — Est-RDC 2023 (6,9 millions de déplacés)',
  'En 2023, la RDC comptait 6,9 millions de personnes déplacées internes, le chiffre le plus élevé d''Afrique. L''est du pays (Nord-Kivu, Sud-Kivu, Ituri, Tanganyika) concentre la majorité des déplacés. La combinaison de conflits armés, catastrophes naturelles et épidémies crée une crise humanitaire exceptionnelle.',
  'mass_displacement', 'active', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/report/democratic-republic-congo/drc-humanitarian-overview-2023', NULL,
  'CD14', 'Est de la RDC (Nord-Kivu, Sud-Kivu, Ituri)', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  6900000, '2023-01-01 00:00:00+00', NULL,
  ARRAY['deplacement','est-rdc','humanitarian','nord-kivu','sud-kivu','ituri','pdis']
),

-- 46 Déplacés Rutshuru 2023
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000046',
  'Déplacement massif — Rutshuru vers Goma 2023',
  'Les offensives du M23 dans le territoire de Rutshuru en 2023 ont provoqué des vagues de déplacements massifs vers Goma. Les camps de Bulengo et Lushagala ont accueilli plus de 500 000 personnes dans des conditions précaires. La densité des camps a alimenté les épidémies de choléra et de rougeole.',
  'mass_displacement', 'active', 'Extreme', 'high',
  'ocha', NULL, NULL,
  'CD14', 'Camps de Bulengo / Lushagala, Goma', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  500000, '2023-02-01 00:00:00+00', NULL,
  ARRAY['deplacement','rutshuru','goma','bulengo','lushagala','m23','camps']
),

-- 47 Réfugiés nord-ougandais — Ituri 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000047',
  'Déplacement — Bunia et territoire de Djugu, Ituri 2022',
  'Les violences des groupes armés (CODECO, FPIC et autres) ont continué de générer des vagues de déplacement dans l''Ituri en 2022. Bunia accueille des centaines de milliers de déplacés dans des conditions précaires. Les attaques sur les convois humanitaires ont rendu l''accès très difficile.',
  'mass_displacement', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD15', 'Bunia, Ituri', 1, 'city',
  ST_SetSRID(ST_MakePoint(30.2500, 1.5667), 4326),
  800000, '2022-01-01 00:00:00+00', '2022-12-31 00:00:00+00',
  ARRAY['deplacement','bunia','ituri','codeco','camps','humanitaire']
),

-- ============================================================
-- SÉCHERESSES
-- ============================================================

-- 48 Sécheresse Grand-Kasaï 2019-2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000048',
  'Sécheresse et insécurité alimentaire — Grand-Kasaï 2019-2020',
  'Déficit pluviométrique sévère dans le Grand-Kasaï entre 2019 et 2020, aggravé par les séquelles de la crise sécuritaire de 2016-2017. Selon le Cadre IPC, plus de 6 millions de personnes en phase 3 (crise) ou 4 (urgence) alimentaire. La malnutrition aiguë globale (MAG) dépassait les seuils d''urgence dans plusieurs zones de santé.',
  'drought', 'resolved', 'Severe', 'high',
  'fews_net', 'https://fews.net/central-africa/drc', NULL,
  'CD06', 'Grand-Kasaï (Kasaï, Kasaï-Central, Kasaï-Oriental)', 1, 'city',
  ST_SetSRID(ST_MakePoint(20.8000, -6.4167), 4326),
  6000000, '2019-04-01 00:00:00+00', '2020-06-30 00:00:00+00',
  ARRAY['secheresse','insecurite-alimentaire','kasai','malnutrition','ipc','fews-net']
),

-- 49 Sécheresse Tanganyika 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000049',
  'Sécheresse — Tanganyika 2022',
  'Déficit de pluies et sécheresse dans la province du Tanganyika en 2022, affectant les cultures maraîchères et vivrières. Les districts de Kalemie et Kongolo particulièrement touchés. FEWS NET a signalé des niveaux de crise alimentaire (IPC 3) dans plusieurs territoires.',
  'drought', 'resolved', 'Moderate', 'medium',
  'fews_net', NULL, NULL,
  'CD24', 'Tanganyika (Kalemie, Kongolo)', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.1833, -5.9333), 4326),
  500000, '2022-06-01 00:00:00+00', '2022-11-30 00:00:00+00',
  ARRAY['secheresse','tanganyika','kalemie','insecurite-alimentaire','2022']
),

-- 50 Sécheresse Haut-Lomami 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000050',
  'Sécheresse — Haut-Lomami 2021',
  'Sécheresse affectant la province du Haut-Lomami en 2021. Les saisons agricoles A et B ont été compromises par un retard et une insuffisance des pluies. Plusieurs centaines de milliers de personnes en situation d''insécurité alimentaire. La région de Kamina a été la plus touchée.',
  'drought', 'resolved', 'Moderate', 'medium',
  'fews_net', NULL, NULL,
  'CD25', 'Kamina, Haut-Lomami', 1, 'city',
  ST_SetSRID(ST_MakePoint(24.9833, -8.7333), 4326),
  400000, '2021-05-01 00:00:00+00', '2021-12-31 00:00:00+00',
  ARRAY['secheresse','haut-lomami','kamina','agriculture','2021']
),

-- ============================================================
-- CRISES HUMANITAIRES COMPLEXES
-- ============================================================

-- 51 Crise humanitaire nationale 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000051',
  'Crise humanitaire nationale — RDC 2020',
  'En 2020, la RDC était le pays avec le plus grand nombre de personnes dans le besoin d''aide humanitaire au monde après le Yémen et la Syrie. 19,6 millions de personnes en insécurité alimentaire aiguë. La triple crise (COVID-19 + Ebola + conflits) a paralysé la réponse humanitaire. Plan de réponse humanitaire de 1,98 milliard USD requis.',
  'humanitarian_crisis', 'resolved', 'Extreme', 'high',
  'ocha', 'https://reliefweb.int/report/democratic-republic-congo/drc-humanitarian-response-plan-2020', NULL,
  'CD01', 'République Démocratique du Congo (national)', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(24.0000, -3.5000), 4326),
  19600000, '2020-01-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['crise-humanitaire','national','covid19','ebola','conflits','insecurite-alimentaire','2020']
),

-- 52 Crise alimentaire Ituri 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000052',
  'Crise alimentaire et humanitaire — Ituri 2020',
  'La combinaison des violences CODECO, des déplacements massifs et du COVID-19 a créé une crise humanitaire sans précédent en Ituri en 2020. Plus de 1,5 million de personnes en insécurité alimentaire aiguë. Les agriculteurs ont été empêchés de cultiver par les violences. L''accès humanitaire était bloqué dans plusieurs zones.',
  'humanitarian_crisis', 'resolved', 'Extreme', 'high',
  'ocha', NULL, NULL,
  'CD15', 'Ituri (Bunia)', 1, 'city',
  ST_SetSRID(ST_MakePoint(30.2500, 1.5667), 4326),
  1500000, '2020-03-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['crise-humanitaire','ituri','insecurite-alimentaire','codeco','covid19','2020']
),

-- 53 Crise humanitaire Kasaï 2017 (après violences)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000053',
  'Crise humanitaire post-conflit — Kasaï 2017',
  'Dans les suites de la crise sécuritaire Kamuina Nsapu, le Grand-Kasaï a fait face à une crise humanitaire majeure en 2017. Plus de 400 000 enfants souffrant de malnutrition aiguë sévère selon l''UNICEF. Destruction de 400 écoles et 60 centres de santé. L''accès aux zones rurales restait très limité.',
  'humanitarian_crisis', 'resolved', 'Extreme', 'high',
  'ocha', NULL, NULL,
  'CD06', 'Grand-Kasaï', 1, 'city',
  ST_SetSRID(ST_MakePoint(20.8000, -6.4167), 4326),
  3000000, '2017-03-01 00:00:00+00', '2018-06-30 00:00:00+00',
  ARRAY['crise-humanitaire','kasai','malnutrition','enfants','unicef','post-conflit','2017']
),

-- ============================================================
-- INONDATIONS SUPPLÉMENTAIRES (DIVERSES PROVINCES)
-- ============================================================

-- 54 Inondations Bikoro 2018
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000054',
  'Inondations — Bikoro, Équateur 2018',
  'Inondations dans le territoire de Bikoro (Équateur) en 2018, coincidant avec l''épidémie Ebola dans la même zone. Des milliers de familles ont vu leurs champs et habitations submergés. La double urgence Ebola + inondations a mis à rude épreuve les capacités de réponse.',
  'flood', 'resolved', 'Moderate', 'low',
  'ocha', NULL, NULL,
  'CD22', 'Bikoro, Équateur', 1, 'city',
  ST_SetSRID(ST_MakePoint(18.1000, -0.7667), 4326),
  15000, '2018-05-01 00:00:00+00', '2018-08-31 00:00:00+00',
  ARRAY['inondation','bikoro','equateur','ebola','double-urgence','2018']
),

-- 55 Inondations Mbuji-Mayi 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000055',
  'Inondations — Mbuji-Mayi, Kasaï-Oriental 2021',
  'Inondations dans les quartiers périphériques de Mbuji-Mayi (Kasaï-Oriental) en 2021, causées par la montée de la rivière Sankuru. Des milliers de personnes sinistrées. Les mines artisanales de diamants ont aussi été affectées, perturbant les activités économiques.',
  'flood', 'resolved', 'Moderate', 'medium',
  'official', NULL, NULL,
  'CD08', 'Mbuji-Mayi, Kasaï-Oriental', 1, 'city',
  ST_SetSRID(ST_MakePoint(23.6000, -6.1500), 4326),
  10000, '2021-11-01 00:00:00+00', '2021-12-31 00:00:00+00',
  ARRAY['inondation','mbuji-mayi','kasai-oriental','sankuru','diamants','2021']
),

-- 56 Inondations Bandundu/Kwilu 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000056',
  'Inondations — Kwilu 2020',
  'Inondations dans la province du Kwilu en 2020, affectant principalement les zones riveraines du fleuve Kwilu et de ses affluents. Des milliers de ménages ont vu leurs récoltes détruites, aggravant une situation alimentaire déjà précaire dans la province.',
  'flood', 'resolved', 'Moderate', 'low',
  'ocha', NULL, NULL,
  'CD04', 'Kwilu (Bandundu)', 1, 'city',
  ST_SetSRID(ST_MakePoint(17.3833, -3.3167), 4326),
  8000, '2020-10-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['inondation','kwilu','bandundu','fleuve-kwilu','2020']
),

-- 57 Inondations Kolwezi 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000057',
  'Inondations — Kolwezi, Lualaba 2022',
  'Inondations à Kolwezi (province du Lualaba) en 2022, affectant plusieurs quartiers dont Manika et Kapulo. Les mines de cobalt et de cuivre de la région ont également subi des perturbations. Plusieurs centaines de familles déplacées temporairement.',
  'flood', 'resolved', 'Minor', 'medium',
  'official', NULL, NULL,
  'CD26', 'Kolwezi, Lualaba', 1, 'city',
  ST_SetSRID(ST_MakePoint(25.4500, -10.7167), 4326),
  5000, '2022-03-01 00:00:00+00', '2022-04-30 00:00:00+00',
  ARRAY['inondation','kolwezi','lualaba','cobalt','mines','2022']
),

-- 58 Inondations Gemena 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000058',
  'Inondations — Gemena, Sud-Ubangi 2021',
  'Inondations à Gemena (Sud-Ubangi) en 2021 dues à la crue de la rivière Ubangi. Des milliers de personnes déplacées. Gemena est un point d''entrée humanitaire stratégique dont les inondations ont perturbé les opérations logistiques.',
  'flood', 'resolved', 'Moderate', 'low',
  'ocha', NULL, NULL,
  'CD21', 'Gemena, Sud-Ubangi', 1, 'city',
  ST_SetSRID(ST_MakePoint(19.7667, 3.2500), 4326),
  6000, '2021-09-01 00:00:00+00', '2021-11-30 00:00:00+00',
  ARRAY['inondation','gemena','sud-ubangi','ubangi','logistique','2021']
),

-- ============================================================
-- ÉVÉNEMENTS SUPPLÉMENTAIRES : CONFLITS ET AUTRES
-- ============================================================

-- 59 Djugu Ituri 2023 (persistance violences)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000059',
  'Violences persistantes — Djugu, Ituri 2023',
  'Les violences armées ont continué dans le territoire de Djugu (Ituri) en 2023, avec des attaques de milices contre des villages et des déplacements récurrents. Plus de 200 000 personnes déplacées, principalement des femmes et enfants. Les acteurs humanitaires peinent à accéder aux zones d''opérations.',
  'conflict', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD15', 'Djugu, Ituri', 1, 'city',
  ST_SetSRID(ST_MakePoint(30.5000, 1.9167), 4326),
  200000, '2023-01-01 00:00:00+00', '2023-12-31 00:00:00+00',
  ARRAY['conflit','djugu','ituri','deplacement','humanitaire','2023']
),

-- 60 Incendie marché Kinshasa — Marché de la Liberté 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000060',
  'Incendie — Marché de la Liberté, Kinshasa 2021',
  'Grand incendie au marché de la Liberté (commune de Kasa-Vubu, Kinshasa) en 2021. Des centaines de boutiques et étals détruits. Pertes économiques considérables pour des milliers de commerçants. Enquête ouverte pour déterminer l''origine du feu (court-circuit ou acte délibéré).',
  'fire', 'resolved', 'Moderate', 'medium',
  'official', NULL, NULL,
  'CD01', 'Kinshasa (Kasa-Vubu)', 1, 'city',
  ST_SetSRID(ST_MakePoint(15.2663, -4.3219), 4326),
  5000, '2021-08-15 00:00:00+00', '2021-08-20 00:00:00+00',
  ARRAY['incendie','marche','kinshasa','kasa-vubu','economie','2021']
),

-- 61 Crise alimentaire Maniema 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000061',
  'Crise alimentaire — Maniema 2021',
  'Le Maniema a connu une grave insécurité alimentaire en 2021, avec plus de 700 000 personnes en phase IPC 3 (crise). Les mauvaises pluies et l''enclavement de nombreuses zones rurales ont amplifié la crise. Les axes routiers dégradés limitent l''acheminement de l''aide alimentaire.',
  'humanitarian_crisis', 'resolved', 'Severe', 'medium',
  'fews_net', NULL, NULL,
  'CD11', 'Maniema (Kindu)', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(25.9500, -2.9500), 4326),
  700000, '2021-01-01 00:00:00+00', '2021-12-31 00:00:00+00',
  ARRAY['insecurite-alimentaire','maniema','ipc3','enclavement','2021']
),

-- 62 Séisme Bukavu 2008
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000062',
  'Séisme — région du lac Kivu 2008',
  'Un séisme de magnitude 6,0 a frappé la région du lac Kivu en 2008, provoquant des dommages dans les villes de Bukavu et de Goma. Des glissements de terrain secondaires ont été enregistrés. Des dizaines de blessés et des bâtiments endommagés ou détruits.',
  'earthquake', 'resolved', 'Moderate', 'high',
  'reliefweb', NULL, NULL,
  'CD12', 'Lac Kivu / Bukavu, Sud-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(28.8500, -2.5100), 4326),
  5000, '2008-02-03 00:00:00+00', '2008-03-01 00:00:00+00',
  ARRAY['seisme','lac-kivu','bukavu','goma','2008','magnitude6']
),

-- 63 Épidémie Ebola 2003 — Mbomo (zone frontière RDC-Congo)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000063',
  'Épidémie Ebola — zone frontière Équateur 2003',
  '4e épidémie d''Ebola en RDC, en 2003, dans la zone frontalière avec la République du Congo (Mbandaka et forêts de l''Équateur). 143 cas confirmés dont 128 décès (létalité 89%). La gestion transfrontalière avec Brazzaville a posé des défis logistiques majeurs.',
  'health_epidemic', 'resolved', 'Extreme', 'high',
  'reliefweb', NULL, 'EP-2003-000024-COD',
  'CD22', 'Équateur (zone frontière)', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(18.2833, 0.0500), 4326),
  143, '2003-12-01 00:00:00+00', '2004-01-15 00:00:00+00',
  ARRAY['ebola','mvd','equateur','mbandaka','frontalier','2003','letalite']
),

-- 64 Ebola Équateur 2020 (Mbandaka 2e fois)
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000064',
  'Épidémie Ebola — Mbandaka, Équateur 2020 (11e)',
  'Épidémie d''Ebola à Mbandaka (Équateur) déclarée en juin 2020, en plein contexte de pandémie COVID-19. 130 cas confirmés, 55 décès. La réponse a dû composer avec les restrictions COVID. Fin déclarée le 18 novembre 2020.',
  'health_epidemic', 'resolved', 'Severe', 'high',
  'ocha', 'https://reliefweb.int/disaster/ep-2020-000110-cod', NULL,
  'CD22', 'Mbandaka, Équateur', 1, 'city',
  ST_SetSRID(ST_MakePoint(18.2833, 0.0500), 4326),
  130, '2020-06-01 00:00:00+00', '2020-11-18 00:00:00+00',
  ARRAY['ebola','mvd','equateur','mbandaka','covid19','2020']
),

-- 65 Crise déplacement Kabinda-Lomami 2017
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000065',
  'Déplacement — Lomami (Kabinda) 2017',
  'Vagues de déplacement dans la province du Lomami (chef-lieu Kabinda) en 2017 liées aux violences de la milice Kamuina Nsapu qui s''était étendue au-delà du Kasaï. Des dizaines de milliers de personnes ont fui vers les forêts environnantes.',
  'mass_displacement', 'resolved', 'Severe', 'medium',
  'ocha', NULL, NULL,
  'CD09', 'Kabinda, Lomami', 1, 'city',
  ST_SetSRID(ST_MakePoint(24.4833, -6.1333), 4326),
  80000, '2017-04-01 00:00:00+00', '2017-12-31 00:00:00+00',
  ARRAY['deplacement','lomami','kabinda','kamuina-nsapu','kasai','2017']
),

-- 66 Inondations Kongolo 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000066',
  'Inondations — Kongolo, Tanganyika 2021',
  'Inondations dans le territoire de Kongolo (Tanganyika) en 2021. Le fleuve Congo et ses affluents ont débordé, submergeant des zones cultivées et des habitations. Environ 10 000 personnes affectées dans une région déjà en situation d''insécurité alimentaire.',
  'flood', 'resolved', 'Moderate', 'low',
  'ocha', NULL, NULL,
  'CD24', 'Kongolo, Tanganyika', 1, 'city',
  ST_SetSRID(ST_MakePoint(27.0000, -5.3833), 4326),
  10000, '2021-11-01 00:00:00+00', '2022-01-31 00:00:00+00',
  ARRAY['inondation','kongolo','tanganyika','fleuve-congo','2021']
),

-- 67 Sécheresse Lualaba 2020
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000067',
  'Insécurité alimentaire — Lualaba 2020',
  'Déficit pluviométrique et insécurité alimentaire dans la province du Lualaba en 2020. Malgré la richesse minière de la région, les communautés rurales ont souffert de mauvaises récoltes. Plus de 200 000 personnes en situation précaire selon les évaluations FEWS NET.',
  'drought', 'resolved', 'Moderate', 'medium',
  'fews_net', NULL, NULL,
  'CD26', 'Kolwezi, Lualaba', 1, 'city',
  ST_SetSRID(ST_MakePoint(25.4500, -10.7167), 4326),
  200000, '2020-06-01 00:00:00+00', '2020-12-31 00:00:00+00',
  ARRAY['secheresse','insecurite-alimentaire','lualaba','kolwezi','mines','2020']
),

-- 68 Inondations Rutshuru 2022
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000068',
  'Inondations — Rutshuru, Nord-Kivu 2022',
  'Inondations dans le territoire de Rutshuru (Nord-Kivu) en 2022, aggravées par la présence du M23 qui empêche les populations de quitter les zones à risque. Les ravines descendent des collines Virunga lors des pluies violentes. Plusieurs centaines de familles déplacées.',
  'flood', 'resolved', 'Moderate', 'low',
  'ocha', NULL, NULL,
  'CD14', 'Rutshuru, Nord-Kivu', 1, 'city',
  ST_SetSRID(ST_MakePoint(29.4500, -1.1833), 4326),
  3000, '2022-10-01 00:00:00+00', '2022-11-30 00:00:00+00',
  ARRAY['inondation','rutshuru','nord-kivu','m23','virunga','2022']
),

-- 69 Incendie forêt — Parc des Virunga 2021
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000069',
  'Incendie de forêt — Parc national des Virunga 2021',
  'Incendies de forêt dans le parc national des Virunga (Nord-Kivu) en 2021, alimentés par la saison sèche et les activités humaines. Des milliers d''hectares de végétation ont brûlé, menaçant l''habitat des gorilles des montagnes. Les gardes du parc ont lutté contre les flammes malgré les menaces sécuritaires (ADF).',
  'fire', 'resolved', 'Moderate', 'medium',
  'official', NULL, NULL,
  'CD14', 'Parc national des Virunga, Nord-Kivu', 1, 'pcode',
  ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),
  NULL, '2021-02-01 00:00:00+00', '2021-03-31 00:00:00+00',
  ARRAY['incendie','foret','virunga','gorilles','biodiversite','adf','2021']
),

-- 70 Choléra Tshopo 2023
(
  'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000070',
  'Flambée de choléra — Tshopo 2023',
  'Flambée de choléra dans la province de la Tshopo en 2023, notamment dans les zones riveraines de Kisangani et le long du fleuve Congo. Environ 3 000 cas signalés avec un taux de létalité de 1,5%. L''accès à l''eau potable reste un défi majeur dans les zones rurales de la province.',
  'health_epidemic', 'resolved', 'Moderate', 'medium',
  'ocha', NULL, NULL,
  'CD17', 'Kisangani, Tshopo', 1, 'city',
  ST_SetSRID(ST_MakePoint(25.1833, 0.5333), 4326),
  3000, '2023-06-01 00:00:00+00', '2023-11-30 00:00:00+00',
  ARRAY['cholera','tshopo','kisangani','fleuve-congo','eau-potable','2023']
)

ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- FIN DU SEED 004 — 70 événements historiques insérés
-- =============================================================================
