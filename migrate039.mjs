/**
 * Seed 039 — Base de Connaissance : données structurelles RDC
 * Peuple kb_entite / kb_relation / kb_apprentissage avec les acteurs
 * connus (groupes armés, épidémies, lieux) pour amorcer la projection IA.
 *
 * Sources : ONU (rapport du groupe d'experts), ACLED, HRW, OMS/WHO-RDC.
 */
import postgres from 'postgres';

const sql = postgres('postgresql://neondb_owner:npg_tfY0qJhRsx2M@ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech/neondb?sslmode=require');

async function upsertEntite({ type_entite, nom, noms_alternatifs = [], description, niveau_confiance, statut_connaissance, nb_mentions, pcode = null, attributs = {} }) {
  const existing = await sql`SELECT id FROM kb_entite WHERE nom ILIKE ${nom} AND type_entite = ${type_entite} LIMIT 1`;
  if (existing.length > 0) {
    console.log(`  skip  ${nom}`);
    return existing[0].id;
  }
  const [row] = await sql`
    INSERT INTO kb_entite
      (type_entite, nom, noms_alternatifs, description,
       niveau_confiance, statut_connaissance, nb_mentions,
       pcode, attributs, sources)
    VALUES (
      ${type_entite}, ${nom}, ${noms_alternatifs}, ${description},
      ${niveau_confiance}, ${statut_connaissance}, ${nb_mentions},
      ${pcode}, ${JSON.stringify(attributs)}, '["seed-039-rdc"]'::jsonb
    ) RETURNING id
  `;
  console.log(`  +     ${nom} (${type_entite})`);
  return row.id;
}

async function upsertRelation(sourceId, cibleId, type_relation, niveau_confiance) {
  await sql`
    INSERT INTO kb_relation (source_id, cible_id, type_relation, niveau_confiance, actif)
    VALUES (${sourceId}, ${cibleId}, ${type_relation}, ${niveau_confiance}, true)
    ON CONFLICT (source_id, cible_id, type_relation) DO NOTHING
  `;
}

async function addJournal(entiteId, type_action, detail, confiance) {
  await sql`
    INSERT INTO kb_apprentissage
      (entite_id, type_action, detail, source, agent, confiance_apres)
    VALUES
      (${entiteId}, ${type_action}, ${detail}, 'seed-039-rdc', 'migration', ${confiance})
  `;
}

try {
  console.log('\n── Groupes armés ──────────────────────────────────────');

  const m23 = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'M23/AFC',
    noms_alternatifs: ['M23', 'Alliance Fleuve Congo', 'AFC', 'Mouvement du 23 Mars'],
    description: 'Groupe armé actif dans l\'Est-RDC (Nord-Kivu). Bénéficierait d\'un soutien rwandais documenté par le groupe d\'experts de l\'ONU. Contrôle de portions du territoire entre Rutshuru et Masisi.',
    niveau_confiance: 0.92, statut_connaissance: 'ETABLI', nb_mentions: 180,
    pcode: 'CD61',
    attributs: { soutien_exterieur: 'Rwanda (confirmé ONU 2024)', effectif_estime: '4000-6000', zone_operation: 'Rutshuru, Masisi, Goma' }
  });
  await addJournal(m23, 'DECOUVERTE', 'Entité fondatrice — groupe armé majeur Est-RDC, bien documenté ONU/ACLED', 0.92);
  await addJournal(m23, 'ENRICHISSEMENT', 'Prise de Goma janvier 2024 documentée par ONU et médias internationaux', 0.93);
  await addJournal(m23, 'ENRICHISSEMENT', 'Rapport ONU S/2024/342 confirme soutien logistique extérieur', 0.92);

  const fdlr = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'FDLR',
    noms_alternatifs: ['Forces Démocratiques de Libération du Rwanda', 'FOCA'],
    description: 'Groupe armé d\'origine rwandaise implanté en RDC depuis 1994. Opère principalement au Sud-Kivu et North-Kivu. Impliqué dans des violences contre les civils.',
    niveau_confiance: 0.88, statut_connaissance: 'ETABLI', nb_mentions: 95,
    pcode: 'CD62',
    attributs: { origine: 'Génocidaires rwandais 1994', effectif_estime: '2000-3000', zone_operation: 'Kalehe, Shabunda, Uvira' }
  });
  await addJournal(fdlr, 'DECOUVERTE', 'Entité fondatrice — groupe armé rwandais historique, documenté depuis 1996', 0.88);
  await addJournal(fdlr, 'ENRICHISSEMENT', 'Réseau de financement par trafic de minerais (or, coltan) confirmé OCDE 2023', 0.87);

  const adf = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'ADF',
    noms_alternatifs: ['Allied Democratic Forces', 'Forces Démocratiques Alliées', 'ISCAP-DRC'],
    description: 'Groupe armé ougandais établi en RDC depuis 1996. Lié à l\'État islamique (ISCAP) depuis 2019. Opère principalement dans le territoire de Beni (Nord-Kivu) et le nord de l\'Ituri.',
    niveau_confiance: 0.88, statut_connaissance: 'ETABLI', nb_mentions: 112,
    pcode: 'CD61',
    attributs: { affiliation: 'ISCAP (Islamic State Central Africa Province)', effectif_estime: '1500-2000', zone_operation: 'Beni, Irumu, Mambasa' }
  });
  await addJournal(adf, 'DECOUVERTE', 'Entité fondatrice — groupe armé ougandais, lien ISCAP documenté INTERPOL/ONU 2020', 0.88);
  await addJournal(adf, 'ENRICHISSEMENT', 'Expansion vers Ituri documentée 2022-2024, attaques à Mambasa et Irumu', 0.87);

  const codeco = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'CODECO',
    noms_alternatifs: ['Coopérative pour le Développement du Congo', 'FPIC'],
    description: 'Milice de la communauté Lendu en Ituri. Responsable de nombreux massacres documentés contre les communautés Hema. Condamné par la CPI.',
    niveau_confiance: 0.80, statut_connaissance: 'ETABLI', nb_mentions: 68,
    pcode: 'CD33',
    attributs: { communaute: 'Lendu', zone_operation: 'Djugu, Irumu', mandats_cpi: true }
  });
  await addJournal(codeco, 'DECOUVERTE', 'Entité fondatrice — milice Ituri documentée HRW/MONUSCO', 0.80);

  const ndcr = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'NDC-R',
    noms_alternatifs: ['Nduma Defence of Congo-Rénové', 'NDC Rénové'],
    description: 'Groupe armé dans le territoire de Masisi (Nord-Kivu). Relations ambiguës avec le M23/AFC — partiellement intégré ou concurrent selon les rapports.',
    niveau_confiance: 0.72, statut_connaissance: 'ETABLI', nb_mentions: 42,
    pcode: 'CD61',
    attributs: { zone_operation: 'Masisi, Walikale' }
  });
  await addJournal(ndcr, 'DECOUVERTE', 'Entité documentée rapports MONUSCO 2021-2024', 0.72);

  const raia = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'Raïa Mutomboki',
    noms_alternatifs: ['Raia Mutomboki', 'RM'],
    description: 'Nébuleuse de milices d\'autodéfense anti-FDLR en Sud-Kivu et Maniema. Structure fragmentée, plusieurs factions indépendantes.',
    niveau_confiance: 0.68, statut_connaissance: 'A_CONFIRMER', nb_mentions: 35,
    pcode: 'CD62',
    attributs: { structure: 'fragmentée (multiples factions)', zone_operation: 'Shabunda, Punia, Fizi' }
  });
  await addJournal(raia, 'DECOUVERTE', 'Entité fragmentée — documentation partielle ACLED/IPIS', 0.68);

  const yakutumba = await upsertEntite({
    type_entite: 'GROUPE_ARME', nom: 'Maï-Maï Yakutumba',
    noms_alternatifs: ['Yakutumba', 'FRF'],
    description: 'Groupe d\'autodéfense Bembe au Sud-Kivu (Uvira/Fizi). A signé des accords de paix mais maintient une présence armée.',
    niveau_confiance: 0.70, statut_connaissance: 'ETABLI', nb_mentions: 38,
    pcode: 'CD62',
    attributs: { communaute: 'Bembe', zone_operation: 'Uvira, Fizi, Baraka' }
  });
  await addJournal(yakutumba, 'DECOUVERTE', 'Entité documentée accords de paix STAREC + ACLED', 0.70);

  console.log('\n── Épidémies ──────────────────────────────────────────');

  const ebola = await upsertEntite({
    type_entite: 'EPIDEMIE', nom: 'Maladie à Virus Ebola (MVE)',
    noms_alternatifs: ['Ebola', 'EVD', 'Fièvre hémorragique Ebola'],
    description: 'Épidémie récurrente en RDC. 10ème épidémie (2018-2020, Nord-Kivu/Ituri) la plus meurtrière : 2287 décès. Vaccin rVSV-ZEBOV disponible. Risque de résurgence élevé en zone de conflit.',
    niveau_confiance: 0.92, statut_connaissance: 'ETABLI', nb_mentions: 155,
    pcode: 'CD61',
    attributs: { taux_letalite: '40-90% sans traitement', vaccin: 'rVSV-ZEBOV (Ervebo)', nb_epidemies_rdc: 14, derniere_epidemie: '2022 (Nord-Kivu)' }
  });
  await addJournal(ebola, 'DECOUVERTE', 'Entité fondatrice — 14 épidémies documentées en RDC depuis 1976', 0.92);
  await addJournal(ebola, 'ENRICHISSEMENT', '10ème épidémie 2018-2020 : 2287 décès, contexte conflit armé majeur', 0.93);
  await addJournal(ebola, 'ENRICHISSEMENT', 'Risque de résurgence identifié par OMS dans zones ADF/M23 (accès humanitaire limité)', 0.90);

  const mpox = await upsertEntite({
    type_entite: 'EPIDEMIE', nom: 'Mpox (variole du singe)',
    noms_alternatifs: ['Monkeypox', 'Clade Ib', 'MPXV'],
    description: 'Maladie endémique en RDC, nouveau clade Ib émergent depuis 2023 au Sud-Kivu, plus transmissible sexuellement. Déclarée urgence de santé publique internationale par OMS en août 2024.',
    niveau_confiance: 0.90, statut_connaissance: 'ETABLI', nb_mentions: 128,
    pcode: 'CD62',
    attributs: { clade_emergent: 'Ib (Kivu)', urgence_oms: 'USPPI août 2024', transmission: 'contact cutané, sexuelle (clade Ib)', vaccin: 'MVA-BN (Imvanex) en cours déploiement' }
  });
  await addJournal(mpox, 'DECOUVERTE', 'Entité fondatrice — endémique RDC, clade Ib émergent Sud-Kivu 2023', 0.90);
  await addJournal(mpox, 'ENRICHISSEMENT', 'OMS déclare USPPI août 2024 — nouveau clade plus transmissible', 0.92);
  await addJournal(mpox, 'ENRICHISSEMENT', 'Propagation documentée dans camps déplacés (lien conflit/épidémie)', 0.88);

  const cholera = await upsertEntite({
    type_entite: 'EPIDEMIE', nom: 'Choléra',
    noms_alternatifs: ['Vibrio cholerae', 'Diarrhée aqueuse aiguë'],
    description: 'Épidémie endémique en RDC. Concentrée autour du lac Kivu et le long du fleuve Congo. Saisonnière (pic saison des pluies). Liée au manque d\'accès à l\'eau potable dans les zones de conflit.',
    niveau_confiance: 0.90, statut_connaissance: 'ETABLI', nb_mentions: 145,
    pcode: 'CD61',
    attributs: { saisonnalite: 'pic mars-juin, oct-dec', zone_risque_principale: 'Lac Kivu, fleuve Congo', vaccin: 'OCV oral disponible (stockage GAVI)' }
  });
  await addJournal(cholera, 'DECOUVERTE', 'Entité fondatrice — endémique depuis 1970, lié accès eau/assainissement', 0.90);
  await addJournal(cholera, 'ENRICHISSEMENT', 'Corrélation déplacements M23 → flambées choléra Goma 2023/2024 documentée OMS', 0.89);

  const rougeole = await upsertEntite({
    type_entite: 'EPIDEMIE', nom: 'Rougeole',
    noms_alternatifs: ['Measles', 'Morbillivirus'],
    description: 'Épidémie récurrente, plus grande épidémie mondiale 2019-2020 en RDC (310 000 cas, 6000 décès). Liée à la couverture vaccinale insuffisante et les déplacements de populations.',
    niveau_confiance: 0.85, statut_connaissance: 'ETABLI', nb_mentions: 88,
    attributs: { plus_grande_epidemie: '2019-2020 (310 000 cas)', couverture_vaccinale_rdc: '<70% dans zones conflit', vaccin: 'ROR disponible (campagnes UNICEF)' }
  });
  await addJournal(rougeole, 'DECOUVERTE', 'Entité fondatrice — plus grande épidémie mondiale rougeole 2019-2020 en RDC', 0.85);

  console.log('\n── Zones géographiques ────────────────────────────────');

  const nordkivu = await upsertEntite({
    type_entite: 'LIEU', nom: 'Nord-Kivu',
    noms_alternatifs: ['North Kivu', 'Province du Nord-Kivu'],
    description: 'Province la plus touchée par les conflits armés en RDC. Présence simultanée de M23/AFC, ADF, NDC-R. Centre de la 10ème épidémie Ebola. 2.3 millions de déplacés internes (2024).',
    niveau_confiance: 0.95, statut_connaissance: 'ETABLI', nb_mentions: 220,
    pcode: 'CD61',
    attributs: { idps_2024: '2300000', nb_groupes_armes: '20+', capitale: 'Goma' }
  });
  await addJournal(nordkivu, 'DECOUVERTE', 'Zone prioritaire — épicentre crise Est-RDC', 0.95);
  await addJournal(nordkivu, 'ENRICHISSEMENT', 'Prise de Goma par M23/AFC janvier 2024, aggravation crise humanitaire', 0.95);

  const sudkivu = await upsertEntite({
    type_entite: 'LIEU', nom: 'Sud-Kivu',
    noms_alternatifs: ['South Kivu', 'Province du Sud-Kivu'],
    description: 'Province confrontée à FDLR, Raïa Mutomboki, Yakutumba. Épicentre du clade Ib Mpox. Lac Kivu = principal foyer choléra. 1.1 million de déplacés internes.',
    niveau_confiance: 0.92, statut_connaissance: 'ETABLI', nb_mentions: 145,
    pcode: 'CD62',
    attributs: { idps_2024: '1100000', capitale: 'Bukavu', lac: 'Lac Kivu (risque choléra/mpox)' }
  });
  await addJournal(sudkivu, 'DECOUVERTE', 'Zone prioritaire — conflits FDLR/milices + Mpox clade Ib', 0.92);

  const ituri = await upsertEntite({
    type_entite: 'LIEU', nom: 'Ituri',
    noms_alternatifs: ['Province de l\'Ituri', 'District de l\'Ituri'],
    description: 'Province marquée par les violences intercommunautaires (CODECO Lendu/Hema) et la présence ADF. 11ème et 14ème épidémies Ebola s\'y sont propagées.',
    niveau_confiance: 0.90, statut_connaissance: 'ETABLI', nb_mentions: 98,
    pcode: 'CD33',
    attributs: { idps_2024: '620000', capitale: 'Bunia', conflits: 'intercommunautaire Lendu/Hema + ADF' }
  });
  await addJournal(ituri, 'DECOUVERTE', 'Zone prioritaire — violences CODECO + ADF + résurgences Ebola', 0.90);

  const tanganyika = await upsertEntite({
    type_entite: 'LIEU', nom: 'Tanganyika',
    noms_alternatifs: ['Province du Tanganyika'],
    description: 'Province confrontée à des conflits intercommunautaires (Twa/Luba) et sous-couverte médiatiquement. Lac Tanganyika = axe de contamination choléra.',
    niveau_confiance: 0.78, statut_connaissance: 'ETABLI', nb_mentions: 55,
    pcode: 'CD73',
    attributs: { capitale: 'Kalemie', lac: 'Lac Tanganyika', conflits: 'Twa/Luba intercommunautaire' }
  });
  await addJournal(tanganyika, 'DECOUVERTE', 'Zone secondaire — conflits sous-documentés, axe choléra lac Tanganyika', 0.78);

  console.log('\n── Relations ───────────────────────────────────────────');

  // Groupes → zones d'opération
  await upsertRelation(m23, nordkivu, 'OPERE_DANS', 0.95);
  await upsertRelation(adf, nordkivu, 'OPERE_DANS', 0.88);
  await upsertRelation(adf, ituri, 'OPERE_DANS', 0.75);
  await upsertRelation(fdlr, sudkivu, 'OPERE_DANS', 0.90);
  await upsertRelation(codeco, ituri, 'OPERE_DANS', 0.88);
  await upsertRelation(ndcr, nordkivu, 'OPERE_DANS', 0.75);
  await upsertRelation(raia, sudkivu, 'OPERE_DANS', 0.70);
  await upsertRelation(yakutumba, sudkivu, 'OPERE_DANS', 0.75);

  // Épidémies → zones d'impact
  await upsertRelation(ebola, nordkivu, 'IMPLIQUE_DANS', 0.92);
  await upsertRelation(ebola, ituri, 'IMPLIQUE_DANS', 0.82);
  await upsertRelation(mpox, sudkivu, 'IMPLIQUE_DANS', 0.88);
  await upsertRelation(mpox, nordkivu, 'IMPLIQUE_DANS', 0.75);
  await upsertRelation(cholera, nordkivu, 'IMPLIQUE_DANS', 0.90);
  await upsertRelation(cholera, sudkivu, 'IMPLIQUE_DANS', 0.88);
  await upsertRelation(cholera, tanganyika, 'IMPLIQUE_DANS', 0.72);

  // Rivalités / confrontations
  await upsertRelation(m23, fdlr, 'RIVAL_DE', 0.82);
  await upsertRelation(m23, adf, 'AFFRONTE', 0.65);
  await upsertRelation(m23, ndcr, 'LIE_A', 0.55);
  await upsertRelation(fdlr, raia, 'RIVAL_DE', 0.72);

  // Journal des relations
  await addJournal(m23, 'RELATION', 'Relation OPERE_DANS Nord-Kivu confirmée (contrôle territorial Rutshuru/Goma)', 0.95);
  await addJournal(adf, 'RELATION', 'Relation OPERE_DANS Ituri documentée (expansion 2022-2024)', 0.75);
  await addJournal(fdlr, 'RELATION', 'Relation RIVAL_DE M23/AFC documentée (combats Masisi 2023)', 0.82);
  await addJournal(ebola, 'RELATION', 'Ebola IMPLIQUE_DANS Ituri (14ème épidémie 2022)', 0.82);
  await addJournal(cholera, 'RELATION', 'Choléra lié aux déplacements M23 — corrélation OCHA 2024', 0.88);

  // Vérification finale
  const [entCount] = await sql`SELECT COUNT(*)::int AS n FROM kb_entite WHERE actif = true`;
  const [relCount] = await sql`SELECT COUNT(*)::int AS n FROM kb_relation WHERE actif = true`;
  const [logCount] = await sql`SELECT COUNT(*)::int AS n FROM kb_apprentissage`;
  console.log(`\nTotal kb_entite actives : ${entCount.n}`);
  console.log(`Total kb_relation actives : ${relCount.n}`);
  console.log(`Total kb_apprentissage : ${logCount.n}`);

} catch(e) {
  console.error('Erreur:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
