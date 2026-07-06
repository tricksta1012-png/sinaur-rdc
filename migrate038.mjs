/**
 * Seed 038 : liens de collecte médias RDC vérifiés
 * - source_collecte : sections Radio Okapi, presse nationale, médias provinciaux
 * - media_local     : correction URL RTCT Tayna, ajout Radio Moto + presse nationale
 */
import postgres from 'postgres';

const sql = postgres('postgresql://neondb_owner:npg_tfY0qJhRsx2M@ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech/neondb?sslmode=require');

try {
  // ── Corriger le trigger media_local (mis_a_jour_le ≠ updated_at) ───────────
  await sql`
    DROP TRIGGER IF EXISTS media_local_updated_at ON media_local
  `;
  await sql`
    CREATE OR REPLACE FUNCTION update_mis_a_jour_le()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.mis_a_jour_le = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    CREATE TRIGGER media_local_updated_at
      BEFORE UPDATE ON media_local
      FOR EACH ROW EXECUTE FUNCTION update_mis_a_jour_le()
  `;
  console.log('Trigger media_local corrige');

  // ── source_collecte : sources WEB collectables ──────────────────────────────
  await sql`
    INSERT INTO source_collecte
      (nom, type_source, categorie, agent, url, fiabilite, frequence_minutes, actif, statut_sante, note)
    VALUES
      ('Radio Okapi - Actualite', 'WEB', 'GENERAL',
       'renseignement', 'https://www.radiookapi.net/actualite',
       0.85, 180, true, 'UNKNOWN', 'Flux general actualite nationale RDC'),

      ('Radio Okapi - Securite RDC', 'WEB', 'CONFLIT',
       'renseignement', 'https://www.radiookapi.net/mot-cle/rdc',
       0.85, 120, true, 'UNKNOWN', 'Tag securite/conflits RDC — articles par territoire'),

      ('Radio Okapi - Sante', 'WEB', 'EPIDEMIE',
       'epidemie', 'https://www.radiookapi.net/sante',
       0.85, 360, true, 'UNKNOWN', 'Rubrique sante Radio Okapi'),

      ('Radio Okapi - Ebola', 'WEB', 'EPIDEMIE',
       'epidemie', 'https://www.radiookapi.net/mot-cle/ebola',
       0.90, 120, true, 'UNKNOWN', 'Tag Ebola Radio Okapi — surveiller en priorite en cas d''epizootie'),

      ('Actualite.cd', 'WEB', 'GENERAL',
       'renseignement', 'https://actualite.cd',
       0.80, 360, true, 'UNKNOWN', 'Presse en ligne nationale, tres suivi'),

      ('7sur7.cd', 'WEB', 'GENERAL',
       'renseignement', 'https://www.7sur7.cd',
       0.72, 360, true, 'UNKNOWN', 'Populaire, couverture nationale'),

      ('Politico.cd', 'WEB', 'GENERAL',
       'renseignement', 'https://www.politico.cd',
       0.70, 480, true, 'UNKNOWN', 'Actualite politique nationale'),

      ('Mediacongo', 'WEB', 'GENERAL',
       'renseignement', 'https://www.mediacongo.net',
       0.72, 360, true, 'UNKNOWN', 'Agregateur presse congolaise'),

      ('CORACON', 'WEB', 'GENERAL',
       'renseignement', 'https://coracondrc.com',
       0.70, 720, true, 'UNKNOWN', 'Reseau 25+ radios Nord-Kivu — collecteur regional'),

      ('RTCT Tayna', 'WEB', 'GENERAL',
       'renseignement', 'https://radiotayna.com',
       0.72, 720, true, 'UNKNOWN', 'Radio Tayna Goma — directeur corresp. Deutsche Welle'),

      ('Radio Moto Butembo', 'WEB', 'GENERAL',
       'renseignement', 'https://www.radiomoto.net',
       0.65, 720, true, 'UNKNOWN', 'Radio diocesaine Butembo-Beni, 25 ans d''existence'),

      ('RTNC officielle', 'WEB', 'GENERAL',
       'renseignement', 'https://communication.gouv.cd/live-rtnc',
       0.60, 1440, true, 'UNKNOWN', 'Ligne officielle — gouvernement'),

      ('Ministere Sante RDC', 'WEB', 'EPIDEMIE',
       'epidemie', 'https://sante.gouv.cd',
       0.85, 720, true, 'UNKNOWN', 'Communiques officiels epidemies — source primaire pour corroborer')

    ON CONFLICT (nom, type_source) DO NOTHING
  `;
  console.log('source_collecte : OK');

  // ── media_local : correction + ajouts ──────────────────────────────────────

  // Corriger URL RTCT Tayna (www. en moins)
  await sql`
    UPDATE media_local
    SET url = 'https://radiotayna.com', statut = 'ACTIF', mis_a_jour_le = NOW()
    WHERE nom ILIKE '%tayna%' OR nom ILIKE '%RTCT%'
  `;
  console.log('RTCT Tayna : URL corrigee -> radiotayna.com, statut ACTIF');

  // Ajouter Radio Moto
  await sql`
    INSERT INTO media_local
      (nom, type_media, province_pcode, collectif, url, type_acces,
       fiabilite, notes_fiabilite, statut, langue, notes)
    VALUES
      ('Radio Moto', 'radio', 'CD61', NULL,
       'https://www.radiomoto.net', 'web',
       0.65,
       'Radio diocesaine de l''eveche de Butembo-Beni. 25 ans d''existence. Presence web verifiee.',
       'ACTIF', 'fr',
       'Zone Butembo-Beni (Nord-Kivu). Couverture Beni, Lubero.')
    ON CONFLICT DO NOTHING
  `;
  console.log('Radio Moto : ajoutee');

  // Ajouter presse nationale dans media_local (scope national = province NULL)
  await sql`
    INSERT INTO media_local
      (nom, type_media, province_pcode, collectif, url, type_acces,
       fiabilite, notes_fiabilite, statut, langue)
    VALUES
      ('Actualite.cd', 'web', NULL, NULL,
       'https://actualite.cd', 'web',
       0.80, 'Presse en ligne nationale tres suivie, equipe editoriale serieuse.',
       'ACTIF', 'fr'),

      ('7sur7.cd', 'web', NULL, NULL,
       'https://www.7sur7.cd', 'web',
       0.72, 'Populaire, couverture nationale. Verifier les sources des articles sensibles.',
       'ACTIF', 'fr'),

      ('Politico.cd', 'web', NULL, NULL,
       'https://www.politico.cd', 'web',
       0.70, 'Specialise politique. Utile pour tensions institutionnelles.',
       'ACTIF', 'fr'),

      ('Mediacongo', 'web', NULL, NULL,
       'https://www.mediacongo.net', 'web',
       0.72, 'Agregateur presse congolaise. Utile pour avoir une vue transversale.',
       'ACTIF', 'fr')

    ON CONFLICT DO NOTHING
  `;
  console.log('Presse nationale : 4 medias ajoutes');

  // Verification finale
  const total = await sql`SELECT COUNT(*)::int AS n FROM media_local`;
  const sources = await sql`SELECT COUNT(*)::int AS n FROM source_collecte WHERE actif = true`;
  console.log(`\nTotal media_local : ${total[0].n}`);
  console.log(`Total source_collecte actives : ${sources[0].n}`);

} catch(e) {
  console.error('Erreur:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
