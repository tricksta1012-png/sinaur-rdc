import { createHash } from 'node:crypto';
import { sql } from '../db.js';

interface DedupInput {
  hazardType: string;
  locationPcode: string;
  windowHours?: number;
}

export function buildDedupHash(input: DedupInput): string {
  const window = input.windowHours ?? 24;
  const slot = Math.floor(Date.now() / (window * 3_600_000));
  return createHash('sha256')
    .update(`${input.hazardType}:${input.locationPcode}:${slot}`)
    .digest('hex')
    .slice(0, 32);
}

export async function isDuplicate(hash: string): Promise<string | null> {
  const [row] = await sql`
    SELECT event_id FROM event_dedup_hashes
    WHERE hash = ${hash} AND expires_at > NOW()
  `;
  return row?.eventId ?? null;
}

export async function registerHash(hash: string, eventId: string, windowHours = 24): Promise<void> {
  const expiresAt = new Date(Date.now() + windowHours * 3_600_000);
  await sql`
    INSERT INTO event_dedup_hashes (hash, event_id, expires_at)
    VALUES (${hash}, ${eventId}, ${expiresAt})
    ON CONFLICT (hash) DO NOTHING
  `;
}

export async function enqueueModeration(eventId: string, priority = 5, reason?: string): Promise<void> {
  await sql`
    INSERT INTO moderation_queue (event_id, priority, reason)
    VALUES (${eventId}, ${priority}, ${reason ?? null})
    ON CONFLICT DO NOTHING
  `;
}
