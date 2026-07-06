/**
 * Seed 040b — Corrections des cas manquants de migrate040
 *
 * - Communes Kinshasa scindées en I et II (Kalamu, Maluku, Masina, Mont Ngafula)
 * - Ndjili (sans apostrophe dans la DB)
 * - Villes stockées à level=3 (Isiro, Bunia, Tshikapa)
 * - Manika (Kolwezi) → trouver via Lualaba level=3
 */
import postgres from 'postgres';

const sql = postgres('postgresql://neondb_owner:npg_tfY0qJhRsx2M@ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech/neondb?sslmode=require');

const SOURCE      = 'Ordonnance présidentielle 25/11/2022';
const SOURCE_LONG = 'Ordonnance présidentielle 25/11/2022 (à vérifier - données historiques nov. 2022)';
const DATE_NOM    = '2022-11-25';
const CONFIANCE   = 0.70;
let matched = 0;

async function insertMandat(pcode, personne, fonction, statut = 'A_VALIDER') {
  if (!pcode || !personne) return;
  const exists = await sql`
    SELECT id FROM responsable_mandat
    WHERE pcode = ${pcode} AND personne ILIKE ${personne} AND source = ${SOURCE} LIMIT 1
  `;
  if (exists.length > 0) return;
  await sql`
    INSERT INTO responsable_mandat (pcode, personne, fonction, date_debut, source, confiance, statut)
    VALUES (${pcode}, ${personne}, ${fonction}, ${DATE_NOM}, ${SOURCE}, ${CONFIANCE}, ${statut})
  `;
}

async function updateSnapshot(pcode, responsable, adjoint, titre) {
  if (!pcode) return;
  await sql`
    UPDATE admin_divisions
    SET responsable_nom         = ${responsable},
        responsable_titre       = ${titre},
        responsable_adjoint_nom = ${adjoint ?? null},
        responsable_source      = ${SOURCE_LONG},
        responsable_maj_le      = ${DATE_NOM}::date::timestamptz
    WHERE pcode = ${pcode}
      AND (responsable_nom IS NULL OR responsable_source = ${SOURCE_LONG})
  `;
}

// Assigne le même bourgmestre à toutes les subdivisions (Commune I + II)
async function processSplit(namePattern, bourgmestre, adjoint, titre = 'Bourgmestre') {
  const rows = await sql`
    SELECT pcode, name FROM admin_divisions
    WHERE name ILIKE ${namePattern} AND level = 3
    ORDER BY name
  `;
  if (rows.length === 0) { console.log(`  ?? NOT FOUND: ${namePattern}`); return; }
  for (const r of rows) {
    await insertMandat(r.pcode, bourgmestre, titre);
    if (adjoint) await insertMandat(r.pcode, adjoint, `Adjoint au ${titre}`);
    await updateSnapshot(r.pcode, bourgmestre, adjoint, titre);
    console.log(`  ok  ${r.name} → ${r.pcode}`);
  }
  matched += rows.length;
}

async function processExact(pcode, personne, adjoint, titre) {
  if (!pcode) return;
  await insertMandat(pcode, personne, titre);
  if (adjoint) await insertMandat(pcode, adjoint, `Adjoint au ${titre}`);
  await updateSnapshot(pcode, personne, adjoint, titre);
  console.log(`  ok  ${pcode}: ${personne}`);
  matched++;
}

// ── Communes Kinshasa scindées ───────────────────────────────────────────────
console.log('\n── Kinshasa — communes scindées I/II ───────────────────');

await processSplit('Kalamu%',       'MAKOPO LUBOYA Charly',    'KALANGAYI Daniel');
await processSplit('Maluku%',       'MAMPA MUNDONDI Alexis',   'MPEMBA MANATA Antoine');
await processSplit('Masina%',       'TSHIKU KATUMBA Joseph',   'NGALIMA MATONDO Nathan');
await processSplit('Mont Ngafula%', 'LUMBU MALAMBA Séverin',   'MUSENDE SELEMANI Zézé');

// N'Djili → stocké "Ndjili" sans apostrophe
await processExact('CD100030', 'MBUMBA NGALIEMA Papy', 'MAKUMA BILONDA Patricia', 'Bourgmestre');

// ── Villes stockées à level=3 ────────────────────────────────────────────────
console.log('\n── Villes à level=3 dans la DB ─────────────────────────');

// Isiro : CD530201 (level=3, sous CD5302, province Haut-Uélé CD53)
await processExact('CD530201', 'LOLA Guillaume', 'NETAMAYO NATANDISE Charlotte', 'Maire');

// Bunia : CD540202 (level=3, sous CD5402, province Ituri CD54)
await processExact('CD540202', 'Séverin TSEDHA', 'KANKU KAMUNGU Luc', 'Maire');

// Tshikapa : CD920208 (level=3, province Kasaï)
await processExact('CD920208', 'LUMU LUABO Faustin', 'TUMBA KASHALA Jean-Pierre', 'Maire');

// ── Kolwezi ──────────────────────────────────────────────────────────────────
console.log('\n── Kolwezi ─────────────────────────────────────────────');
{
  const rows = await sql`
    SELECT pcode, name, level FROM admin_divisions
    WHERE name ILIKE '%kolwezi%' ORDER BY level LIMIT 5
  `;
  console.log('  variants:', rows.map(r => `${r.pcode}(L${r.level}) ${r.name}`).join(' | ') || 'aucun');
  // Kolwezi ville : essayer aussi "Ville de Kolwezi"
  const ville = rows.find(r => r.level === 2 || r.level === 3);
  if (ville) {
    await processExact(ville.pcode, 'MASENGO KINDELE Jacques', 'FARIDA MWEPU Odile', 'Maire');
  }
}

// ── Manika (commune de Kolwezi, Lualaba) ─────────────────────────────────────
{
  // CD710504 est sous CD7105 (province Haut-Katanga) → c'est Manika de Lubumbashi, pas Kolwezi
  // Chercher Manika dans Lualaba (CD72)
  const rows = await sql`
    SELECT DISTINCT ad.pcode, ad.name
    FROM admin_divisions ad
    WHERE ad.name ILIKE 'Manika' AND ad.level = 3
      AND (
        ad.parent_pcode LIKE 'CD72%'
        OR ad.parent_pcode IN (SELECT pcode FROM admin_divisions WHERE parent_pcode LIKE 'CD72%')
      )
  `;
  if (rows.length === 1) {
    await processExact(rows[0].pcode, 'MUJINGA SAMBUMBA Thierry', 'MUSWIK Clément', 'Bourgmestre');
  } else {
    console.log(`  ?? Manika (Lualaba): ${rows.length} résultats`);
  }
}

// ── Kabondo (Boma, Kongo-Central) ────────────────────────────────────────────
{
  // CD510101 est sous Kisangani → probablement pas la commune de Boma
  // Chercher dans Kongo-Central CD20
  const rows = await sql`
    SELECT DISTINCT ad.pcode, ad.name, p.name AS parent
    FROM admin_divisions ad
    LEFT JOIN admin_divisions p ON p.pcode = ad.parent_pcode
    WHERE ad.name ILIKE 'Kabondo' AND ad.level = 3
      AND (
        ad.parent_pcode LIKE 'CD20%'
        OR ad.parent_pcode IN (SELECT pcode FROM admin_divisions WHERE parent_pcode LIKE 'CD20%')
      )
  `;
  if (rows.length === 1) {
    await processExact(rows[0].pcode, 'MWENDO MWANDA', 'MBUNGU MALONDA Edmond', 'Bourgmestre');
  } else {
    console.log(`  info Kabondo (Boma): introuvable dans Kongo-Central — absent de la DB COD-AB`);
  }
}

// ── Bilan ────────────────────────────────────────────────────────────────────
const total = await sql`SELECT COUNT(*) AS n FROM responsable_mandat WHERE source = ${SOURCE}`;
const snap  = await sql`SELECT COUNT(*) AS n FROM admin_divisions WHERE responsable_source LIKE '%25/11/2022%'`;

console.log(`\n══ Bilan 040b ══════════════════════════════════════════`);
console.log(`  Nouvelles entrées matchées : ${matched}`);
console.log(`  responsable_mandat total   : ${total[0].n}`);
console.log(`  admin_divisions mis à jour : ${snap[0].n}`);

await sql.end();
