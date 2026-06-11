-- Seed 001: Nœud racine de la hiérarchie administrative (pays — niveau 0)
-- Les 26 provinces (niveau 1) et leurs subdivisions (niveaux 2, 3) sont importées
-- depuis le COD-AB officiel via : pnpm --filter @sinaur/api db:import-cod-ab
-- Source : https://data.humdata.org/dataset/cod-ab-cod

INSERT INTO admin_divisions (pcode, name, name_fr, level, parent_pcode, population, is_active)
VALUES
  ('COD', 'République Démocratique du Congo', 'République Démocratique du Congo', 0, NULL, 99010000, TRUE)
ON CONFLICT (pcode) DO NOTHING;
