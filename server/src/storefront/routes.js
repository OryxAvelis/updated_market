import { Router } from 'express';
import { loadStoreDeliverySettings, publicStorefrontConfig } from './config.js';

export function createStorefrontConfigRouter() {
  const router = Router();
  router.get('/config', async (req, res) => {
    const settings = await loadStoreDeliverySettings(req.app.locals.db);
    res.set('Cache-Control', 'no-store').json(
      publicStorefrontConfig(settings)
    );
  });
  return router;
}
