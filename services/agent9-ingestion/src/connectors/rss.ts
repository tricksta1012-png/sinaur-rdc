import axios from 'axios'
import { logger } from '../logger.js'

// Sources RSS publiques — couverture DRC, accès sans clé
export const RSS_SOURCES = [
  {
    url:         'https://www.radiookapi.net/feed',
    name:        'Radio Okapi',
    type:        'media' as const,
    reliability: 0.80,
    drcFilter:   false, // déjà 100% RDC
  },
  {
    url:         'https://reliefweb.int/updates/rss.xml?taxonomy-country=204',
    name:        'ReliefWeb DRC',
    type:        'ong' as const,
    reliability: 0.85,
    drcFilter:   false, // filtré par pays = DRC
  },
  {
    url:         'https://www.rfi.fr/fr/rss/afriques',
    name:        'RFI Afrique',
    type:        'media' as const,
    reliability: 0.75,
    drcFilter:   true,  // filtrer les articles mentionnant la RDC
  },
] as const

const DRC_FILTER_WORDS = ['congo', 'rdc', 'kinshasa', 'kivu', 'ituri', 'kasai', 'maniema']

export interface RssItem {
  title:             string
  link:              string
  fullText:          string
  pubDate:           Date
  sourceName:        string
  sourceType:        'media' | 'ong' | 'officiel'
  sourceReliability: number
}

// ── Parseur XML minimal — gère CDATA, entités courantes, tags imbriqués ────────

function extractTag(xml: string, tag: string): string {
  // Ordre de priorité : CDATA > texte brut
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i').exec(xml)
  if (cdata) return cdata[1]!.trim()
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml)
  return plain ? plain[1]!.replace(/<[^>]+>/g, ' ').trim() : ''
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseItems(xml: string, src: typeof RSS_SOURCES[number]): RssItem[] {
  const items: RssItem[] = []
  const ITEM_RE = /<item[^>]*>([\s\S]*?)<\/item>/g
  const cutoff  = Date.now() - 72 * 3_600_000 // 72h de rétrolecture

  let m: RegExpExecArray | null
  while ((m = ITEM_RE.exec(xml)) !== null) {
    const block = m[1]!
    const title = decodeEntities(extractTag(block, 'title'))
    const link  = decodeEntities(extractTag(block, 'link') || extractTag(block, 'guid'))
    const desc  = decodeEntities(extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content:encoded'))
    const raw   = decodeEntities(extractTag(block, 'pubDate') || extractTag(block, 'dc:date') || extractTag(block, 'updated'))

    if (!title || !link) continue

    const pubDate = raw ? new Date(raw) : new Date()
    if (isNaN(pubDate.getTime()) || pubDate.getTime() < cutoff) continue

    // Filtre DRC pour RFI
    const fullText = (title + ' ' + desc).toLowerCase()
    if (src.drcFilter && !DRC_FILTER_WORDS.some(w => fullText.includes(w))) continue

    items.push({
      title,
      link,
      fullText: (title + '. ' + desc).slice(0, 800),
      pubDate,
      sourceName:        src.name,
      sourceType:        src.type,
      sourceReliability: src.reliability,
    })
  }

  return items
}

export async function fetchRssFeeds(): Promise<RssItem[]> {
  const all: RssItem[] = []

  for (const src of RSS_SOURCES) {
    try {
      const res = await axios.get<string>(src.url, {
        timeout:      20_000,
        responseType: 'text',
        headers: {
          'User-Agent': 'SINAUR-RDC/1.0 (humanitarian-protection-system)',
          'Accept':     'application/rss+xml, application/xml, text/xml, */*',
        },
      })
      const items = parseItems(res.data, src)
      logger.info({ source: src.name, count: items.length }, 'RSS récupéré')
      all.push(...items)
    } catch (err) {
      logger.warn({ err, source: src.name }, 'Erreur RSS — source ignorée')
    }
  }

  return all
}
