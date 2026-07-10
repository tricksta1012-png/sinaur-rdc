import postgres from 'postgres'
import { config } from './config.js'

export const sql = postgres(config.DATABASE_URL, {
  max: 3,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: postgres.camel,
  onnotice: () => {},
})

export async function checkConnection(): Promise<void> {
  await sql`SELECT 1`
}

export async function closeConnection(): Promise<void> {
  await sql.end()
}
