import http from 'node:http';
import https from 'node:https';
import { createApp } from './app.js';
import { createCatalogService } from './catalog/service.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { createLowStockEvaluator } from './engagement/low-stock.js';
import { logger } from './logger.js';

if (!pool) throw new Error('The database pool is unavailable.');
const catalog = createCatalogService();
const app = createApp({ database: pool, catalog });
const lowStockEvaluator = createLowStockEvaluator({ database: pool, catalog });
const servers = [];
let shuttingDown = false;

function listen(server, port, host, label) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      logger.info({ host, port }, `${label} listening`);
      resolve();
    });
  });
}

if (config.tlsTerminatedByProxy) {
  const applicationServer = http.createServer(app);
  servers.push(applicationServer);
  await listen(applicationServer, config.httpPort, config.host, 'Private HTTP application server');
} else {
  const cert = config.readTlsCertificate();
  const key = config.readTlsPrivateKey();
  if (!cert || !key) throw new Error('TLS_CERT_PATH and TLS_KEY_PATH are required for direct HTTPS.');
  const httpsServer = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, app);
  const redirectServer = http.createServer((req, res) => {
    const target = new URL(req.url || '/', config.appOrigin);
    res.writeHead(308, {
      Location: target.toString(),
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('Redirecting to HTTPS');
  });
  servers.push(httpsServer, redirectServer);
  await listen(httpsServer, config.httpsPort, config.host, 'HTTPS application server');
  await listen(redirectServer, config.httpPort, config.host, 'HTTP redirect server');
}
lowStockEvaluator.start();

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');
  const timer = setTimeout(() => process.exit(1), 10000).unref();
  await lowStockEvaluator.stop();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await pool.end();
  clearTimeout(timer);
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
