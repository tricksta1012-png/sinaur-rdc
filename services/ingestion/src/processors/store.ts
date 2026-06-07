/**
 * Stocke les événements normalisés dans canonical_events
 * et les propage vers disaster_events si conditions remplies.
 */
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type { NormalizedEvent } from '../types.js';
import { logger } from '../logger.js';

const sql = postgres(process.env['DATABASE_URL']!, { max: 3, onnotice: () => {} });

export function buildHash(e: NormalizedEvent): string {
  const window = Math.floor(e.startDate.getTime() / (24 * 3_600_000));
  return createHash('sha256')
    .update(`${e.source}:${e.hazardType}:${e.locationPcode ?? 'COD'}:${e.sourceId}:${window}`)
    .digest('hex')
    .slice(0, 40);
}

export async function storeEvent(event: NormalizedEvent): Promise<'stored' | 'duplicate'> {
  const hash = buildHash(event);

  const [existing] = await sql`
    SELECT id FROM canonical_events WHERE deduplication_hash = ${hash}
  `;
  if (existing) return 'duplicate';

  const point = event.locationLat && event.locationLng
    ? sql`ST_SetSRID(ST_MakePoint(${event.locationLng}, ${event.locationLat}), 4326)`
    : sql`NULL`;

  await sql`
    INSERT INTO canonical_events (
      source_id, source, fetched_at, normalized_at, hazard_type,
      title, description, location_pcode, location_point,
      start_date, severity, confidence, glide_number, source_url,
      raw_payload, is_duplicate, deduplication_hash
    ) VALUES (
      ${event.sourceId},
      ${event.source}::event_source,
      ${event.fetchedAt},
      NOW(),
      ${event.hazardType}::hazard_type,
      ${event.title.slice(0, 200)},
      ${event.description.slice(0, 2000)},
      ${event.locationPcode},
      ${point},
      ${event.startDate},
      ${event.severity}::alert_severity,
      ${event.confidence}::confidence_level,
      ${event.glideNumber},
      ${event.sourceUrl},
      ${JSON.stringify(event.rawPayload)},
      FALSE,
      ${hash}
    )
  `;

  // Auto-créer un disaster_event si la source est officielle et la sévérité >= Moderate
  const HIGH_CONFIDENCE_SOURCES = new Set(['reliefweb', 'fews_net', 'ocha_hdx']);
  const HIGH_SEVERITY = new Set(['Moderate', 'Severe', 'Extreme']);

  if (HIGH_CONFIDENCE_SOURCES.has(event.source) && HIGH_SEVERITY.has(event.severity)) {
    await sql`
      INSERT INTO disaster_events (
        title, description, hazard_type, status, severity, confidence,
        source, location_pcode, location_name, location_level, location_accuracy,
        location_point, start_date, sync_status, tags
      ) VALUES (
        ${event.title.slice(0, 200)},
        ${event.description.slice(0, 2000)},
        ${event.hazardType}::hazard_type,
        'under_review',
        ${event.severity}::alert_severity,
        ${event.confidence}::confidence_level,
        ${event.source}::event_source,
        ${event.locationPcode ?? 'COD'},
        ${event.title.slice(0, 200)},
        0,
        'pcode',
        ${event.locationLat && event.locationLng
          ? sql`ST_SetSRID(ST_MakePoint(${event.locationLng}, ${event.locationLat}), 4326)`
          : sql`NULL`},
        ${event.startDate},
        'synced',
        ARRAY[${event.source}, ${event.hazardType}, 'auto-ingested']
      )
      ON CONFLICT DO NOTHING
    `.catch((err: unknown) => logger.warn({ err }, 'Could not auto-create disaster_event'));
  }

  return 'stored';
}

export async function closeSql(): Promise<void> {
  await sql.end();
}
