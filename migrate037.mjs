import postgres from 'postgres';
import { readFileSync } from 'fs';

const sql = postgres('postgresql://neondb_owner:npg_tfY0qJhRsx2M@ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech/neondb?sslmode=require');
const migration = readFileSync('./db/migrations/037_media_local.sql', 'utf8');

try {
  await sql.unsafe(migration);
  console.log('Migration 037 appliquee avec succes');
  const check = await sql`SELECT COUNT(*) AS n FROM media_local`;
  console.log('Verification media_local OK -', check[0].n, 'lignes');
} catch(e) {
  console.error('Erreur:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
