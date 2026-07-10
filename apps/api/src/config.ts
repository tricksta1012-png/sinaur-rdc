import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT:     z.coerce.number().optional(),
  API_PORT: z.coerce.number().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AI_SERVICE_URL: z.string().default('http://localhost:8001'),
  AI_INTERNAL_API_KEY: z.string().default('dev-internal-key'),
  SMS_GATEWAY_URL: z.string().optional(),
  SMS_GATEWAY_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().default('SINAUR'),
  FIREBASE_PROJECT_ID: z.string().default('sinaur-rdc'),
  RELIEFWEB_API_URL: z.string().url().default('https://api.reliefweb.int/v1'),
  RELIEFWEB_APP_NAME: z.string().default('sinaur-rdc'),
  DTM_API_KEY: z.string().optional(),
  BOOTSTRAP_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables d\'environnement manquantes ou invalides:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
