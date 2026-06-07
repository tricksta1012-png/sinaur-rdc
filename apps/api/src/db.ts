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
