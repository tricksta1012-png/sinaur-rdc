import { sql }    from './db.js'
import { logger } from './logger.js'
import { fetchRssFeeds, type RssItem } from './connectors/rss.js'

// ── Classification par mots-clés ──────────────────────────────────────────────
// Hiérarchisée : le premier type avec le plus de correspondances l'emporte.

const PATTERNS: Record<string, string[]> = {
  TENSION_MONTANTE: [
    'attaque', 'attaqué', 'attaquée', 'affrontement', 'combat', 'combats',
    'tirs', 'coup de feu', 'coups de feu', 'fusillade', 'accrochage',
    'milice', 'groupe armé', 'rebelle', 'rebelles', 'incursion',
    'offensive', 'raid', 'massacre', 'tué', 'tuée', 'mort', 'blessé',
    'pillage', 'brûlé', 'incendie', 'destruction',
    'enlèvement', 'enlevé', 'kidnappé', 'otage',
    'M23', 'ADF', 'FDLR', 'Maï-Maï',
  ],
  MOUVEMENT_POPULATION: [
    'déplacé', 'déplacée', 'déplacement', 'déplacés internes',
    'fuite', 'fuit', 'fuient', 'exode',
    'réfugié', 'retour', 'retournés',
    'camp de déplacés', 'site de déplacés', 'IDP',
    'accès humanitaire', 'aide humanitaire', 'population civile',
    'évacuation', 'évacué',
  ],
  DECLARATION_HOSTILE: [
    'déclaration', 'communiqué', 'porte-parole',
    'menace', 'ultimatum', 'revendique', 'revendication',
    'annonce', 'alerte', 'avertissement', 'dénonce',
  ],
  APPEL_AU_CALME: [
    'cessez-le-feu', 'cessez le feu', 'paix', 'dialogue',
    'négociation', 'accord de paix', 'pourparlers',
    'réconciliation', 'médiation', 'calme', 'stabilisation',
    'désarmement', 'DDR',
  ],
  NEUTRE: [
    'élection', 'vote', 'économie', 'développement',
    'infrastructure', 'route', 'hôpital', 'école',
    'réunion', 'rencontre', 'visite officielle', 'conférence',
    'budget', 'investissement',
  ],
}

type SignalType = 'TENSION_MONTANTE' | 'MOUVEMENT_POPULATION' | 'APPEL_AU_CALME' | 'DECLARATION_HOSTILE' | 'NEUTRE' | 'HORS_SUJET'

function classifySignal(text: string): { signalType: SignalType; matchCount: number } {
  const lower = text.toLowerCase()
  const scores = Object.entries(PATTERNS).map(([type, keywords]) => ({
    type,
    count: keywords.filter(k => lower.includes(k)).length,
  }))

  const best = scores.reduce((a, b) => a.count >= b.count ? a : b)
  if (best.count === 0) return { signalType: 'HORS_SUJET', matchCount: 0 }
  return { signalType: best.type as SignalType, matchCount: best.count }
}

function computeConfidence(matchCount: number, sourceReliability: number): number {
  let base: number
  if (matchCount >= 4)      base = 0.75
  else if (matchCount >= 2) base = 0.65
  else                      base = 0.55
  // Bonus source (Radio Okapi 0.80, ReliefWeb 0.85 → confiance légèrement supérieure)
  return parseFloat(Math.min(0.95, base + (sourceReliability - 0.75) * 0.2).toFixed(2))
}

// ── Détection de territoires mentionnés ──────────────────────────────────────
// Charge les noms admin2 depuis la DB pour un matching exact (sans IA).

interface Territory { pcode: string; name: string }

function detectPcodes(text: string, territories: Territory[]): string[] {
  const lower = text.toLowerCase()
  return territories
    .filter(t => {
      const name = t.name.toLowerCase()
      // Matching sur nom complet ou préfixe de 5+ caractères pour éviter les faux positifs
      return lower.includes(name) || (name.length >= 5 && lower.includes(name.slice(0, name.length - 1)))
    })
    .map(t => t.pcode)
}

// ── Cycle principal ───────────────────────────────────────────────────────────

export async function runSignalsCycle(): Promise<{ fetched: number; inserted: number }> {
  logger.info('Cycle de signaux publics démarré (RSS → NLP heuristique)')

  // 1. Charger les noms des territoires (admin2) pour la détection
  const territories = await sql<Territory[]>`
    SELECT pcode, name FROM admin_divisions WHERE level = 2
  `
  if (territories.length === 0) {
    logger.warn('Aucun territoire chargé — vérifier admin_divisions')
    return { fetched: 0, inserted: 0 }
  }

  // 2. Récupérer les flux RSS
  const items = await fetchRssFeeds()
  if (items.length === 0) {
    logger.info('Aucun article RSS récupéré')
    return { fetched: 0, inserted: 0 }
  }

  // 3. Classifier et insérer
  let inserted = 0

  for (const item of items) {
    try {
      // Déduplification : ignorer si source_url déjà connue
      const [exists] = await sql`
        SELECT id FROM public_signals WHERE source_url = ${item.link} LIMIT 1
      `
      if (exists) continue

      const { signalType, matchCount } = classifySignal(item.fullText)
      // On ne stocke que les signaux pertinents (pas HORS_SUJET)
      if (signalType === 'HORS_SUJET') continue

      const pcodes = detectPcodes(item.fullText, territories)
      // Signal sans territoire identifié = trop vague pour alimenter le scoring
      if (pcodes.length === 0) continue

      const confidence = computeConfidence(matchCount, item.sourceReliability)

      await sql`
        INSERT INTO public_signals (
          source_type, source_name, source_url, published_at,
          pcodes_mentioned, signal_type, confidence,
          extract_text, source_reliability, model_version
        ) VALUES (
          ${item.sourceType}, ${item.sourceName}, ${item.link}, ${item.pubDate},
          ${pcodes}, ${signalType}, ${confidence},
          ${item.fullText.slice(0, 500)}, ${item.sourceReliability}, 'keyword-v1.0'
        )
      `
      inserted++
    } catch (err) {
      logger.warn({ err, link: item.link }, 'Erreur insertion signal — ignoré')
    }
  }

  logger.info({ fetched: items.length, inserted }, 'Cycle de signaux terminé')
  return { fetched: items.length, inserted }
}
