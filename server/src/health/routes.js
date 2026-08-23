import { Router } from 'express';

export function createHealthRouter() {
  const router = Router();
  router.get('/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });
  router.get('/ready', async (req, res) => {
    try {
      const connection = await req.app.locals.db.getConnection();
      try {
        await connection.query('SELECT 1');
        const [rows] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
        const cipher = rows[0]?.Value || rows[0]?.value || '';
        if (!cipher) throw new Error('The MySQL connection is not encrypted.');
        res.set('Cache-Control', 'no-store').json({ status: 'ok', database: 'ready', databaseTls: true });
      } finally {
        connection.release();
      }
    } catch (error) {
      req.log?.warn({ err: error }, 'Readiness check failed');
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'unavailable' });
    }
  });
  return router;
}
