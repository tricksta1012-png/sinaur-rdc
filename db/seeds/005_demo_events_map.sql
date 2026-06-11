-- =============================================================================
-- SINAUR-RDC — Seed 005: 50 événements géolocalisés de démonstration
-- Couvre les 26 provinces · Catégories : inondation, déplacement, épidémie,
-- conflit, glissement, éruption, sécheresse
-- Idempotent : ON CONFLICT DO NOTHING
-- =============================================================================

INSERT INTO disaster_events (
  title, description, hazard_type, status, severity, confidence,
  source, location_pcode, location_name, location_level, location_accuracy,
  location_point, affected_pcodes, estimated_affected, start_date, tags
) VALUES

-- ── INONDATIONS (15) ────────────────────────────────────────────────────────

(
  'Inondations — Ndjili/Masina, Kinshasa',
  'Montée des eaux du fleuve Congo et de la rivière Ndjili. Quartiers Masina, Kimbanseke et Lemba partiellement submergés. 4 200 maisons touchées.',
  'flood', 'active', 'Extreme', 'confirmed',
  'official', 'CD10', 'Kinshasa — Communes Masina et Ndjili', 3, 'gps',
  ST_SetSRID(ST_MakePoint(15.385, -4.365), 4326),
  ARRAY['CD10'], 28500, NOW() - INTERVAL '3 days',
  ARRAY['inondation','fleuve-congo','kinshasa','masina']
),
(
  'Crues rivière Lukunga — Matadi (Kongo-Central)',
  'Débordement de la Lukunga après 72h de pluies intenses. Axe routier Matadi–Boma temporairement coupé.',
  'flood', 'active', 'Severe', 'confirmed',
  'official', 'CD11', 'Matadi — Kongo-Central', 2, 'gps',
  ST_SetSRID(ST_MakePoint(13.443, -5.825), 4326),
  ARRAY['CD11'], 8400, NOW() - INTERVAL '5 days',
  ARRAY['inondation','kongo-central','matadi']
),
(
  'Inondations Kikwit — Kwilu',
  'La rivière Kwilu en crue a inondé les zones basses de Kikwit. Accès à la route nationale RN1 compromis.',
  'flood', 'active', 'Severe', 'high',
  'field_agent', 'CD13', 'Kikwit — Kwilu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(18.822, -5.042), 4326),
  ARRAY['CD13'], 6200, NOW() - INTERVAL '2 days',
  ARRAY['inondation','kwilu','kikwit']
),
(
  'Montée des eaux — Lac Maï-Ndombe',
  'Niveau du lac Maï-Ndombe anormalement haut (+1,4 m par rapport à la normale saisonnière). Villages riverains évacués.',
  'flood', 'validated', 'Moderate', 'confirmed',
  'official', 'CD14', 'Inongo — Mai-Ndombe', 2, 'gps',
  ST_SetSRID(ST_MakePoint(18.312, -2.145), 4326),
  ARRAY['CD14'], 3100, NOW() - INTERVAL '8 days',
  ARRAY['inondation','lac','mai-ndombe','inongo']
),
(
  'Crues Uvira — Lac Tanganyika (Sud-Kivu)',
  'Inondations sévères dans les quartiers bas d''Uvira suite à des pluies diluviennes. Déplacements d''urgence en cours.',
  'flood', 'active', 'Extreme', 'confirmed',
  'ocha', 'CD62', 'Uvira — Sud-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.141, -3.395), 4326),
  ARRAY['CD62'], 18200, NOW() - INTERVAL '1 day',
  ARRAY['inondation','uvira','tanganyika','sud-kivu']
),
(
  'Inondations Lubero — Nord-Kivu',
  'Rivières Kivindi et Kibati en crue. Secteur de Lubero Nord partiellement isolé. Pont de la Pène détruit.',
  'flood', 'active', 'Severe', 'high',
  'field_agent', 'CD61', 'Lubero — Nord-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.237, -0.173), 4326),
  ARRAY['CD61'], 9500, NOW() - INTERVAL '4 days',
  ARRAY['inondation','nord-kivu','lubero']
),
(
  'Inondations Bunia — Ituri',
  'Quartiers Bankoko et Mudzi Pela inondés après une tempête nocturne. Plusieurs centaines de familles déplacées.',
  'flood', 'active', 'Severe', 'confirmed',
  'ocha', 'CD63', 'Bunia — Ituri', 2, 'gps',
  ST_SetSRID(ST_MakePoint(30.249, 1.565), 4326),
  ARRAY['CD63'], 7300, NOW() - INTERVAL '6 days',
  ARRAY['inondation','bunia','ituri']
),
(
  'Inondations Lubumbashi-Kampemba (Haut-Katanga)',
  'Débordement de la rivière Kafubu. Quartiers Kampemba et Kamalondo touchés.',
  'flood', 'validated', 'Moderate', 'confirmed',
  'official', 'CD71', 'Lubumbashi — Haut-Katanga', 2, 'gps',
  ST_SetSRID(ST_MakePoint(27.475, -11.660), 4326),
  ARRAY['CD71'], 4200, NOW() - INTERVAL '10 days',
  ARRAY['inondation','lubumbashi','haut-katanga']
),
(
  'Inondations Kolwezi — Lualaba',
  'Quartiers miniers inondés. Accès à la zone industrielle perturbé pendant 48h.',
  'flood', 'validated', 'Moderate', 'high',
  'field_agent', 'CD73', 'Kolwezi — Lualaba', 2, 'gps',
  ST_SetSRID(ST_MakePoint(25.467, -10.721), 4326),
  ARRAY['CD73'], 3600, NOW() - INTERVAL '12 days',
  ARRAY['inondation','kolwezi','lualaba']
),
(
  'Crues rivière Lukula — Kasaï-Oriental',
  'Zone rurale inondée. Cultures maraîchères détruites sur environ 800 hectares.',
  'flood', 'validated', 'Minor', 'medium',
  'field_agent', 'CD17', 'Territoire de Kabeya-Kamwanga — Kasaï-Oriental', 3, 'gps',
  ST_SetSRID(ST_MakePoint(23.834, -5.942), 4326),
  ARRAY['CD17'], 1200, NOW() - INTERVAL '15 days',
  ARRAY['inondation','kasai-oriental']
),
(
  'Inondations Kabinda — Lomami',
  'Secteur de Lomami inondé. Axes routiers vers Kabinda Nord impraticables.',
  'flood', 'reported', 'Minor', 'low',
  'citizen', 'CD18', 'Kabinda — Lomami', 2, 'gps',
  ST_SetSRID(ST_MakePoint(24.481, -6.131), 4326),
  ARRAY['CD18'], 800, NOW() - INTERVAL '1 day',
  ARRAY['inondation','lomami','kabinda']
),
(
  'Inondations Kisangani — Tshopo',
  'Débordement du fleuve Congo à Kisangani. Communes Kabondo et Mangobo affectées.',
  'flood', 'active', 'Severe', 'confirmed',
  'official', 'CD66', 'Kisangani — Tshopo', 2, 'gps',
  ST_SetSRID(ST_MakePoint(25.198, 0.519), 4326),
  ARRAY['CD66'], 11000, NOW() - INTERVAL '7 days',
  ARRAY['inondation','kisangani','tshopo','fleuve-congo']
),
(
  'Crues Mbandaka — Équateur',
  'Montée exceptionnelle du fleuve Congo à Mbandaka. Quartiers riverains évacués préventativement.',
  'flood', 'active', 'Moderate', 'confirmed',
  'official', 'CD94', 'Mbandaka — Équateur', 2, 'gps',
  ST_SetSRID(ST_MakePoint(18.260, 0.046), 4326),
  ARRAY['CD94'], 5400, NOW() - INTERVAL '9 days',
  ARRAY['inondation','mbandaka','equateur']
),
(
  'Inondations Boende — Tshuapa',
  'Rivière Tshuapa en crue modérée. Routes secondaires impraticables.',
  'flood', 'validated', 'Minor', 'medium',
  'field_agent', 'CD95', 'Boende — Tshuapa', 2, 'gps',
  ST_SetSRID(ST_MakePoint(23.002, -0.512), 4326),
  ARRAY['CD95'], 1400, NOW() - INTERVAL '14 days',
  ARRAY['inondation','tshuapa','boende']
),
(
  'Inondations Gemena — Sud-Ubangi',
  'Quartiers périphériques de Gemena inondés. Système de drainage insuffisant.',
  'flood', 'reported', 'Minor', 'low',
  'citizen', 'CD92', 'Gemena — Sud-Ubangi', 2, 'gps',
  ST_SetSRID(ST_MakePoint(19.773, 3.257), 4326),
  ARRAY['CD92'], 900, NOW() - INTERVAL '2 days',
  ARRAY['inondation','gemena','sud-ubangi']
),

-- ── DÉPLACEMENTS DE POPULATIONS (10) ────────────────────────────────────────

(
  'Déplacements massifs Rutshuru — Nord-Kivu',
  'Afflux de déplacés fuyant les affrontements en territoire de Rutshuru. Camps de Kiwanja saturés à 230%.',
  'mass_displacement', 'active', 'Extreme', 'confirmed',
  'ocha', 'CD61', 'Territoire de Rutshuru — Nord-Kivu', 2, 'territory',
  ST_SetSRID(ST_MakePoint(29.446, -1.193), 4326),
  ARRAY['CD61'], 95000, NOW() - INTERVAL '6 days',
  ARRAY['deplacement','conflit','nord-kivu','rutshuru','m23']
),
(
  'Déplacements internes Shabunda — Sud-Kivu',
  'Mouvement de population lié à l''insécurité dans le territoire de Shabunda. Accès humanitaire limité.',
  'mass_displacement', 'active', 'Severe', 'high',
  'ocha', 'CD62', 'Territoire de Shabunda — Sud-Kivu', 2, 'territory',
  ST_SetSRID(ST_MakePoint(27.329, -2.703), 4326),
  ARRAY['CD62'], 34000, NOW() - INTERVAL '11 days',
  ARRAY['deplacement','sud-kivu','shabunda','insecurite']
),
(
  'Crise déplacements Djugu — Ituri',
  'Violences intercommunautaires dans le territoire de Djugu. Deuxième vague de déplacements en 3 mois.',
  'mass_displacement', 'active', 'Extreme', 'confirmed',
  'ocha', 'CD63', 'Territoire de Djugu — Ituri', 2, 'territory',
  ST_SetSRID(ST_MakePoint(30.083, 2.031), 4326),
  ARRAY['CD63'], 67000, NOW() - INTERVAL '4 days',
  ARRAY['deplacement','ituri','djugu','violence-intercommunautaire']
),
(
  'Déplacements Dungu — Haut-Uélé',
  'Crainte d''activité LRA dans la zone de Dungu. Populations se réfugiant vers le centre-ville.',
  'mass_displacement', 'active', 'Severe', 'high',
  'ocha', 'CD64', 'Dungu — Haut-Uélé', 2, 'pcode',
  ST_SetSRID(ST_MakePoint(28.561, 3.617), 4326),
  ARRAY['CD64'], 12000, NOW() - INTERVAL '8 days',
  ARRAY['deplacement','haut-uele','dungu','lra']
),
(
  'Déplacements Kalemie — Tanganyika',
  'Déplacements liés à des tensions foncières entre communautés riveraines du lac Tanganyika.',
  'mass_displacement', 'active', 'Moderate', 'high',
  'field_agent', 'CD74', 'Kalemie — Tanganyika', 2, 'pcode',
  ST_SetSRID(ST_MakePoint(29.191, -5.931), 4326),
  ARRAY['CD74'], 8000, NOW() - INTERVAL '13 days',
  ARRAY['deplacement','tanganyika','kalemie','tensions-foncieres']
),
(
  'Déplacements Buta — Bas-Uélé',
  'Mouvements de population dans la périphérie de Buta liés à des affrontements mineurs.',
  'mass_displacement', 'validated', 'Minor', 'medium',
  'field_agent', 'CD65', 'Buta — Bas-Uélé', 2, 'pcode',
  ST_SetSRID(ST_MakePoint(24.731, 2.802), 4326),
  ARRAY['CD65'], 3200, NOW() - INTERVAL '18 days',
  ARRAY['deplacement','bas-uele','buta']
),
(
  'Déplacements Kindu — Maniema',
  'Populations fuyant les inondations combinées à l''insécurité dans le territoire de Kailo.',
  'mass_displacement', 'active', 'Moderate', 'high',
  'ocha', 'CD20', 'Kindu — Maniema', 2, 'pcode',
  ST_SetSRID(ST_MakePoint(25.931, -2.948), 4326),
  ARRAY['CD20'], 6500, NOW() - INTERVAL '5 days',
  ARRAY['deplacement','maniema','kindu']
),
(
  'Déplacements Kahemba — Kwango',
  'Populations déplacées suite à des raids transfrontaliers depuis l''Angola.',
  'mass_displacement', 'validated', 'Minor', 'medium',
  'field_agent', 'CD12', 'Kahemba — Kwango', 2, 'territory',
  ST_SetSRID(ST_MakePoint(18.995, -7.269), 4326),
  ARRAY['CD12'], 2100, NOW() - INTERVAL '20 days',
  ARRAY['deplacement','kwango','kahemba','frontalier']
),
(
  'Déplacements Lodja — Sankuru',
  'Conflits fonciers entre éleveurs et agriculteurs dans le territoire de Lodja.',
  'mass_displacement', 'validated', 'Moderate', 'medium',
  'official', 'CD19', 'Lodja — Sankuru', 2, 'territory',
  ST_SetSRID(ST_MakePoint(23.599, -3.490), 4326),
  ARRAY['CD19'], 5800, NOW() - INTERVAL '16 days',
  ARRAY['deplacement','sankuru','lodja','conflits-fonciers']
),
(
  'Déplacements Lisala — Mongala',
  'Déplacements mineurs liés à des tensions inter-villageoises dans le territoire de Bongandanga.',
  'mass_displacement', 'reported', 'Minor', 'low',
  'citizen', 'CD93', 'Lisala — Mongala', 2, 'pcode',
  ST_SetSRID(ST_MakePoint(21.514, 2.149), 4326),
  ARRAY['CD93'], 1500, NOW() - INTERVAL '3 days',
  ARRAY['deplacement','mongala','lisala']
),

-- ── ÉPIDÉMIES (8) ────────────────────────────────────────────────────────────

(
  'Épidémie de choléra — Zone de santé Fizi (Sud-Kivu)',
  '126 cas confirmés, 8 décès. Zone de santé Fizi en alerte épidémique niveau 3. MSF déployée.',
  'health_epidemic', 'active', 'Severe', 'confirmed',
  'official', 'CD62', 'Zone de santé Fizi — Sud-Kivu', 3, 'gps',
  ST_SetSRID(ST_MakePoint(28.926, -4.298), 4326),
  ARRAY['CD62'], 3800, NOW() - INTERVAL '9 days',
  ARRAY['cholera','epidemie','sud-kivu','fizi','msf']
),
(
  'Cluster Mpox — Masisi (Nord-Kivu)',
  '47 cas suspectés, 12 confirmés clade II. Enquête épidémiologique OMS/UNICEF en cours.',
  'health_epidemic', 'active', 'Severe', 'high',
  'official', 'CD61', 'Masisi — Nord-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(28.816, -1.398), 4326),
  ARRAY['CD61'], 890, NOW() - INTERVAL '7 days',
  ARRAY['mpox','epidemie','nord-kivu','masisi','oms']
),
(
  'Épidémie rougeole — Irumu (Ituri)',
  'Augmentation des cas de rougeole chez les enfants de moins de 5 ans. Couverture vaccinale < 52%.',
  'health_epidemic', 'active', 'Moderate', 'confirmed',
  'official', 'CD63', 'Irumu — Ituri', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.854, 1.447), 4326),
  ARRAY['CD63'], 2200, NOW() - INTERVAL '14 days',
  ARRAY['rougeole','epidemie','ituri','irumu','vaccination']
),
(
  'Choléra Ubundu — Tshopo',
  '54 cas, 3 décès. Contamination liée au fleuve Congo. Distribution de chlore en cours.',
  'health_epidemic', 'active', 'Moderate', 'high',
  'official', 'CD66', 'Ubundu — Tshopo', 3, 'gps',
  ST_SetSRID(ST_MakePoint(25.470, 0.358), 4326),
  ARRAY['CD66'], 1400, NOW() - INTERVAL '11 days',
  ARRAY['cholera','epidemie','tshopo','ubundu']
),
(
  'Fièvre typhoïde Likasi — Haut-Katanga',
  'Foyer de typhoïde dans les quartiers à eau non traitée de Likasi. Traitement de masse déployé.',
  'health_epidemic', 'validated', 'Minor', 'confirmed',
  'official', 'CD71', 'Likasi — Haut-Katanga', 2, 'gps',
  ST_SetSRID(ST_MakePoint(26.741, -10.991), 4326),
  ARRAY['CD71'], 620, NOW() - INTERVAL '20 days',
  ARRAY['typhoide','epidemie','haut-katanga','likasi']
),
(
  'Alerte méningite — Kisenso, Kinshasa',
  '23 cas confirmés de méningite bactérienne à Kisenso. Campagne de vaccination d''urgence lancée.',
  'health_epidemic', 'active', 'Severe', 'confirmed',
  'official', 'CD10', 'Kinshasa — Commune Kisenso', 3, 'gps',
  ST_SetSRID(ST_MakePoint(15.421, -4.412), 4326),
  ARRAY['CD10'], 1850, NOW() - INTERVAL '4 days',
  ARRAY['meningite','epidemie','kinshasa','kisenso','vaccination']
),
(
  'Choléra Idiofa — Kwilu',
  '18 cas, 1 décès. Puits contaminés après inondations. CTC mobile déployé par IRC.',
  'health_epidemic', 'validated', 'Minor', 'high',
  'official', 'CD13', 'Idiofa — Kwilu', 3, 'gps',
  ST_SetSRID(ST_MakePoint(19.587, -4.958), 4326),
  ARRAY['CD13'], 430, NOW() - INTERVAL '17 days',
  ARRAY['cholera','epidemie','kwilu','idiofa']
),
(
  'Rougeole Mbuji-Mayi — Kasaï-Oriental',
  'Recrudescence de la rougeole dans les zones péri-urbaines de Mbuji-Mayi. 312 cas en 2 semaines.',
  'health_epidemic', 'active', 'Moderate', 'confirmed',
  'official', 'CD17', 'Mbuji-Mayi — Kasaï-Oriental', 2, 'gps',
  ST_SetSRID(ST_MakePoint(23.596, -6.173), 4326),
  ARRAY['CD17'], 3100, NOW() - INTERVAL '8 days',
  ARRAY['rougeole','epidemie','kasai-oriental','mbuji-mayi']
),

-- ── CONFLITS ARMÉS (7) ───────────────────────────────────────────────────────

(
  'Affrontements Kiwanja — Nord-Kivu',
  'Combats intenses entre FARDC et groupes armés non étatiques dans le secteur de Kiwanja.',
  'conflict', 'active', 'Extreme', 'confirmed',
  'ocha', 'CD61', 'Kiwanja — Nord-Kivu', 3, 'gps',
  ST_SetSRID(ST_MakePoint(29.313, -1.240), 4326),
  ARRAY['CD61'], 0, NOW() - INTERVAL '2 days',
  ARRAY['conflit','nord-kivu','kiwanja','fardc']
),
(
  'Violences armées Minova — Sud-Kivu',
  'Incidents sécuritaires multiples dans le secteur de Minova. Mouvement de population vers Goma.',
  'conflict', 'active', 'Severe', 'high',
  'ocha', 'CD62', 'Minova — Sud-Kivu', 3, 'gps',
  ST_SetSRID(ST_MakePoint(29.141, -1.764), 4326),
  ARRAY['CD62'], 0, NOW() - INTERVAL '5 days',
  ARRAY['conflit','sud-kivu','minova','deplacement']
),
(
  'Insécurité Mahagi — Ituri',
  'Attaques de milices armées dans plusieurs villages du territoire de Mahagi. 4 civils tués.',
  'conflict', 'active', 'Severe', 'confirmed',
  'ocha', 'CD63', 'Mahagi — Ituri', 2, 'territory',
  ST_SetSRID(ST_MakePoint(30.990, 2.190), 4326),
  ARRAY['CD63'], 0, NOW() - INTERVAL '3 days',
  ARRAY['conflit','ituri','mahagi','milices']
),
(
  'Attaque LRA — Région Faradje (Haut-Uélé)',
  'Présumée attaque LRA sur un village agricole à 40 km de Faradje. Bilan provisoire : 2 morts, 7 blessés.',
  'conflict', 'active', 'Severe', 'high',
  'ocha', 'CD64', 'Faradje — Haut-Uélé', 2, 'territory',
  ST_SetSRID(ST_MakePoint(29.715, 3.736), 4326),
  ARRAY['CD64'], 0, NOW() - INTERVAL '4 days',
  ARRAY['conflit','haut-uele','faradje','lra']
),
(
  'Affrontements Aketi — Bas-Uélé',
  'Tensions entre communautés dans le territoire d''Aketi. Forces de sécurité déployées.',
  'conflict', 'validated', 'Moderate', 'medium',
  'field_agent', 'CD65', 'Aketi — Bas-Uélé', 2, 'territory',
  ST_SetSRID(ST_MakePoint(23.779, 2.741), 4326),
  ARRAY['CD65'], 0, NOW() - INTERVAL '10 days',
  ARRAY['conflit','bas-uele','aketi']
),
(
  'Tensions intercommunautaires Tshikapa — Kasaï',
  'Affrontements mineurs entre groupes rivaux à Tshikapa. Situation sous contrôle des autorités.',
  'conflict', 'validated', 'Minor', 'medium',
  'field_agent', 'CD15', 'Tshikapa — Kasaï', 2, 'pcode',
  ST_SetSRID(ST_MakePoint(20.794, -5.894), 4326),
  ARRAY['CD15'], 0, NOW() - INTERVAL '16 days',
  ARRAY['conflit','kasai','tshikapa','tensions']
),
(
  'Insécurité Nyunzu — Tanganyika',
  'Incidents armés sporadiques dans le territoire de Nyunzu. Routes secondaires déconseillées.',
  'conflict', 'validated', 'Moderate', 'medium',
  'field_agent', 'CD74', 'Nyunzu — Tanganyika', 2, 'territory',
  ST_SetSRID(ST_MakePoint(28.022, -5.954), 4326),
  ARRAY['CD74'], 0, NOW() - INTERVAL '12 days',
  ARRAY['conflit','tanganyika','nyunzu']
),

-- ── GLISSEMENTS DE TERRAIN (5) ───────────────────────────────────────────────

(
  'Glissement de terrain Kalehe — Sud-Kivu',
  'Glissement majeur sur les collines de Kalehe. 14 maisons détruites, 2 morts confirmés, 6 portés disparus.',
  'landslide', 'active', 'Extreme', 'confirmed',
  'field_agent', 'CD62', 'Kalehe — Sud-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(28.897, -2.110), 4326),
  ARRAY['CD62'], 1200, NOW() - INTERVAL '1 day',
  ARRAY['glissement','sud-kivu','kalehe','pluies']
),
(
  'Éboulement Butembo — Nord-Kivu',
  'Glissement de terrain sur le flanc Est de Butembo suite aux pluies de la nuit. Route Butembo–Lubero coupée.',
  'landslide', 'active', 'Severe', 'confirmed',
  'field_agent', 'CD61', 'Butembo — Nord-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.291, 0.132), 4326),
  ARRAY['CD61'], 540, NOW() - INTERVAL '6 hours',
  ARRAY['glissement','nord-kivu','butembo','route-coupee']
),
(
  'Glissement de terrain Shabunda — Maniema',
  'Éboulement mineur dans les collines de Shabunda. Dégâts matériels limités.',
  'landslide', 'validated', 'Moderate', 'medium',
  'field_agent', 'CD20', 'Shabunda — Maniema', 2, 'gps',
  ST_SetSRID(ST_MakePoint(27.334, -2.701), 4326),
  ARRAY['CD20'], 280, NOW() - INTERVAL '18 days',
  ARRAY['glissement','maniema','shabunda']
),
(
  'Éboulement mineur Djugu — Ituri',
  'Glissement de petite envergure suite aux intempéries. Route secondaire dégradée.',
  'landslide', 'reported', 'Minor', 'low',
  'citizen', 'CD63', 'Djugu — Ituri', 2, 'gps',
  ST_SetSRID(ST_MakePoint(30.247, 2.012), 4326),
  ARRAY['CD63'], 140, NOW() - INTERVAL '2 days',
  ARRAY['glissement','ituri','djugu']
),
(
  'Glissement terrain Walungu — Sud-Kivu',
  'Glissement sur les flancs du mont Kahuzi. 3 hameaux évacués par précaution.',
  'landslide', 'validated', 'Moderate', 'high',
  'field_agent', 'CD62', 'Walungu — Sud-Kivu', 3, 'gps',
  ST_SetSRID(ST_MakePoint(28.684, -2.589), 4326),
  ARRAY['CD62'], 390, NOW() - INTERVAL '9 days',
  ARRAY['glissement','sud-kivu','walungu','kahuzi']
),

-- ── ÉRUPTIONS VOLCANIQUES (3) ────────────────────────────────────────────────

(
  'Nyiragongo — Émissions gaz et microtremblements (Nord-Kivu)',
  'Activité sismique accrue au Nyiragongo. Émissions de SO₂ au-dessus des seuils d''alerte. OVCG surveille.',
  'volcanic_eruption', 'active', 'Extreme', 'confirmed',
  'official', 'CD61', 'Nyiragongo — Nord-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.250, -1.515), 4326),
  ARRAY['CD61'], 120000, NOW() - INTERVAL '2 days',
  ARRAY['volcan','nyiragongo','nord-kivu','goma','ovcg','so2']
),
(
  'Nyamulagira — Coulée de lave secteur Kirolirwe (Nord-Kivu)',
  'Nouvelle coulée de lave du Nyamulagira progressant vers le nord-est. Périmètre de sécurité établi 15 km.',
  'volcanic_eruption', 'active', 'Severe', 'confirmed',
  'official', 'CD61', 'Nyamulagira — Nord-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.198, -1.408), 4326),
  ARRAY['CD61'], 34000, NOW() - INTERVAL '5 days',
  ARRAY['volcan','nyamulagira','nord-kivu','lave','ovcg']
),
(
  'Activité volcanique Virunga — Zone de surveillance (Nord-Kivu)',
  'Augmentation de la sismicité dans le massif des Virunga. Surveillance renforcée de nuit.',
  'volcanic_eruption', 'validated', 'Moderate', 'confirmed',
  'official', 'CD61', 'Parc Virunga — Nord-Kivu', 2, 'gps',
  ST_SetSRID(ST_MakePoint(29.325, -1.473), 4326),
  ARRAY['CD61'], 8500, NOW() - INTERVAL '11 days',
  ARRAY['volcan','virunga','nord-kivu','surveillance']
),

-- ── SÉCHERESSES (2) ──────────────────────────────────────────────────────────

(
  'Sécheresse prolongée — Kasaï',
  'Déficit pluviométrique de -68% sur 90 jours. Perte de récoltes estimée à 75% dans le territoire de Tshikapa.',
  'drought', 'active', 'Severe', 'confirmed',
  'fews_net', 'CD15', 'Tshikapa — Kasaï', 2, 'province',
  ST_SetSRID(ST_MakePoint(22.052, -5.396), 4326),
  ARRAY['CD15'], 42000, NOW() - INTERVAL '30 days',
  ARRAY['secheresse','kasai','tshikapa','agriculture','fews-net']
),
(
  'Sécheresse Kananga — Kasaï-Central',
  'Situation de sécheresse modérée dans le territoire de Dibaya. Alerte phase 2 IPC.',
  'drought', 'active', 'Moderate', 'confirmed',
  'fews_net', 'CD16', 'Kananga — Kasaï-Central', 2, 'province',
  ST_SetSRID(ST_MakePoint(22.417, -5.896), 4326),
  ARRAY['CD16'], 28000, NOW() - INTERVAL '25 days',
  ARRAY['secheresse','kasai-central','kananga','ipc','fews-net']
)

ON CONFLICT DO NOTHING;
