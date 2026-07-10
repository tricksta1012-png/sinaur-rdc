import http from 'node:http'
import { logger } from './logger.js'
import { checkConnection, closeConnection } from './db.js'
import { startScheduler, runCycle } from './scheduler.js'

const VERSION = '0.1.0'

async function main(): Promise<void> {
  logger.info({ version: VERSION }, 'SINAUR-RDC Agent 9 — Ingestion démarrage')

  await checkConnection()
  logger.info('Connexion base de données OK')

  // Mode one-shot (test / CI)
  if (process.argv.includes('--once')) {
    logger.info('Mode one-shot activé')
    await runCycle()
    await closeConnection()
    process.exit(0)
  }

  startScheduler()

  // Mini serveur HTTP pour Railway healthcheck
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'agent9-ingestion', version: VERSION }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.listen(3005, () => {
    logger.info('Health endpoint sur :3005/health')
  })
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Arrêt agent9-ingestion')
  await closeConnection()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT',  () => void shutdown('SIGINT'))

main().catch(err => {
  logger.fatal({ err }, 'Erreur fatale agent9-ingestion')
  process.exit(1)
})
