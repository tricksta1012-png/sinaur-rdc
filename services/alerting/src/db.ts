import postgres from 'postgres'
import { config } from './config.js'

export const sql = postgres(config.databaseUrl, {
  transform: postgres.camel,
  max: 5,
  idle_timeout: 30,
})
