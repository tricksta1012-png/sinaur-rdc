import postgres from 'postgres';
import { config } from './config.js';

export const sql = postgres(config.DATABASE_URL, {
  max: config.DATABASE_POOL_MAX,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: postgres.camel,
  onnotice: () => {},
});

export async function checkDatabaseConnection(): Promise<void> {
  await sql`SELECT 1`;
}

/**
 * Ping the DB every 4 minutes to prevent Neon compute from hibernating.
 * Neon hibernates after ~5 minutes of inactivity, causing a 1-2s cold-start
 * penalty on the next real query.
 */
export function startKeepalive(): void {
  setInterval(() => sql`SELECT 1`.catch(() => {}), 4 * 60 * 1000);
}
