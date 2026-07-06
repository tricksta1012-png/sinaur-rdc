/**
 * Seed 040 — Maires & Bourgmestres (Ordonnances présidentielles 25/11/2022)
 *
 * Charge la base historique des responsables communaux et municipaux.
 * Source : ordonnances présidentielles Félix Tshisekedi, 25 nov. 2022.
 * Rapportées par RTNC, mediacongo.net, Radio Okapi, Dépêche.cd.
 *
 * STATUT : A_VALIDER — données nov. 2022, peuvent avoir changé.
 * ⚠ Ngaliema (Kinshasa) : bourgmestre remplacé en avril 2025 → inséré HISTORIQUE.
 */
import postgres from 'postgres';

const sql = postgres('postgresql://neondb_owner:npg_tfY0qJhRsx2M@ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech/neondb?sslmode=require');

const SOURCE      = 'Ordonnance présidentielle 25/11/2022';
const SOURCE_LONG = 'Ordonnance présidentielle 25/11/2022 (à vérifier - données historiques nov. 2022)';
const DATE_NOM    = '2022-11-25';
const CONFIANCE   = 0.70;

let matched = 0, skipped = 0, notFound = [];

// ── Colonnes supplémentaires ─────────────────────────────────────────────────

await sql`ALTER TABLE admin_divisions ADD COLUMN IF NOT EXISTS responsable_adjoint_nom TEXT`;
await sql`ALTER TABLE admin_divisions ADD COLUMN IF NOT EXISTS responsable_source      TEXT`;
await sql`ALTER TABLE admin_divisions ADD COLUMN IF NOT EXISTS responsable_maj_le      TIMESTAMPTZ`;
console.log('  colonnes OK');

// ── Lookup province pcodes ───────────────────────────────────────────────────

const provincesRows = await sql`SELECT pcode, name_fr FROM admin_divisions WHERE level = 1`;
function provincePcode(fragment) {
  const f = fragment.toLowerCase();
  return provincesRows.find(p => p.name_fr?.toLowerCase().includes(f))?.pcode ?? null;
}

const PC = {
  kinshasa:     provincePcode('kinshasa'),
  kongocentral: provincePcode('kongo'),
  hautkatanga:  provincePcode('haut-katanga'),
  lualaba:      provincePcode('lualaba'),
  nordkivu:     provincePcode('nord-kivu'),
  sudkivu:      provincePcode('sud-kivu'),
  ituri:        provincePcode('ituri'),
  hautlomami:   provincePcode('haut-lomami'),
  hautuele:     provincePcode('haut-uélé') || provincePcode('haut-uele'),
  kasai:        provincePcode('kasaï') || provincePcode('kasai'),
  kasaicentral: provincePcode('kasaï-central') || provincePcode('kasai-central'),
  kasaior:      provincePcode('kasaï-oriental') || provincePcode('kasai-oriental'),
  maniema:      provincePcode('maniema'),
  mongala:      provincePcode('mongala'),
  nordkivu2:    provincePcode('nord-kivu'),
  sankuru:      provincePcode('sankuru'),
  equateur:     provincePcode('équateur') || provincePcode('equateur'),
  tshuapa:      provincePcode('tshuapa'),
  maindombbe:   provincePcode('maï-ndombe') || provincePcode('mai-ndombe'),
  nordub:       provincePcode('nord-ubangi'),
  sudub:        provincePcode('sud-ubangi'),
  tshopo:       provincePcode('tshopo'),
  tanganyika:   provincePcode('tanganyika'),
  lomami:       provincePcode('lomami'),
  kwilu:        provincePcode('kwilu'),
};
console.log('  province pcodes:', JSON.stringify(PC, null, 2));

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findInProvince(name, level, provincePcode) {
  if (!provincePcode) return null;
  // Check up to 3 ancestor hops
  const rows = await sql`
    SELECT DISTINCT ad.pcode
    FROM admin_divisions ad
    WHERE ad.name ILIKE ${name} AND ad.level = ${level}
      AND (
        ad.parent_pcode = ${provincePcode}
        OR ad.parent_pcode IN (
          SELECT pcode FROM admin_divisions WHERE parent_pcode = ${provincePcode}
        )
        OR ad.parent_pcode IN (
          SELECT pcode FROM admin_divisions WHERE parent_pcode IN (
            SELECT pcode FROM admin_divisions WHERE parent_pcode = ${provincePcode}
          )
        )
      )
  `;
  if (rows.length === 1) return rows[0].pcode;
  if (rows.length > 1) console.log(`  AMBIGU ${name} (niveau ${level}) → ${rows.map(r => r.pcode).join(', ')}`);
  return null;
}

async function findVille(name) {
  const rows = await sql`SELECT pcode FROM admin_divisions WHERE name ILIKE ${name} AND level = 2`;
  if (rows.length === 1) return rows[0].pcode;
  if (rows.length > 1) console.log(`  AMBIGU ville ${name} → ${rows.map(r => r.pcode).join(', ')}`);
  return null;
}

async function insertMandat(pcode, personne, fonction, statut = 'A_VALIDER', dateFin = null) {
  if (!pcode || !personne) return;
  const exists = await sql`
    SELECT id FROM responsable_mandat
    WHERE pcode = ${pcode} AND personne ILIKE ${personne} AND source = ${SOURCE} LIMIT 1
  `;
  if (exists.length > 0) return;
  await sql`
    INSERT INTO responsable_mandat (pcode, personne, fonction, date_debut, date_fin, source, confiance, statut)
    VALUES (${pcode}, ${personne}, ${fonction}, ${DATE_NOM}, ${dateFin}, ${SOURCE}, ${CONFIANCE}, ${statut})
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
      AND (responsable_nom IS NULL
           OR responsable_source = ${SOURCE_LONG})
  `;
}

async function processCommune({ name, bourgmestre, adjoint = null, provincePcode, titre = 'Bourgmestre' }) {
  const pcode = await findInProvince(name, 3, provincePcode)
    ?? await findInProvince(name, 2, provincePcode); // fallback si communes à level=2
  if (!pcode) {
    notFound.push(`commune:${name}`);
    return;
  }
  await insertMandat(pcode, bourgmestre, titre);
  if (adjoint) await insertMandat(pcode, adjoint, `Adjoint au ${titre}`);
  await updateSnapshot(pcode, bourgmestre, adjoint, titre);
  console.log(`  ok  commune:${name} → ${pcode}`);
  matched++;
}

async function processVille({ name, maire, adjoint = null, statut = 'A_VALIDER' }) {
  const pcode = await findVille(name);
  if (!pcode) {
    notFound.push(`ville:${name}`);
    return;
  }
  await insertMandat(pcode, maire, 'Maire', statut);
  if (adjoint) await insertMandat(pcode, adjoint, 'Adjoint au Maire', statut);
  await updateSnapshot(pcode, maire, adjoint, 'Maire');
  console.log(`  ok  ville:${name} → ${pcode}`);
  matched++;
}

// ════════════════════════════════════════════════════════════════════════════
// DONNÉES
// ════════════════════════════════════════════════════════════════════════════

// ── 1. KINSHASA — 24 communes ────────────────────────────────────────────────
console.log('\n── Kinshasa (24 communes) ──────────────────────────────');
const kinshasa24 = [
  { name: 'Bandalungwa',  bourgmestre: 'NDOFULA Alphonse',            adjoint: 'NOBO KASONGO Graciel' },
  { name: 'Barumbu',      bourgmestre: 'LOMAMI Christophe',           adjoint: 'NDONGALA KARDOZO Émile' },
  { name: 'Bumbu',        bourgmestre: 'MUKWANO Marie',               adjoint: 'TSHIMWANGA Katumba' },
  { name: 'Kalamu',       bourgmestre: 'MAKOPO LUBOYA Charly',        adjoint: 'KALANGAYI Daniel' },
  { name: 'Kasa-Vubu',    bourgmestre: 'MASOMBO MPOY',                adjoint: 'MASWALU Sandra' },
  { name: 'Gombe',        bourgmestre: 'MANZAMBI NZOLA Léopold',      adjoint: 'ISAMBO APONDJO Vinsainte' },
  { name: 'Kimbanseke',   bourgmestre: 'MAKOFI Picasso',              adjoint: 'KIDUMU Jeancy' },
  { name: 'Kinshasa',     bourgmestre: 'MBALIBI Bienvenu',            adjoint: 'LEKOLA LEKOLA ESOKO Prince' },
  { name: 'Kintambo',     bourgmestre: 'KILALA Pépitho',              adjoint: 'NGINAMAWU MBO NZINGA' },
  { name: 'Lemba',        bourgmestre: 'POBA MAYIMONA Jean Serge',    adjoint: 'ISOTO Simone' },
  { name: 'Limete',       bourgmestre: 'ALAMBA Feza',                 adjoint: 'Isaac MUKENDI' },
  { name: 'Lingwala',     bourgmestre: 'MUSHIGA NZINDULA Norbert',    adjoint: 'Denise VILA' },
  { name: 'Makala',       bourgmestre: 'VONGI MATOMINA Baudouin',     adjoint: 'NGUDIA KABONGO Kafedio' },
  { name: 'Maluku',       bourgmestre: 'MAMPA MUNDONDI Alexis',       adjoint: 'MPEMBA MANATA Antoine' },
  { name: 'Masina',       bourgmestre: 'TSHIKU KATUMBA Joseph',       adjoint: 'NGALIMA MATONDO Nathan' },
  { name: 'Matete',       bourgmestre: 'MUKUMBI MUKAWA Jules',        adjoint: 'MUTOMBO KINSEBA' },
  { name: 'Mont-Ngafula', bourgmestre: 'LUMBU MALAMBA Séverin',       adjoint: 'MUSENDE SELEMANI Zézé' },
  { name: 'Ngaba',        bourgmestre: 'LOYINGA Aimé Francis',        adjoint: 'KIWEWA Christelle' },
  // Ngaliema : remplacé en avril 2025 → inséré HISTORIQUE avec date_fin
  { name: 'Ngiri-ngiri',  bourgmestre: 'MWAMBA TSHINANDUKU Édouard',  adjoint: 'AYONZIALA Béatrice' },
  { name: 'Nsele',        bourgmestre: 'MBO NZALAMESU Franck',        adjoint: 'MANGU MATATA Christian' },
  { name: 'Selembao',     bourgmestre: 'WOMUMU NANI Matthias',        adjoint: 'MOYINA BABWA Claudia' },
  { name: 'Kisenso',      bourgmestre: 'ASIWEL Godet',                adjoint: 'ILUNGA NYAMABO Ivon' },
  { name: 'N\'Djili',     bourgmestre: 'MBUMBA NGALIEMA Papy',        adjoint: 'MAKUMA BILONDA Patricia' },
];
for (const c of kinshasa24) {
  await processCommune({ ...c, provincePcode: PC.kinshasa });
}

// Ngaliema : remplacé en avril 2025
{
  const pcode = await findInProvince('Ngaliema', 3, PC.kinshasa)
    ?? await findInProvince('Ngaliema', 2, PC.kinshasa);
  if (pcode) {
    await insertMandat(pcode, 'MAYIBAZILWANGA Dieu Merci', 'Bourgmestre', 'HISTORIQUE', '2025-04-29');
    await insertMandat(pcode, 'AYINAGATO NAKWIKONDE Noëlla', 'Adjoint au Bourgmestre', 'HISTORIQUE', '2025-04-29');
    await insertMandat(pcode, 'Fulgence Bolonkomo Webeke', 'Bourgmestre', 'A_VALIDER');
    // Snapshot : mettre le nouveau bourgmestre
    await sql`
      UPDATE admin_divisions
      SET responsable_nom   = 'Fulgence Bolonkomo Webeke',
          responsable_titre = 'Bourgmestre',
          responsable_source = 'Arrêté 29/04/2025 (remplace MAYIBAZILWANGA Dieu Merci, ordonnance 25/11/2022)',
          responsable_maj_le = '2025-04-29'::date::timestamptz
      WHERE pcode = ${pcode}
    `;
    console.log(`  ok  commune:Ngaliema → ${pcode} (historique + remplacement 2025)`);
    matched++;
  } else {
    notFound.push('commune:Ngaliema');
  }
}

// ── 2. KONGO-CENTRAL — Matadi & Boma ────────────────────────────────────────
console.log('\n── Kongo-Central (villes + communes) ──────────────────');

await processVille({ name: 'Matadi', maire: 'NKODIA MBETE Dominique', adjoint: 'WEKA WA PUNGU ONAPALA Médard' });
await processVille({ name: 'Boma',   maire: 'MBUTUYIBI KUAKULA Senghor', adjoint: 'PHEMBA KIADI Claudelle' });

const kongoCommunes = [
  { name: 'Matadi',   bourgmestre: 'KIAMESO YUBU Patrick',         adjoint: 'NKIAMBOTE KIZENGI Emery' },
  { name: 'Mvuzi',    bourgmestre: 'MBUINGA TATY Oscar',            adjoint: 'LUZOLO NGOMA Chantal' },
  { name: 'Nzanza',   bourgmestre: 'LELO MASOMBA NANA Esther',      adjoint: 'MINGIELE Michel' },
  { name: 'Kabondo',  bourgmestre: 'MWENDO MWANDA',                 adjoint: 'MBUNGU MALONDA Edmond' },
  { name: 'Kalamu',   bourgmestre: 'LUSAKUENO MATEZOLO',            adjoint: 'PONGI NSASI Paul' },
  { name: 'Nzadi',    bourgmestre: 'BAYAKISA VUAKUMESO Bobette',    adjoint: 'YIMBU LONGO Alphonse' },
];
for (const c of kongoCommunes) {
  await processCommune({ ...c, provincePcode: PC.kongocentral });
}

// ── 3. LES 32 VILLES — maires ───────────────────────────────────────────────
console.log('\n── 32 villes (maires) ──────────────────────────────────');

// ⚠ Boma et Matadi déjà traités ci-dessus
const villes32 = [
  { name: 'Lubumbashi',  maire: 'KAZEMBE SHULA Martin',        adjoint: 'TUNDA KAZADI' },
  { name: 'Likasi',      maire: 'MUNGOMBA TAMBA Henry',         adjoint: 'MUNZINGA Jean' },
  { name: 'Kamina',      maire: 'UMBA NDOLO Miky',              adjoint: 'NGOY NKULU Thérèse' },
  { name: 'Isiro',       maire: 'LOLA Guillaume',               adjoint: 'NETAMAYO NATANDISE Charlotte' },
  { name: 'Bunia',       maire: 'Séverin TSEDHA',               adjoint: 'KANKU KAMUNGU Luc' },       // ⚠ état de siège
  { name: 'Tshikapa',    maire: 'LUMU LUABO Faustin',           adjoint: 'TUMBA KASHALA Jean-Pierre' },
  { name: 'Kananga',     maire: 'MWADI MUSUBE Rose',            adjoint: 'TSHIPAMBA ILUNGA Jean-Louis' },
  { name: 'Mbuji-Mayi',  maire: 'LUTUMBA KATUPUYI Jean-Marie',  adjoint: 'MUKENDI MAKANDA Patrick' },
  { name: 'Kisangani',   maire: 'LUKUNDE LITAWERE',             adjoint: 'WANDADI BIEKUSA' },
  { name: 'Boende',      maire: 'BOKOTO ILO Joël',              adjoint: 'BOYO LOFIMA Pierre' },
  { name: 'Kindu',       maire: 'MULAMBA ATIBU Augustin',       adjoint: 'KASALANGA MOKOTA Étienne' },
  { name: 'Lisala',      maire: 'BONGELE YEMA Aimé',            adjoint: 'MOMENGABI ELOKO Blaise' },
  { name: 'Beni',        maire: 'KAMBALA KALEMBA Emmanuel',     adjoint: 'KAVIRA KITUANDUMBA Jolie' }, // ⚠ état de siège
  { name: 'Butembo',     maire: 'KASEREKA MUHINDO',             adjoint: 'PALUKU Florent' },           // ⚠ état de siège
  { name: 'Goma',        maire: 'KAYENGA BINDU Kennedy',        adjoint: 'MYALI KALENGA Jacques' },    // ⚠ état de siège + M23
  { name: 'Gbadolite',   maire: 'KAPALATA TEGEYERO',            adjoint: 'BONDO TAMBO Gaspard' },
  { name: 'Lusambo',     maire: 'MANGA LUPATSHIA Louis',        adjoint: 'OTSHUDI Roger' },
  { name: 'Bukavu',      maire: 'KARUMBA SIKUTA',               adjoint: 'BIGIRIMANA Augustin' },
  { name: 'Gemena',      maire: 'LUBAYA MBUKA Jacob',           adjoint: 'BUEMISANGA MBELENGE Julien' },
  { name: 'Zongo',       maire: 'NGUMA KOLA AZOKOLO',           adjoint: null },
  // Complément — sources Congo Inter + Enquête.cd
  { name: 'Bandundu',    maire: 'MOSENGWO SHEME Moïse',         adjoint: 'MUKANDA KAFUTI Véronique' },
  { name: 'Kikwit',      maire: 'NGIAMA KATSHAKA',              adjoint: 'LULA MUSUTI Charlotte' },
  { name: 'Kabinda',     maire: 'TSHABU TSHITENGIE Anne-Marie', adjoint: 'MWANZA MUTOMBO Clément' },
  { name: 'Mwene-Ditu',  maire: 'TSHIBANDA KABWE Gérard',       adjoint: 'KALOMBA KIBAMBE Gédéon' },
  { name: 'Kolwezi',     maire: 'MASENGO KINDELE Jacques',      adjoint: 'FARIDA MWEPU Odile' },
  { name: 'Inongo',      maire: 'MBOMBANI MOTERI',              adjoint: 'DAWILI PENGELE' },
  { name: 'Mbandaka',    maire: 'BALO BOKOLO Yves',             adjoint: 'NDJOKU NYATONGO Odette' },
  { name: 'Kalemie',     maire: 'MUKEBA MBOMBO David',          adjoint: 'KAPATA MUTETA' },
];
for (const v of villes32) {
  await processVille(v);
}

// ── 4. LUBUMBASHI — 7 communes ───────────────────────────────────────────────
console.log('\n── Lubumbashi (7 communes) ─────────────────────────────');
const lubumbashi7 = [
  { name: 'Lubumbashi', bourgmestre: 'MUSONDA NEMBALEMBA',       adjoint: 'DINANGA WA MBUYI Oscar' },
  { name: 'Kenya',       bourgmestre: 'KAZADI MUMBA',             adjoint: 'NYEMBO MONGA Pashil' },
  { name: 'Katuba',      bourgmestre: 'MUTANGALA MUSODI',         adjoint: 'NYEMBWE NSANGWA' },
  { name: 'Kamalondo',   bourgmestre: 'KALWA KALUNGA Ghislain',   adjoint: 'SADI RAMAZANI' },
  { name: 'Kampemba',    bourgmestre: 'MIANDA KONGOLO',           adjoint: 'OTSHUDI AKOLA Daniel' },
  { name: 'Annexe',      bourgmestre: 'KILESHYE SEKWE Mireille',  adjoint: 'MUKENGE BASWA' },
  { name: 'Rwashi',      bourgmestre: 'MUJINGA Lucie',            adjoint: 'KISHIMBI NGOMBOLA' },
];
for (const c of lubumbashi7) {
  await processCommune({ ...c, provincePcode: PC.hautkatanga });
}

// ── 5. KOLWEZI — 3 communes ──────────────────────────────────────────────────
console.log('\n── Kolwezi (3 communes) ────────────────────────────────');
const kolwezi3 = [
  { name: 'Dilala',     bourgmestre: 'MANGWEJ KAHAWA Françoise',  adjoint: 'KATUNGWE NYEMBO Michel' },
  { name: 'Manika',     bourgmestre: 'MUJINGA SAMBUMBA Thierry',  adjoint: 'MUSWIK Clément' },
  { name: 'Fungurume',  bourgmestre: 'KALENG TAMB',               adjoint: 'MAKANO Aline' },
];
for (const c of kolwezi3) {
  await processCommune({ ...c, provincePcode: PC.lualaba });
}

// ════════════════════════════════════════════════════════════════════════════
// BILAN
// ════════════════════════════════════════════════════════════════════════════

const totalMandat = await sql`SELECT COUNT(*) AS n FROM responsable_mandat WHERE source = ${SOURCE}`;
const totalSnap   = await sql`SELECT COUNT(*) AS n FROM admin_divisions WHERE responsable_source LIKE '%25/11/2022%'`;

console.log(`\n══ Résultat ════════════════════════════════════════════`);
console.log(`  Entrées matchées  : ${matched}`);
console.log(`  Non trouvées      : ${notFound.length}${notFound.length ? ' → ' + notFound.join(', ') : ''}`);
console.log(`  responsable_mandat (source 2022) : ${totalMandat[0].n}`);
console.log(`  admin_divisions mis à jour       : ${totalSnap[0].n}`);
console.log(`  Statut : A_VALIDER (données 2022 — à confirmer par veille presse)`);

await sql.end();
