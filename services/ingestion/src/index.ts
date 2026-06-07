import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';

logger.info('SINAUR-RDC Ingestion Service v0.1.0 starting');
startScheduler();

process.on('SIGTERM', () => { logger.info('Shutting down'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('Shutting down'); process.exit(0); });
