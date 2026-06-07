/**
 * Applique les seeds de démonstration.
 * Usage : pnpm --filter @sinaur/api db:seed
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import postgres from 'postgres';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = join(__dirname, '../../../../db/seeds');

const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });

async function seed(): Promise<void> {
  if (config.NODE_ENV === 'production') {
    console.error('✗  Impossible de seeder en production');
    process.exit(1);
  }

  // Hasher les mots de passe des utilisateurs de démo
  const demoPassword = await bcrypt.hash('demo1234', 12);
  await sql`
    UPDATE users SET password_hash = ${demoPassword}
    WHERE email LIKE '%sinaur-rdc.cd%' OR email LIKE '%@un.org' OR email LIKE '%@rdc.cd'
  `;

  // Appliquer les seeds SQL
  const files = (await readdir(SEEDS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`▶  Seed: ${file}`);
    const content = await readFile(join(SEEDS_DIR, file), 'utf-8');
    await sql.unsafe(content);
    console.log(`✓  ${file}`);
  }

  console.log('✓  Seeds appliqués');
  await sql.end();
}

seed().catch((err) => {
  console.error('✗  Seed échoué:', err.message);
  process.exit(1);
});
