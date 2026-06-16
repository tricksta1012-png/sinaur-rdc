/**
 * Génère et insère les 26 comptes coordinateurs provinciaux avec mots de passe uniques.
 * Usage: node scripts/create-provincial-accounts.mjs
 */
import bcrypt from 'bcrypt';
import { createRequire } from 'module';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL manquant');
  process.exit(1);
}

const PROVINCES = [
  { pcode: 'CD10', name: 'Kinshasa',        abbr: 'KIN', email: 'coord.kinshasa@sinaur.cd'       },
  { pcode: 'CD20', name: 'Kongo-Central',   abbr: 'KCT', email: 'coord.kongo-central@sinaur.cd'  },
  { pcode: 'CD21', name: 'Kwango',          abbr: 'KWA', email: 'coord.kwango@sinaur.cd'          },
  { pcode: 'CD22', name: 'Kwilu',           abbr: 'KWI', email: 'coord.kwilu@sinaur.cd'           },
  { pcode: 'CD23', name: 'Maï-Ndombe',      abbr: 'MND', email: 'coord.mai-ndombe@sinaur.cd'      },
  { pcode: 'CD41', name: 'Équateur',        abbr: 'EQU', email: 'coord.equateur@sinaur.cd'        },
  { pcode: 'CD42', name: 'Sud-Ubangi',      abbr: 'SUB', email: 'coord.sud-ubangi@sinaur.cd'      },
  { pcode: 'CD43', name: 'Nord-Ubangi',     abbr: 'NUB', email: 'coord.nord-ubangi@sinaur.cd'     },
  { pcode: 'CD44', name: 'Mongala',         abbr: 'MNG', email: 'coord.mongala@sinaur.cd'         },
  { pcode: 'CD45', name: 'Tshuapa',         abbr: 'TSH', email: 'coord.tshuapa@sinaur.cd'         },
  { pcode: 'CD51', name: 'Tshopo',          abbr: 'TPO', email: 'coord.tshopo@sinaur.cd'          },
  { pcode: 'CD52', name: 'Bas-Uélé',        abbr: 'BUE', email: 'coord.bas-uele@sinaur.cd'        },
  { pcode: 'CD53', name: 'Haut-Uélé',       abbr: 'HUE', email: 'coord.haut-uele@sinaur.cd'       },
  { pcode: 'CD54', name: 'Ituri',           abbr: 'ITU', email: 'coord.ituri@sinaur.cd'           },
  { pcode: 'CD61', name: 'Nord-Kivu',       abbr: 'NKV', email: 'coord.nord-kivu@sinaur.cd'       },
  { pcode: 'CD62', name: 'Sud-Kivu',        abbr: 'SKV', email: 'coord.sud-kivu@sinaur.cd'        },
  { pcode: 'CD63', name: 'Maniema',         abbr: 'MAN', email: 'coord.maniema@sinaur.cd'         },
  { pcode: 'CD71', name: 'Haut-Katanga',    abbr: 'HKT', email: 'coord.haut-katanga@sinaur.cd'    },
  { pcode: 'CD72', name: 'Lualaba',         abbr: 'LUA', email: 'coord.lualaba@sinaur.cd'         },
  { pcode: 'CD73', name: 'Haut-Lomami',     abbr: 'HLM', email: 'coord.haut-lomami@sinaur.cd'     },
  { pcode: 'CD74', name: 'Tanganyika',      abbr: 'TAN', email: 'coord.tanganyika@sinaur.cd'      },
  { pcode: 'CD81', name: 'Lomami',          abbr: 'LOM', email: 'coord.lomami@sinaur.cd'          },
  { pcode: 'CD82', name: 'Kasaï-Oriental',  abbr: 'KOR', email: 'coord.kasai-oriental@sinaur.cd'  },
  { pcode: 'CD83', name: 'Kasaï',           abbr: 'KSI', email: 'coord.kasai@sinaur.cd'           },
  { pcode: 'CD84', name: 'Kasaï-Central',   abbr: 'KCN', email: 'coord.kasai-central@sinaur.cd'   },
  { pcode: 'CD85', name: 'Sankuru',         abbr: 'SNK', email: 'coord.sankuru@sinaur.cd'         },
];

// Génère un mot de passe unique par province
function makePassword(abbr) {
  // Seed déterministe basé sur l'abréviation → reproductible si besoin de regénérer
  const seed = abbr.charCodeAt(0) * 317 + abbr.charCodeAt(1) * 53 + (abbr.charCodeAt(2) ?? 0) * 7;
  const num = String((seed % 9000) + 1000); // 4 chiffres entre 1000 et 9999
  return `${abbr}@Sinaur${num}!`;
}

async function main() {
  const sql = postgres(DATABASE_URL, { ssl: 'require' });

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         SINAUR-RDC — Comptes Coordinateurs Provinciaux          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const p of PROVINCES) {
    const password = makePassword(p.abbr);
    const hash = await bcrypt.hash(password, 12);

    try {
      const [existing] = await sql`
        SELECT id FROM users WHERE email = ${p.email} AND deleted_at IS NULL
      `;

      if (existing) {
        // Mise à jour scope si déjà existant avec mauvais pcode
        await sql`
          UPDATE users
          SET geographic_scope_pcodes = ${sql.array([p.pcode])},
              password_hash = ${hash},
              display_name = ${'Coordinateur — ' + p.name},
              is_active = TRUE
          WHERE email = ${p.email}
        `;
        results.push({ ...p, password, status: 'mis à jour' });
        console.log(`  ✓ [MàJ]   ${p.name.padEnd(20)} ${p.email}`);
      } else {
        await sql`
          INSERT INTO users (email, display_name, role, geographic_scope_pcodes, password_hash, is_active)
          VALUES (
            ${p.email},
            ${'Coordinateur — ' + p.name},
            'provincial_coordinator',
            ${sql.array([p.pcode])},
            ${hash},
            TRUE
          )
        `;
        results.push({ ...p, password, status: 'créé' });
        console.log(`  ✓ [Créé]  ${p.name.padEnd(20)} ${p.email}`);
      }
    } catch (err) {
      console.error(`  ✗ [Erreur] ${p.name}: ${err.message}`);
    }
  }

  await sql.end();

  // Tableau récapitulatif
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       IDENTIFIANTS DE CONNEXION                               ║');
  console.log('╠══════════════╦═══════════════════════════════════════╦════════════════════════╣');
  console.log('║ Province     ║ Email                                 ║ Mot de passe           ║');
  console.log('╠══════════════╬═══════════════════════════════════════╬════════════════════════╣');
  for (const r of results) {
    const prov = r.name.substring(0, 12).padEnd(12);
    const email = r.email.padEnd(37);
    const pw = r.password.padEnd(22);
    console.log(`║ ${prov} ║ ${email} ║ ${pw} ║`);
  }
  console.log('╚══════════════╩═══════════════════════════════════════╩════════════════════════╝');
  console.log('\n⚠  Communiquer chaque mot de passe individuellement à son coordinateur.');
  console.log('⚠  Changer les mots de passe après la première connexion.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
