import { config } from '../config.js';
import { ApiError, notFound, unavailable } from '../http/errors.js';
import { decimalToCents } from '../money.js';

const productCache = new Map();

function normalizeProduct(product) {
  if (!product || product.id === undefined || !product.name) {
    throw unavailable('CATALOG_RESPONSE_INVALID', 'The product catalog returned invalid data.');
  }
  const priceCents = decimalToCents(product.price);
  return {
    ...product,
    id: String(product.id),
    name: String(product.name),
    price: (priceCents / 100).toFixed(2),
    priceCents,
    image_url: product.image_url ? String(product.image_url) : '',
    brand_name: product.brand_name ? String(product.brand_name) : '',
    category: product.category == null ? null : String(product.category),
    category_name: product.category_name ? String(product.category_name) : '',
    is_available: product.is_available !== false,
    stock_quantity: Number.isInteger(product.stock_quantity) ? product.stock_quantity : null
  };
}

async function catalogFetch(pathname, searchParams, { signal } = {}) {
  const url = new URL(`${config.catalog.baseUrl}/${pathname.replace(/^\//, '')}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  }
  let response;
  try {
    const timeoutSignal = AbortSignal.timeout(config.catalog.timeoutMs);
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'AM-Market-Backend/1.0' },
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
    });
  } catch (error) {
    throw unavailable('CATALOG_UNAVAILABLE', 'The product catalog is temporarily unavailable.', { reason: error.name });
  }
  if (response.status === 404) throw notFound('PRODUCT_NOT_FOUND', 'The product was not found.');
  if (!response.ok) {
    throw unavailable('CATALOG_UNAVAILABLE', 'The product catalog is temporarily unavailable.', { status: response.status });
  }
  try {
    return await response.json();
  } catch {
    throw unavailable('CATALOG_RESPONSE_INVALID', 'The product catalog returned invalid data.');
  }
}

export function createCatalogService() {
  return {
    async getProduct(productId, { refresh = false, signal } = {}) {
      const key = String(productId);
      const cached = productCache.get(key);
      if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;
      const pending = catalogFetch(`products/${encodeURIComponent(key)}/`, undefined, { signal }).then(normalizeProduct);
      // An abortable background refresh must not expose its cancellable promise
      // to unrelated storefront requests through the shared cache.
      if (!signal) productCache.set(key, { value: pending, expiresAt: Date.now() + config.catalog.cacheTtlMs });
      try {
        const value = await pending;
        if (!signal?.aborted) productCache.set(key, { value, expiresAt: Date.now() + config.catalog.cacheTtlMs });
        return value;
      } catch (error) {
        if (productCache.get(key)?.value === pending) productCache.delete(key);
        throw error;
      }
    },

    async listProducts(filters = {}) {
      const payload = await catalogFetch('products/', {
        include_descendants: 'true',
        page: filters.page,
        page_size: filters.pageSize,
        category: filters.category,
        search: filters.search,
        ordering: filters.ordering
      });
      if (!payload || !Array.isArray(payload.results)) {
        throw unavailable('CATALOG_RESPONSE_INVALID', 'The product catalog returned invalid data.');
      }
      return { ...payload, results: payload.results.map(normalizeProduct) };
    },

    async listCategories() {
      const payload = await catalogFetch('categories/');
      if (!Array.isArray(payload) && !Array.isArray(payload?.results)) {
        throw unavailable('CATALOG_RESPONSE_INVALID', 'The category catalog returned invalid data.');
      }
      return payload;
    },

    clearCache() {
      productCache.clear();
    }
  };
}

export function isCatalogError(error) {
  return error instanceof ApiError && ['CATALOG_UNAVAILABLE', 'CATALOG_RESPONSE_INVALID'].includes(error.code);
}
