/**
 * Service d'alerting SINAUR-RDC — point d'entrée.
 * Démarre le scheduler + un mini-serveur HTTP pour les appels inter-services.
 */
import cron from 'node-cron'
import http from 'http'
import { logger } from './logger.js'
import { runAlertingCycle } from './engine.js'
import { dispatchValidatedAlert } from './engine.js'
import { processSmsQueue } from './channels/sms.js'
import { sql } from './db.js'

const ALERT_CYCLE_CRON = '0 * * * *'    // Toutes les heures
const SMS_QUEUE_CRON   = '*/5 * * * *'  // Toutes les 5 minutes

async function main() {
  logger.info('SINAUR-RDC Alerting Service starting')

  // Premier cycle immédiat au démarrage
  try {
    await runAlertingCycle()
  } catch (e) {
    logger.warn({ err: e }, 'Initial alerting cycle failed (non-fatal)')
  }

  // Cycle d'alerting : toutes les heures
  cron.schedule(ALERT_CYCLE_CRON, async () => {
    try {
      await runAlertingCycle()
    } catch (e) {
      logger.error({ err: e }, 'Alerting cycle error')
    }
  })

  // Traitement SMS : toutes les 5 minutes
  cron.schedule(SMS_QUEUE_CRON, async () => {
    try {
      await processSmsQueue()
    } catch (e) {
      logger.error({ err: e }, 'SMS queue processing error')
    }
  })

  // Mini-serveur HTTP pour les appels inter-services (dispatch alertes validées)
  const server = http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/dispatch\/([0-9a-f-]{36})$/)
    if (req.method === 'POST' && match) {
      const alertId = match[1]
      try {
        await dispatchValidatedAlert(alertId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, alertId }))
      } catch (e: any) {
        logger.error({ err: e, alertId }, 'Dispatch failed')
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'alerting' }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.listen(3001, () => {
    logger.info('Alerting HTTP server listening on :3001')
  })

  logger.info({
    alertCron: ALERT_CYCLE_CRON,
    smsCron: SMS_QUEUE_CRON,
  }, 'Alerting service started — schedulers active')
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down alerting service')
  await sql.end()
  process.exit(0)
}


process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main().catch(e => {
  logger.fatal({ err: e }, 'Fatal error in alerting service')
  process.exit(1)
})
