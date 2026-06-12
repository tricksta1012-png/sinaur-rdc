-- Seed 006: Comptes coordinateurs provinciaux — 26 provinces de la RDC
-- Rôle: provincial_coordinator | Mot de passe initial: ProvRDC2024! (bcrypt coût 12)
-- IMPORTANT: Ces comptes doivent être désactivés ou les mots de passe changés en production.
-- Pour regénérer le hash: node -e "require('bcrypt').hash('ProvRDC2024!',12).then(console.log)"
-- Hash bcrypt de "ProvRDC2024!" (coût 12):
DO $$
DECLARE
  pw TEXT := '$2b$12$AUBAeQUdD0hZWKb5kXiziucJkGirLOq1ItXJduynRPGyhMziK/uYG';
BEGIN
  -- Kinshasa (CD10)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kinshasa@rdc.cd', 'Coordinateur — Kinshasa', 'provincial_coordinator', '{CD10}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Kongo-Central (CD20)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kongo-central@rdc.cd', 'Coordinateur — Kongo-Central', 'provincial_coordinator', '{CD20}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Kwango (CD31)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kwango@rdc.cd', 'Coordinateur — Kwango', 'provincial_coordinator', '{CD31}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Kwilu (CD32)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kwilu@rdc.cd', 'Coordinateur — Kwilu', 'provincial_coordinator', '{CD32}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Maï-Ndombe (CD33)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.mai-ndombe@rdc.cd', 'Coordinateur — Maï-Ndombe', 'provincial_coordinator', '{CD33}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Équateur (CD41)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.equateur@rdc.cd', 'Coordinateur — Équateur', 'provincial_coordinator', '{CD41}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Sud-Ubangi (CD42)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.sud-ubangi@rdc.cd', 'Coordinateur — Sud-Ubangi', 'provincial_coordinator', '{CD42}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Nord-Ubangi (CD43)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.nord-ubangi@rdc.cd', 'Coordinateur — Nord-Ubangi', 'provincial_coordinator', '{CD43}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Mongala (CD44)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.mongala@rdc.cd', 'Coordinateur — Mongala', 'provincial_coordinator', '{CD44}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Tshuapa (CD45)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.tshuapa@rdc.cd', 'Coordinateur — Tshuapa', 'provincial_coordinator', '{CD45}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Tshopo (CD51)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.tshopo@rdc.cd', 'Coordinateur — Tshopo', 'provincial_coordinator', '{CD51}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Bas-Uélé (CD52)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.bas-uele@rdc.cd', 'Coordinateur — Bas-Uélé', 'provincial_coordinator', '{CD52}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Haut-Uélé (CD53)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.haut-uele@rdc.cd', 'Coordinateur — Haut-Uélé', 'provincial_coordinator', '{CD53}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Ituri (CD54)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.ituri@rdc.cd', 'Coordinateur — Ituri', 'provincial_coordinator', '{CD54}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Nord-Kivu (CD61)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.nord-kivu@rdc.cd', 'Coordinateur — Nord-Kivu', 'provincial_coordinator', '{CD61}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Sud-Kivu (CD62)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.sud-kivu@rdc.cd', 'Coordinateur — Sud-Kivu', 'provincial_coordinator', '{CD62}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Maniema (CD63)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.maniema@rdc.cd', 'Coordinateur — Maniema', 'provincial_coordinator', '{CD63}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Haut-Katanga (CD71)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.haut-katanga@rdc.cd', 'Coordinateur — Haut-Katanga', 'provincial_coordinator', '{CD71}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Lualaba (CD72)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.lualaba@rdc.cd', 'Coordinateur — Lualaba', 'provincial_coordinator', '{CD72}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Haut-Lomami (CD73)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.haut-lomami@rdc.cd', 'Coordinateur — Haut-Lomami', 'provincial_coordinator', '{CD73}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Tanganyika (CD74)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.tanganyika@rdc.cd', 'Coordinateur — Tanganyika', 'provincial_coordinator', '{CD74}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Lomami (CD81)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.lomami@rdc.cd', 'Coordinateur — Lomami', 'provincial_coordinator', '{CD81}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Kasaï-Oriental (CD82)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kasai-oriental@rdc.cd', 'Coordinateur — Kasaï-Oriental', 'provincial_coordinator', '{CD82}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Sankuru (CD83)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.sankuru@rdc.cd', 'Coordinateur — Sankuru', 'provincial_coordinator', '{CD83}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Kasaï-Central (CD91)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kasai-central@rdc.cd', 'Coordinateur — Kasaï-Central', 'provincial_coordinator', '{CD91}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

  -- Kasaï (CD92)
  INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
  VALUES ('coord.kasai@rdc.cd', 'Coordinateur — Kasaï', 'provincial_coordinator', '{CD92}', pw, TRUE)
  ON CONFLICT (email) DO NOTHING;

END $$;
