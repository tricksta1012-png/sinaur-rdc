import cron from 'node-cron';
import { logger } from './logger.js';
import { ReliefWebConnector } from './connectors/reliefweb.js';
import { OpenMeteoConnector } from './connectors/open-meteo.js';
import { FewsNetConnector } from './connectors/fews-net.js';
import { fetchGdacsAlerts } from './connectors/gdacs.js';
import { storeEvent, closeSql } from './processors/store.js';
import type { Connector, ConnectorResult, NormalizedEvent } from './types.js';

const CONNECTORS: Connector[] = [
  new ReliefWebConnector(),
  new OpenMeteoConnector(),
  new FewsNetConnector(),
];

export async function runIngestion(): Promise<ConnectorResult[]> {
  const results: ConnectorResult[] = [];

  for (const connector of CONNECTORS) {
    const start = Date.now();
    const result: ConnectorResult = {
      connector: connector.name,
      fetched: 0, normalized: 0, stored: 0, duplicates: 0,
      errors: [], durationMs: 0,
    };

    try {
      logger.info({ connector: connector.name }, 'Starting ingestion');
      const rawEvents = await connector.fetch();
      result.fetched = rawEvents.length;

      const normalized: NormalizedEvent[] = [];
      for (const raw of rawEvents) {
        try {
          const n = connector.normalize(raw);
          if (n) normalized.push(n);
        } catch (err) {
          result.errors.push(`normalize:${raw.sourceId}: ${String(err)}`);
        }
      }
      result.normalized = normalized.length;

      for (const event of normalized) {
        try {
          const outcome = await storeEvent(event);
          if (outcome === 'stored') result.stored++;
          else result.duplicates++;
        } catch (err) {
          result.errors.push(`store:${event.sourceId}: ${String(err)}`);
        }
      }

      result.durationMs = Date.now() - start;
      logger.info(result, 'Ingestion complete');
    } catch (err) {
      result.errors.push(`fatal: ${String(err)}`);
      result.durationMs = Date.now() - start;
      logger.error({ connector: connector.name, err }, 'Ingestion failed');
    }

    results.push(result);
  }

  return results;
}

// Mode --once : exécuter une seule fois et quitter
const runOnce = process.argv.includes('--once');

if (runOnce) {
  logger.info('Running ingestion once...');
  runIngestion()
    .then((results) => {
      const total = results.reduce((s, r) => s + r.stored, 0);
      logger.info({ total }, 'One-shot ingestion done');
    })
    .catch((err) => logger.error(err))
    .finally(() => closeSql().then(() => process.exit(0)));
}

export function startScheduler(): void {
  logger.info('Ingestion scheduler started');

  // ReliefWeb + FEWS NET : toutes les 2h
  cron.schedule('0 */2 * * *', async () => {
    logger.info('Running scheduled ingestion (2h)');
    await runIngestion();
  });

  // Open-Meteo météo : toutes les 6h
  cron.schedule('0 */6 * * *', async () => {
    logger.info('Running weather ingestion (6h)');
    const connector = new OpenMeteoConnector();
    const raws = await connector.fetch().catch(() => []);
    for (const raw of raws) {
      const n = connector.normalize(raw);
      if (n) await storeEvent(n).catch(() => {});
    }
  });

  // GDACS : toutes les 3h (flux public, pas d'API key requise)
  cron.schedule('0 */3 * * *', async () => {
    logger.info('Running GDACS ingestion (3h)');
    await fetchGdacsAlerts().catch(e => logger.error({ err: e }, 'GDACS ingestion error'));
  });

  // Première exécution immédiate
  void runIngestion();
  void fetchGdacsAlerts().catch(() => {});
}
