import { Router } from 'express';
import { z } from 'zod';
import { productIdSchema } from '../validation/common.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().trim().max(64).optional(),
  search: z.string().trim().max(100).optional(),
  ordering: z.enum(['price', '-price', 'name', '-name', '-created_at', 'created_at']).optional()
}).strip();

export function createCatalogRouter(catalog) {
  const router = Router();
  router.get('/categories', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').json(await catalog.listCategories());
  });
  router.get('/products', async (req, res) => {
    const query = querySchema.parse(req.query);
    const payload = await catalog.listProducts({
      page: query.page,
      pageSize: query.page_size,
      category: query.category,
      search: query.search,
      ordering: query.ordering
    });
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120').json(payload);
  });
  router.get('/products/:productId', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120').json(await catalog.getProduct(productId));
  });
  return router;
}
