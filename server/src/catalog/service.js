import { config } from '../config.js';
import { ApiError, notFound, unavailable } from '../http/errors.js';
import { decimalToCents } from '../money.js';

const productCache = new Map();

function invalidCatalogResponse() {
  return unavailable('CATALOG_RESPONSE_INVALID', 'The product catalog returned invalid data.');
}

function normalizeText(value, { required = false, max = 500, allowNumber = false } = {}) {
  if (value == null) {
    if (required) throw invalidCatalogResponse();
    return '';
  }
  if (typeof value !== 'string' && !(allowNumber && typeof value === 'number' && Number.isFinite(value))) {
    throw invalidCatalogResponse();
  }
  const text = String(value).trim();
  if ((required && !text) || text.length > max) throw invalidCatalogResponse();
  return text;
}

function normalizePublicId(value) {
  const id = normalizeText(value, { required: true, max: 64, allowNumber: true });
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) throw invalidCatalogResponse();
  if (['__proto__', 'prototype', 'constructor'].includes(id.toLowerCase())) throw invalidCatalogResponse();
  return id;
}

function normalizeCategoryId(value, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalidCatalogResponse();
  return id;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalidCatalogResponse();
  return number;
}

function normalizeBoolean(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw invalidCatalogResponse();
  return value;
}

function normalizeMoney(value, { nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  try {
    const cents = decimalToCents(value);
    return { cents, decimal: (cents / 100).toFixed(2) };
  } catch {
    throw invalidCatalogResponse();
  }
}

function normalizeHttpUrl(value, { sameCatalogOrigin = false } = {}) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value, config.catalog.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (sameCatalogOrigin && url.origin !== config.catalog.origin) return '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeProduct(product) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) throw invalidCatalogResponse();
  const price = normalizeMoney(product.price);
  const originalPrice = normalizeMoney(product.original_price, { nullable: true });
  const stockQuantity = product.stock_quantity == null
    ? null
    : normalizeNonNegativeInteger(product.stock_quantity);
  const discountPercent = normalizeNonNegativeInteger(product.discount_percent, 0);
  if (discountPercent > 100) throw invalidCatalogResponse();

  return {
    id: normalizePublicId(product.id),
    name: normalizeText(product.name, { required: true, max: 500 }),
    description: normalizeText(product.description, { max: 50000 }),
    image_url: normalizeHttpUrl(product.image_url),
    price: price.decimal,
    priceCents: price.cents,
    original_price: originalPrice?.decimal ?? null,
    discount_percent: discountPercent,
    is_available: normalizeBoolean(product.is_available, true),
    is_popular: normalizeBoolean(product.is_popular, false),
    is_promo: normalizeBoolean(product.is_promo, false),
    brand_name: normalizeText(product.brand_name || product.brand, { max: 300 }),
    category: product.category == null ? null : normalizePublicId(product.category),
    category_name: normalizeText(product.category_name, { max: 500 }),
    package_size: normalizeText(product.package_size, { max: 100, allowNumber: true }),
    pack_size: normalizeText(product.pack_size, { max: 100, allowNumber: true }),
    size: normalizeText(product.size, { max: 100, allowNumber: true }),
    weight: normalizeText(product.weight, { max: 100, allowNumber: true }),
    volume: normalizeText(product.volume, { max: 100, allowNumber: true }),
    weight_volume: normalizeText(product.weight_volume, { max: 100, allowNumber: true }),
    barcode: normalizeText(product.barcode, { max: 200, allowNumber: true }),
    sku: normalizeText(product.sku, { max: 200, allowNumber: true }),
    ean: normalizeText(product.ean, { max: 200, allowNumber: true }),
    stock_quantity: stockQuantity
  };
}

function normalizeCategory(category, depth, state) {
  if (!category || typeof category !== 'object' || Array.isArray(category)) throw invalidCatalogResponse();
  if (depth > 8 || ++state.count > 5000) throw invalidCatalogResponse();
  const rawChildren = category.children == null || category.children === '' ? [] : category.children;
  if (!Array.isArray(rawChildren) || rawChildren.length > 1000) throw invalidCatalogResponse();
  return {
    id: normalizeCategoryId(category.id),
    name: normalizeText(category.name, { required: true, max: 500 }),
    icon: normalizeText(category.icon, { max: 64 }),
    image: normalizeHttpUrl(category.image),
    order: normalizeNonNegativeInteger(category.order, 0),
    parent_id: normalizeCategoryId(category.parent_id, { nullable: true }),
    product_count: normalizeNonNegativeInteger(category.product_count, 0),
    available_product_count: normalizeNonNegativeInteger(category.available_product_count, 0),
    children: rawChildren.map((child) => normalizeCategory(child, depth + 1, state))
  };
}

function normalizeBrand(brand) {
  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) throw invalidCatalogResponse();
  return {
    id: normalizeCategoryId(brand.id),
    name: normalizeText(brand.name, { required: true, max: 300 }),
    logoUrl: normalizeHttpUrl(brand.logo_url || brand.logo),
    order: normalizeNonNegativeInteger(brand.order, 0),
    productCount: normalizeNonNegativeInteger(brand.product_count, 0)
  };
}

function normalizePageLink(value) {
  const url = normalizeHttpUrl(value, { sameCatalogOrigin: true });
  return url || null;
}

function inferUpstreamPageSize({ count, resultCount, page, hasNext, requestedPageSize }) {
  if (hasNext && resultCount > 0) return resultCount;
  if (page > 1 && count >= resultCount) {
    const precedingItems = count - resultCount;
    const inferred = precedingItems / (page - 1);
    if (Number.isSafeInteger(inferred) && inferred > 0 && inferred <= 1000) return inferred;
  }
  if (resultCount > 0) return resultCount;
  const requested = Number(requestedPageSize);
  return Number.isSafeInteger(requested) && requested > 0 ? requested : 20;
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
      const pending = catalogFetch(`products/${encodeURIComponent(key)}/`, undefined, { signal }).then((payload) => {
        const product = normalizeProduct(payload);
        if (product.id !== key) throw invalidCatalogResponse();
        return product;
      });
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
        ordering: filters.ordering,
        brand: filters.brand,
        max_price: filters.maxPrice
      });
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          !Array.isArray(payload.results) || payload.results.length > 1000) {
        throw invalidCatalogResponse();
      }
      const results = payload.results.map(normalizeProduct);
      const count = normalizeNonNegativeInteger(payload.count, results.length);
      if (count < results.length) throw invalidCatalogResponse();
      const page = Number.isSafeInteger(Number(filters.page)) && Number(filters.page) > 0 ? Number(filters.page) : 1;
      const next = normalizePageLink(payload.next);
      const previous = normalizePageLink(payload.previous);
      return {
        count,
        pageSize: inferUpstreamPageSize({
          count,
          resultCount: results.length,
          page,
          hasNext: Boolean(next),
          requestedPageSize: filters.pageSize
        }),
        next,
        previous,
        results
      };
    },

    async listCategories() {
      const payload = await catalogFetch('categories/');
      const list = Array.isArray(payload) ? payload : payload?.results;
      if (!Array.isArray(list) || list.length > 1000) throw invalidCatalogResponse();
      const state = { count: 0 };
      return list.map((category) => normalizeCategory(category, 0, state));
    },

    async listBrands() {
      const payload = await catalogFetch('brands/');
      const list = Array.isArray(payload) ? payload : payload?.results;
      if (!Array.isArray(list) || list.length > 5000) throw invalidCatalogResponse();
      return list.map(normalizeBrand);
    },

    clearCache() {
      productCache.clear();
    }
  };
}

export function isCatalogError(error) {
  return error instanceof ApiError && ['CATALOG_UNAVAILABLE', 'CATALOG_RESPONSE_INVALID'].includes(error.code);
}
