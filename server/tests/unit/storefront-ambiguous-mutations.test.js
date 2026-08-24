import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const checkoutUrl = new URL('../../../js/checkout.js', import.meta.url);
const productUrl = new URL('../../../js/product.js', import.meta.url);

function baseBrowserContext() {
  const context = {
    URLSearchParams,
    console,
    document: {
      activeElement: null,
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    getLang: () => 'en',
    location: { search: '?id=product-1', replace() {} },
    requestAnimationFrame: (callback) => callback(),
    t: (key) => key,
    window: { addEventListener() {}, confirm: () => true }
  };
  context.globalThis = context;
  return context;
}

async function checkoutHarness({ create, list }) {
  const context = baseBrowserContext();
  context.$ = () => null;
  context.normalizeMoroccanPhone = value => String(value || '').replace(/\D/g, '').replace(/^212/, '').replace(/^0/, '');
  context.isValidMoroccanPhone = () => true;
  context.assertAuthenticatedRequestCurrent = () => {};
  context.StoreAPI = { addresses: { create, list } };
  const source = await readFile(checkoutUrl, 'utf8');
  const hooks = `
    globalThis.__checkoutMutationTest = {
      setAddresses(value) { savedAddresses = value; },
      getAddresses() { return savedAddresses; },
      matches: addressesMatch,
      find: findMatchingSavedAddress,
      resolve: resolveCheckoutAddress
    };
  `;
  vm.runInNewContext(`${source}\n${hooks}`, context, { filename: 'js/checkout.js' });
  return context.__checkoutMutationTest;
}

async function productHarness() {
  const context = baseBrowserContext();
  const source = await readFile(productUrl, 'utf8');
  vm.runInNewContext(`${source}\n;globalThis.__productMutationTest = { matches: reviewMatchesInput };`, context, {
    filename: 'js/product.js'
  });
  return context.__productMutationTest;
}

const addressInput = {
  recipientName: 'Youssef A.',
  phone: '+212612345678',
  email: 'Customer@Example.test',
  addressLine1: '10 Market Street',
  district: 'Centre',
  city: 'Casablanca',
  deliveryInstructions: 'Ring once'
};

describe('ambiguous storefront mutation reconciliation', () => {
  it('reuses an already loaded exact address without creating a duplicate', async () => {
    const create = vi.fn();
    const list = vi.fn();
    const harness = await checkoutHarness({ create, list });
    harness.setAddresses([{ id: 'address-existing', ...addressInput, email: 'customer@example.test' }]);

    await expect(harness.resolve({ user: true }, addressInput)).resolves.toBe('address-existing');
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('does not reuse a saved address with different apartment or postal details', async () => {
    const create = vi.fn().mockResolvedValue({ address: { id: 'address-new', ...addressInput } });
    const harness = await checkoutHarness({ create, list: vi.fn() });
    const saved = { id: 'address-existing', ...addressInput, addressLine2: 'Apt 4', postalCode: '20000' };
    expect(harness.matches(saved, { ...addressInput, addressLine2: null, postalCode: null })).toBe(false);
    expect(harness.matches({ ...saved, addressLine2: null }, { ...addressInput, postalCode: '20250' })).toBe(false);
  });

  it('recovers a committed address after the create response is lost', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('network lost'), { status: 503 }));
    const list = vi.fn().mockResolvedValue({
      addresses: [{ id: 'address-committed', ...addressInput, phone: '0612345678' }]
    });
    const harness = await checkoutHarness({ create, list });
    harness.setAddresses([]);

    await expect(harness.resolve({ user: true }, addressInput)).resolves.toBe('address-committed');
    expect(create).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledOnce();
    expect(harness.getAddresses()).toHaveLength(1);
  });

  it('compares authoritative review content before treating a lost response as success', async () => {
    const harness = await productHarness();
    const input = { rating: 5, title: 'Excellent', body: 'Fresh and fast.' };
    expect(harness.matches({ ...input, id: 'review-1' }, input)).toBe(true);
    expect(harness.matches({ ...input, rating: 4 }, input)).toBe(false);
    expect(harness.matches(null, input)).toBe(false);
    expect(harness.matches({ rating: 5, title: null, body: null }, { rating: 5, title: null, body: null })).toBe(true);
  });
});
