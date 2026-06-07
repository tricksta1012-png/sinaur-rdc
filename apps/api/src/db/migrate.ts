/**
 * Exécute les migrations SQL en ordre numérique.
 * Usage : pnpm --filter @sinaur/api db:migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../db/migrations');

const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });

async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = new Set(
    (await sql`SELECT version FROM schema_migrations ORDER BY version`).map((r) => r.version),
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    console.log(`▶  Applying migration: ${file}`);
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');

    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (version) VALUES (${file})`;
    });

    console.log(`✓  ${file}`);
    ran++;
  }

  if (ran === 0) console.log('✓  Base de données à jour (aucune migration à appliquer)');
  else console.log(`✓  ${ran} migration(s) appliquée(s)`);

  await sql.end();
}

migrate().catch((err) => {
  console.error('✗  Migration échouée:', err.message);
  process.exit(1);
});
