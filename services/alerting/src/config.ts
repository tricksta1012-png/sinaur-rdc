import { readFileSync } from 'fs'

function require_env(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional_env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback
}

export const config = {
  databaseUrl: require_env('DATABASE_URL'),
  apiBaseUrl: optional_env('API_BASE_URL', 'http://api:3000'),
  aiBaseUrl: optional_env('AI_BASE_URL', 'http://ai-prediction:8000'),

  // Firebase Admin SDK
  firebaseProjectId: optional_env('FIREBASE_PROJECT_ID', 'sinaur-rdc'),
  firebaseServiceAccountPath: optional_env('FIREBASE_SERVICE_ACCOUNT_PATH', ''),

  // SMS gateway (configurable)
  smsGatewayUrl: optional_env('SMS_GATEWAY_URL', ''),
  smsGatewayApiKey: optional_env('SMS_GATEWAY_API_KEY', ''),

  // Seuil de score AI déclenchant une alerte automatique (hors critical = validation humaine)
  autoAlertScoreThreshold: parseInt(optional_env('AUTO_ALERT_SCORE_THRESHOLD', '75')),

  logLevel: optional_env('LOG_LEVEL', 'info'),
}
