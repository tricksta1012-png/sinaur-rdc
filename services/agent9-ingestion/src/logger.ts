import pino from 'pino'
import { config } from './config.js'

export const logger = config.NODE_ENV === 'development'
  ? pino({
      level: config.LOG_LEVEL,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
      base: { service: 'agent9-ingestion' },
    })
  : pino({
      level: config.LOG_LEVEL,
      base: { service: 'agent9-ingestion' },
    })
