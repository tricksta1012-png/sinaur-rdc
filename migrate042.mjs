/**
 * Migration 041 + 042 : evenement_flux + fix trigger source_collecte
 * Migration 041 avait échoué complètement (rollback Neon).
 * Ce script l'applique proprement puis fixe le trigger défaillant.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_tfY0qJhRsx2M@ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech/neondb?sslmode=require');

async function main() {
  // ── Étape 1 : Table evenement_flux ────────────────────────────────────────
  console.log('Étape 1 : Création evenement_flux...');
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS evenement_flux (
      id                SERIAL PRIMARY KEY,
      source_agent      TEXT NOT NULL,
      type_evenement    TEXT NOT NULL,
      titre             TEXT NOT NULL,
      description       TEXT,
      province_pcode    TEXT REFERENCES admin_divisions(pcode) ON DELETE SET NULL,
      territoire_pcode  TEXT,
      lat               DOUBLE PRECISION,
      lon               DOUBLE PRECISION,
      fiabilite         NUMERIC(3,2) DEFAULT 0.50
        CHECK (fiabilite BETWEEN 0 AND 1),
      statut_verification TEXT NOT NULL DEFAULT 'A_CORROBORER'
        CHECK (statut_verification IN ('A_CORROBORER','PROBABLE','CORROBORE','INFIRME')),
      sources           JSONB    DEFAULT '[]',
      nb_sources        INTEGER  DEFAULT 1,
      gravite           TEXT NOT NULL DEFAULT 'NORMALE'
        CHECK (gravite IN ('NORMALE','ELEVEE','CRITIQUE')),
      impacte_statut    BOOLEAN  DEFAULT false,
      source_url        TEXT,
      source_externe_id TEXT,
      date_evenement    TIMESTAMPTZ,
      cree_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      maj_le            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS flux_dedup_idx
      ON evenement_flux(source_agent, source_externe_id)
      WHERE source_externe_id IS NOT NULL
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS flux_province_idx ON evenement_flux(province_pcode)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS flux_statut_idx   ON evenement_flux(statut_verification)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS flux_date_idx     ON evenement_flux(date_evenement DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS flux_type_idx     ON evenement_flux(type_evenement)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS flux_gravite_idx  ON evenement_flux(gravite) WHERE gravite IN ('ELEVEE','CRITIQUE')`);
  console.log('  ✓ evenement_flux créée');

  // ── Étape 2 : Colonnes source_collecte ────────────────────────────────────
  console.log('Étape 2 : Colonnes source_collecte...');
  await sql.unsafe(`
    ALTER TABLE source_collecte
      ADD COLUMN IF NOT EXISTS priorite TEXT NOT NULL DEFAULT 'STANDARD'
        CHECK (priorite IN ('PRIORITAIRE','STANDARD','LENTE')),
      ADD COLUMN IF NOT EXISTS dernier_item_traite TEXT
  `);
  console.log('  ✓ colonnes ajoutées');

  // ── Étape 3 : Corriger le trigger AVANT les UPDATE ─────────────────────────
  console.log('Étape 3 : Correction trigger source_collecte...');
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION update_source_collecte_ts()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      NEW.mis_a_jour_le = NOW();
      RETURN NEW;
    END;
    $$
  `);
  await sql.unsafe(`DROP TRIGGER IF EXISTS source_collecte_updated_at ON source_collecte`);
  await sql.unsafe(`
    CREATE TRIGGER source_collecte_updated_at
      BEFORE UPDATE ON source_collecte
      FOR EACH ROW EXECUTE FUNCTION update_source_collecte_ts()
  `);
  console.log('  ✓ trigger corrigé');

  // ── Étape 4 : Priorités collecte ──────────────────────────────────────────
  console.log('Étape 4 : Priorités sources...');
  const p1 = await sql`
    UPDATE source_collecte SET priorite = 'PRIORITAIRE'
    WHERE connector_id IN ('radio_okapi','kmp_rss','kmp_youtube','acled_deep')
       OR (categorie IN ('CONFLIT','SECURITE') AND frequence_minutes <= 180)
  `;
  const p2 = await sql`
    UPDATE source_collecte SET priorite = 'LENTE'
    WHERE frequence_minutes >= 720
       OR connector_id IN ('ucdp','ocha_hdx','fews_net','views','gdacs_cat')
  `;
  console.log(`  ✓ PRIORITAIRE: ${p1.count}, LENTE: ${p2.count}`);

  // ── Vérification finale ────────────────────────────────────────────────────
  const check = await sql`SELECT COUNT(*) FROM evenement_flux`;
  console.log(`\n✓ Migration complète — evenement_flux: ${check[0].count} lignes`);

  const prios = await sql`
    SELECT priorite, COUNT(*) FROM source_collecte GROUP BY priorite ORDER BY priorite
  `;
  prios.forEach(r => console.log(`  source_collecte.priorite=${r.priorite}: ${r.count}`));
}

main().catch(err => {
  console.error('ÉCHEC:', err.message);
  process.exit(1);
}).finally(() => sql.end());
