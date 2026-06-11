-- Seed 003: Événements de démonstration (scenarios réalistes RDC)

INSERT INTO disaster_events (
  title, description, hazard_type, status, severity, confidence,
  source, location_pcode, location_name, location_level, location_accuracy,
  affected_pcodes, estimated_affected, start_date, tags
) VALUES
  (
    'Inondations — Fleuve Congo, Kinshasa (Limete)',
    'Montée des eaux du fleuve Congo suite à des pluies intenses. Plusieurs quartiers de Limete inondés. Accès aux routes coupé.',
    'flood', 'active', 'Severe', 'confirmed',
    'official', 'CD10', 'Kinshasa — Commune de Limete', 3, 'pcode',
    ARRAY['CD10'], 12500, NOW() - INTERVAL '2 days',
    ARRAY['inondation', 'fleuve-congo', 'kinshasa']
  ),
  (
    'Déplacement de populations — Territoire de Beni (Nord-Kivu)',
    'Mouvements de population importants en provenance des zones de conflit au nord du territoire de Beni. Afflux vers les sites de déplacement identifiés.',
    'mass_displacement', 'active', 'Extreme', 'confirmed',
    'ocha', 'CD61', 'Territoire de Beni — Nord-Kivu', 2, 'territory',
    ARRAY['CD61'], 45000, NOW() - INTERVAL '5 days',
    ARRAY['deplacement', 'conflit', 'nord-kivu', 'beni']
  ),
  (
    'Alerte épidémie choléra — Uvira (Sud-Kivu)',
    'Augmentation significative des cas de choléra dans la zone de santé d''Uvira. L''OMS et le Ministère de la Santé ont été notifiés.',
    'health_epidemic', 'validated', 'Severe', 'high',
    'official', 'CD62', 'Zone de santé d''Uvira — Sud-Kivu', 3, 'pcode',
    ARRAY['CD62'], 3200, NOW() - INTERVAL '7 days',
    ARRAY['cholera', 'epidemie', 'sante', 'sud-kivu', 'uvira']
  ),
  (
    'Glissement de terrain — Territoire de Kalehe',
    'Glissement de terrain suite à des pluies torrentielles sur les collines de Kalehe. Habitations détruites.',
    'landslide', 'validated', 'Severe', 'confirmed',
    'field_agent', 'CD62', 'Territoire de Kalehe — Sud-Kivu', 2, 'pcode',
    ARRAY['CD62'], 800, NOW() - INTERVAL '1 day',
    ARRAY['glissement', 'pluies', 'kalehe', 'sud-kivu']
  ),
  (
    'Signalement citoyen — Pluies fortes — Lubumbashi',
    'Signalement de pluies intenses avec risque d''inondation dans les quartiers bas de Lubumbashi.',
    'flood', 'reported', 'Minor', 'low',
    'citizen', 'CD71', 'Lubumbashi — Haut-Katanga', 2, 'pcode',
    ARRAY['CD71'], NULL, NOW() - INTERVAL '3 hours',
    ARRAY['signalement-citoyen', 'pluies', 'lubumbashi']
  )
ON CONFLICT DO NOTHING;
