import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCatalogService } from '../../src/catalog/service.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog response normalization', () => {
  it('returns only normalized product fields and discards unsafe image URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: 'safe-product-1',
      name: '  Safe product  ',
      description: ' Description ',
      price: '12.3',
      original_price: '15.00',
      image_url: 'javascript:alert(1)',
      brand_name: ' Brand ',
      category: 42,
      category_name: 'Category',
      discount_percent: 10,
      is_available: true,
      is_promo: false,
      stock_quantity: 7,
      unexpected_html: '<img src=x onerror=alert(1)>'
    })));

    const service = createCatalogService();
    const product = await service.getProduct('safe-product-1');

    expect(product).toMatchObject({
      id: 'safe-product-1',
      name: 'Safe product',
      description: 'Description',
      price: '12.30',
      priceCents: 1230,
      original_price: '15.00',
      image_url: '',
      brand_name: 'Brand',
      category: '42',
      discount_percent: 10,
      stock_quantity: 7
    });
    expect(product).not.toHaveProperty('unexpected_html');
  });

  it.each([
    ['an invalid price', { id: 'invalid-price-1', name: 'Bad price', price: '-1.00' }],
    ['an invalid identifier', { id: 'bad/id', name: 'Bad id', price: '1.00' }],
    ['a prototype-reserved identifier', { id: '__proto__', name: 'Bad id', price: '1.00' }],
    ['a non-text name', { id: 'bad-name-1', name: 42, price: '1.00' }],
    ['a non-boolean availability flag', { id: 'bad-boolean-1', name: 'Bad flag', price: '1.00', is_available: 'yes' }]
  ])('rejects %s as an invalid upstream response', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)));
    const service = createCatalogService();
    await expect(service.getProduct(String(payload.id))).rejects.toMatchObject({
      status: 503,
      code: 'CATALOG_RESPONSE_INVALID'
    });
  });

  it('normalizes pagination metadata and product lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      count: 1,
      next: 'https://attacker.example/products?page=2',
      previous: null,
      injected: 'not forwarded',
      results: [{ id: 91, name: 'List product', price: '9.99' }]
    })));
    const payload = await createCatalogService().listProducts({ page: 1 });
    expect(payload).toEqual({
      count: 1,
      pageSize: 1,
      next: null,
      previous: null,
      results: [expect.objectContaining({ id: '91', name: 'List product', price: '9.99' })]
    });
    expect(payload).not.toHaveProperty('injected');
  });

  it('reports the effective upstream page size when the provider ignores page_size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      count: 47,
      next: null,
      previous: 'https://api.mmarket.ma/api/products/?page=2&page_size=12',
      results: Array.from({ length: 7 }, (_, index) => ({
        id: `last-page-${index + 1}`,
        name: `Product ${index + 1}`,
        price: '1.00'
      }))
    })));

    const payload = await createCatalogService().listProducts({ page: 3, pageSize: 12 });
    expect(payload.pageSize).toBe(20);
    expect(payload.results).toHaveLength(7);
  });

  it('forwards supported global brand and maximum-price filters', async () => {
    let requestedUrl;
    vi.stubGlobal('fetch', vi.fn(async url => {
      requestedUrl = new URL(url);
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }));

    await createCatalogService().listProducts({ page: 1, pageSize: 20, brand: 'AÏN SAÏSS', maxPrice: 25 });
    expect(requestedUrl.searchParams.get('brand')).toBe('AÏN SAÏSS');
    expect(requestedUrl.searchParams.get('max_price')).toBe('25');
  });

  it('normalizes the global brand directory without forwarding extra fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{
      id: 9,
      name: ' Brand ',
      logo_url: 'javascript:alert(1)',
      order: 2,
      product_count: 8,
      injected: '<img onerror=alert(1)>'
    }])));

    const brands = await createCatalogService().listBrands();
    expect(brands).toEqual([{ id: 9, name: 'Brand', logoUrl: '', order: 2, productCount: 8 }]);
    expect(brands[0]).not.toHaveProperty('injected');
  });

  it('normalizes nested categories and converts the upstream empty-string children quirk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{
      id: 10,
      name: ' Parent ',
      icon: 'box',
      image: 'javascript:alert(1)',
      order: 1,
      parent_id: null,
      product_count: '4',
      available_product_count: 3,
      children: [{
        id: 11,
        name: 'Child',
        parent_id: 10,
        product_count: 1,
        children: ''
      }]
    }])));

    const categories = await createCatalogService().listCategories();
    expect(categories).toEqual([expect.objectContaining({
      id: 10,
      name: 'Parent',
      image: '',
      product_count: 4,
      children: [expect.objectContaining({ id: 11, parent_id: 10, children: [] })]
    })]);
  });
});
