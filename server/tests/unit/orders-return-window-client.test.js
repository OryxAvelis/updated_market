import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ordersUrl = new URL('../../../js/orders.js', import.meta.url);

async function loadReturnPanelHarness() {
  class UntrustedDeviceDate extends Date {
    static now() {
      throw new Error('The customer device clock must not decide return eligibility.');
    }
  }

  const context = {
    Date: UntrustedDeviceDate,
    URLSearchParams,
    console,
    document: { activeElement: null, addEventListener() {} },
    escapeHtml: value => String(value ?? ''),
    getLang: () => 'en',
    location: { search: '' },
    requestAnimationFrame: callback => callback(),
    t: key => key,
    window: { addEventListener() {} }
  };
  context.globalThis = context;

  const source = await readFile(ordersUrl, 'utf8');
  vm.runInNewContext(`${source}\n;globalThis.__returnWindowTest = { render: returnPanel };`, context, {
    filename: 'js/orders.js'
  });
  return context.__returnWindowTest;
}

function order(returnEligible) {
  return {
    id: 'order-1',
    orderNumber: 'AM-20260824-TEST',
    status: 'delivered',
    deliveredAt: '2000-01-01T00:00:00.000Z',
    returnEligible,
    items: [{ id: 'item-1', name: 'Milk', quantity: 1, returnedQuantity: 0 }]
  };
}

describe('customer return-window rendering contract', () => {
  it('renders only from the authoritative server eligibility flag without consulting the device clock', async () => {
    const harness = await loadReturnPanelHarness();

    expect(harness.render(order(true))).toContain('data-return-form="order-1"');
    expect(harness.render(order(false))).toBe('');
    expect(harness.render(order(undefined))).toBe('');
  });
});
