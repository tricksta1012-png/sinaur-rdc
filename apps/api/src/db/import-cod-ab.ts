/**
 * Import des limites administratives officielles de la RDC depuis HDX (OCHA COD-AB).
 * Source : https://data.humdata.org/dataset/cod-ab-cod
 *
 * Ce script télécharge le GeoJSON COD-AB et importe les divisions administratives
 * avec leurs géométries PostGIS.
 *
 * Usage : pnpm --filter @sinaur/api db:import-cod-ab
 */
import postgres from 'postgres';
import { config } from '../config.js';

const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });

// URLs des fichiers GeoJSON COD-AB RDC sur HDX
const COD_AB_URLS: Record<number, string> = {
  1: 'https://data.humdata.org/dataset/cod-ab-cod/resource/cod_adm1_cod.geojson',
  2: 'https://data.humdata.org/dataset/cod-ab-cod/resource/cod_adm2_cod.geojson',
  3: 'https://data.humdata.org/dataset/cod-ab-cod/resource/cod_adm3_cod.geojson',
};

interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, string | number | null>;
  geometry: { type: string; coordinates: unknown };
}

async function importLevel(level: number, url: string): Promise<void> {
  console.log(`▶  Import niveau ${level} depuis ${url}`);

  const response = await fetch(url, {
    headers: { 'User-Agent': 'sinaur-rdc/0.1.0 (contact@sinaur-rdc.cd)' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${url}`);
  }

  const geojson = await response.json() as { features: GeoJSONFeature[] };
  let imported = 0;

  for (const feature of geojson.features) {
    const p = feature.properties;

    // Les noms de champs COD-AB suivent la convention admin{N}Name / admin{N}Pcode
    const pcode = String(p[`admin${level}Pcode`] ?? p[`ADM${level}_PCODE`] ?? '');
    const name = String(p[`admin${level}Name`] ?? p[`ADM${level}_FR`] ?? p[`admin${level}Name_fr`] ?? '');
    const parentPcode = level > 1
      ? String(p[`admin${level - 1}Pcode`] ?? p[`ADM${level - 1}_PCODE`] ?? '')
      : 'COD';

    if (!pcode || !name) continue;

    const geomJson = JSON.stringify(feature.geometry);

    await sql`
      INSERT INTO admin_divisions (pcode, name, name_fr, level, parent_pcode, geometry, centroid)
      VALUES (
        ${pcode}, ${name}, ${name}, ${level}, ${parentPcode},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)),
        ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326))
      )
      ON CONFLICT (pcode) DO UPDATE SET
        name = EXCLUDED.name,
        name_fr = EXCLUDED.name_fr,
        geometry = EXCLUDED.geometry,
        centroid = EXCLUDED.centroid,
        updated_at = NOW()
    `;
    imported++;
  }

  console.log(`✓  Niveau ${level} : ${imported} divisions importées`);
}

async function importCodAb(): Promise<void> {
  console.log('▶  Import COD-AB RDC depuis HDX (OCHA)');
  console.log('   Source : https://data.humdata.org/dataset/cod-ab-cod\n');

  for (const [level, url] of Object.entries(COD_AB_URLS)) {
    await importLevel(Number(level), url);
  }

  // Rafraîchir la vue matérialisée des scores de risque (si elle existe)
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY current_risk_scores`.catch(() => {});

  console.log('\n✓  Import COD-AB terminé');
  await sql.end();
}

importCodAb().catch((err) => {
  console.error('✗  Import COD-AB échoué:', err.message);
  process.exit(1);
});
