/**
 * Import des limites administratives officielles de la RDC depuis HDX (OCHA COD-AB).
 * Source : https://data.humdata.org/dataset/cod-ab-cod
 *
 * Usage : pnpm --filter @sinaur/api db:import-cod-ab
 */
import { createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as https from 'node:https';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { config } from '../config.js';

const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });

const HDX_ZIP_URL =
  'https://data.humdata.org/dataset/f42132b9-8cc6-4201-b020-9259c56e8868/resource/97260e2b-65b1-41e3-aef2-fb0e6874e406/download/cod_admin_boundaries.geojson.zip';

interface GeoJSONGeometry { type: string; coordinates: unknown }
interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, string | number | null>;
  geometry: GeoJSONGeometry;
}

function computeCentroid(geom: GeoJSONGeometry): { lng: number; lat: number } | null {
  try {
    let rings: number[][][] = [];
    if (geom.type === 'Polygon')      rings = [(geom.coordinates as number[][][])[0]];
    else if (geom.type === 'MultiPolygon') rings = (geom.coordinates as number[][][][]).map((p) => p[0]);
    else return null;
    let sumLng = 0, sumLat = 0, count = 0;
    for (const ring of rings) for (const [lng, lat] of ring) { sumLng += lng; sumLat += lat; count++; }
    return count ? { lng: sumLng / count, lat: sumLat / count } : null;
  } catch { return null; }
}

/** Try several COD-AB property name variants (standard, _em, uppercase). */
function getProp(p: Record<string, unknown>, level: number, key: 'pcode' | 'name' | 'parent_pcode'): string {
  const L = level;
  const P = L - 1;
  if (key === 'pcode') {
    return String(
      p[`adm${L}_pcode`]      ??
      p[`admin${L}Pcode`]     ??
      p[`ADM${L}_PCODE`]      ??
      p[`adm${L}Pcode`]       ?? ''
    );
  }
  if (key === 'name') {
    return String(
      p[`adm${L}_name`]       ??
      p[`admin${L}Name`]      ??
      p[`ADM${L}_FR`]         ??
      p[`admin${L}Name_fr`]   ?? ''
    );
  }
  if (L === 1) return 'COD';
  return String(
    p[`adm${P}_pcode`]        ??
    p[`admin${P}Pcode`]       ??
    p[`ADM${P}_PCODE`]        ?? ''
  );
}

function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = (mod as typeof https).get(url, { headers: { 'User-Agent': 'sinaur-rdc/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsDownload(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const ws = createWriteStream(dest);
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        ws.write(chunk);
        total += chunk.length;
        if (total % 5_000_000 < (chunk.length + 1)) process.stdout.write(`  … ${Math.round(total / 1e6)} MB\n`);
      });
      res.on('end', () => ws.end(() => resolve()));
      res.on('error', reject);
      ws.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function downloadZip(dest: string): Promise<void> {
  await mkdir(join(dest, '..'), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`  Téléchargement (tentative ${attempt}/3)…`);
      await httpsDownload(HDX_ZIP_URL, dest);
      const size = statSync(dest).size;
      console.log(`✓  Téléchargement : ${Math.round(size / 1e6)} MB`);
      if (size < 1_000_000) throw new Error(`Fichier trop petit: ${size} bytes`);
      return;
    } catch (e: any) {
      console.log(`  Échec tentative ${attempt}: ${e.message}`);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function extractAndParse(zipPath: string, cdZipPath: string | null, filename: string): Promise<GeoJSONFeature[]> {
  const { inflateRawSync } = await import('node:zlib');

  // If cdZipPath is different, use it for Central Directory metadata; otherwise use zipPath for both
  const cdBuf  = readFileSync(cdZipPath ?? zipPath);
  const dataBuf = readFileSync(zipPath);

  let eocd = -1;
  for (let i = cdBuf.length - 22; i >= Math.max(0, cdBuf.length - 65558); i--) {
    if (cdBuf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid zip: EOCD not found');

  const cdOffset = cdBuf.readUInt32LE(eocd + 16);
  const cdCount  = cdBuf.readUInt16LE(eocd + 10);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (cdBuf.readUInt32LE(pos) !== 0x02014b50) throw new Error(`Bad CD signature at ${pos}`);
    const compression   = cdBuf.readUInt16LE(pos + 10);
    const compressedSz  = cdBuf.readUInt32LE(pos + 20);
    const fnLen         = cdBuf.readUInt16LE(pos + 28);
    const extraLen      = cdBuf.readUInt16LE(pos + 30);
    const commentLen    = cdBuf.readUInt16LE(pos + 32);
    const localOffset   = cdBuf.readUInt32LE(pos + 42);
    const entryName     = cdBuf.toString('utf-8', pos + 46, pos + 46 + fnLen);
    pos += 46 + fnLen + extraLen + commentLen;

    if (entryName !== filename) continue;

    const lfhSig = localOffset < dataBuf.length ? dataBuf.readUInt32LE(localOffset) : 0;
    let dataStart: number;
    if (lfhSig === 0x04034b50) {
      const lfhFnLen    = dataBuf.readUInt16LE(localOffset + 26);
      const lfhExtraLen = dataBuf.readUInt16LE(localOffset + 28);
      dataStart = localOffset + 30 + lfhFnLen + lfhExtraLen;
    } else {
      dataStart = localOffset + 30 + fnLen;
    }

    const dataEnd = dataStart + compressedSz;
    if (dataEnd > dataBuf.length) throw new Error(`Data truncated: need ${dataEnd}, have ${dataBuf.length}`);

    const compressed = dataBuf.subarray(dataStart, dataEnd);
    const raw = compression === 0 ? compressed : inflateRawSync(compressed);
    const geojson = JSON.parse(raw.toString('utf-8'));
    return geojson.features as GeoJSONFeature[];
  }
  throw new Error(`File not found in zip: ${filename}`);
}

async function importFeatures(level: number, features: GeoJSONFeature[], sourceLabel: string): Promise<void> {
  console.log(`▶  Niveau ${level} : ${features.length} features (${sourceLabel})`);
  let imported = 0;
  for (const feature of features) {
    const p = feature.properties as Record<string, unknown>;
    const pcode       = getProp(p, level, 'pcode');
    const name        = getProp(p, level, 'name');
    const parentPcode = getProp(p, level, 'parent_pcode');

    if (!pcode || !name) continue;

    const centroidPt   = computeCentroid(feature.geometry);
    const centroidJson = centroidPt
      ? JSON.stringify({ type: 'Point', coordinates: [centroidPt.lng, centroidPt.lat] })
      : null;
    const geomJson = JSON.stringify(feature.geometry);

    await sql`
      INSERT INTO admin_divisions (pcode, name, name_fr, level, parent_pcode, geometry, centroid)
      VALUES (
        ${pcode}, ${name}, ${name}, ${level}, ${parentPcode},
        ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326),
        ${centroidJson !== null ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${centroidJson}), 4326)` : sql`NULL`}
      )
      ON CONFLICT (pcode) DO UPDATE SET
        name = EXCLUDED.name, name_fr = EXCLUDED.name_fr,
        geometry = EXCLUDED.geometry, centroid = EXCLUDED.centroid, updated_at = NOW()
    `;
    imported++;
  }
  console.log(`✓  Niveau ${level} : ${imported} divisions importées`);
}

async function importFromGeojsonFile(level: number, filePath: string): Promise<void> {
  const geojson = JSON.parse(readFileSync(filePath, 'utf-8'));
  const features = (geojson.features ?? []) as GeoJSONFeature[];
  await importFeatures(level, features, filePath.split('/').pop()!);
}

async function importFromZip(
  level: number,
  dataZip: string,
  filenames: string[],
  cdZip: string | null = null,
): Promise<void> {
  for (const filename of filenames) {
    try {
      const features = await extractAndParse(dataZip, cdZip, filename);
      await importFeatures(level, features, filename);
      return;
    } catch (e: any) {
      console.log(`  ${filename} échoué (${e.message}), essai suivant…`);
    }
  }
  throw new Error(`Aucun fichier disponible pour le niveau ${level}`);
}

async function importCodAb(): Promise<void> {
  console.log('▶  Import COD-AB RDC depuis HDX (OCHA)\n');

  // Fast path: pre-extracted GeoJSON files from hybrid extraction (local dev)
  const extractedDirs = [
    join(tmpdir(), 'cod-ab', 'extracted3'),
    join(tmpdir(), 'cod-ab', 'extracted2'),
    join(tmpdir(), 'cod-ab', 'extracted'),
  ];

  const levelCandidates: [number, string[]][] = [
    [1, ['cod_admin1.geojson', 'cod_admin1_em.geojson']],
    [2, ['cod_admin2.geojson', 'cod_admin2_em.geojson']],
    [3, ['cod_admin3.geojson', 'cod_admin3_em.geojson']],
    [4, ['cod_admin4.geojson', 'cod_admin4_em.geojson']],
  ];

  let usedPreExtracted = false;
  for (const dir of extractedDirs) {
    const paths: [number, string][] = [];
    for (const [level, names] of levelCandidates) {
      const found = names.map(n => join(dir, n)).find(p => existsSync(p));
      if (found) paths.push([level, found]);
    }
    if (paths.length >= 3) {
      console.log(`▶  Fichiers pré-extraits trouvés dans ${dir} (${paths.length} niveaux)\n`);
      for (const [level, path] of paths) await importFromGeojsonFile(level, path);
      usedPreExtracted = true;
      break;
    }
  }

  if (!usedPreExtracted) {
    // Hybrid: cached zip (for CD metadata) + fresh download (for data)
    const cdZip = join(tmpdir(), 'cod-ab', 'cod2.zip');
    const hasCdZip = existsSync(cdZip);

    const freshZip = join(tmpdir(), 'sinaur-cod-ab', 'cod.zip');
    let downloaded = false;
    async function getZip(): Promise<string> {
      if (!downloaded) { await downloadZip(freshZip); downloaded = true; }
      return freshZip;
    }

    // Try cached _em for level 1 first (fastest), then standard from fresh zip
    const cachedZip = join(tmpdir(), 'cod-ab', 'cod2.zip');
    const hasCached = existsSync(cachedZip);

    if (hasCached) {
      try { await importFromZip(1, cachedZip, ['cod_admin1_em.geojson', 'cod_admin1.geojson']); }
      catch { await importFromZip(1, await getZip(), ['cod_admin1.geojson', 'cod_admin1_em.geojson'], hasCdZip ? cdZip : null); }
    } else {
      await importFromZip(1, await getZip(), ['cod_admin1.geojson', 'cod_admin1_em.geojson']);
    }

    for (const level of [2, 3] as const) {
      const [, names] = levelCandidates[level - 1];
      const z = await getZip();
      await importFromZip(level, z, names, hasCdZip ? cdZip : null);
    }

    // Niveau 4 (groupements/quartiers) — optionnel, pas toujours dans le package COD-AB
    try {
      const [, names4] = levelCandidates[3];
      const z = await getZip();
      await importFromZip(4, z, names4, hasCdZip ? cdZip : null);
    } catch {
      console.log('ℹ  Niveau 4 (groupements/quartiers) non trouvé dans ce COD-AB — import ignoré');
    }
  }

  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY current_risk_scores`.catch(() => {});

  const [r] = await sql`SELECT COUNT(*) FROM admin_divisions`;
  console.log(`\n✓  Import terminé — ${r.count} divisions dans la base`);
  await sql.end();
}

importCodAb().catch((err) => {
  console.error('✗  Import COD-AB échoué:', err.message);
  process.exit(1);
});
