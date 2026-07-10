import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL:           z.string().url(),
  LOG_LEVEL:              z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Clé ACLED — optionnelle (https://acleddata.com/register/)
  // Sans clé : UCDP est utilisé comme source principale
  ACLED_API_KEY:          z.string().default(''),
  ACLED_EMAIL:            z.string().default(''),
  // Zone géographique ACLED (nom admin1, ex: "North Kivu"). Vide = toute la RDC.
  ACLED_PILOT_PROVINCE:   z.string().default(''),
  // Fenêtre de récupération en heures à chaque cycle (chevauchement intentionnel)
  ACLED_LOOKBACK_HOURS:   z.coerce.number().default(48),
  // Intervalle du cron en heures
  INGESTION_INTERVAL_HOURS: z.coerce.number().default(6),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variables d\'environnement manquantes pour agent9-ingestion:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
