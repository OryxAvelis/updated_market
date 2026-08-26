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
  vm.runInNewContext(`${source}\n;globalThis.__returnWindowTest = { render: returnPanel, record: recordSubmittedReturn, remaining: remainingReturnQuantity };`, context, {
    filename: 'js/orders.js'
  });
  return context.__returnWindowTest;
}

function order(returnEligible, overrides = {}) {
  return {
    id: 'order-1',
    orderNumber: 'AM-20260824-TEST',
    status: 'delivered',
    deliveredAt: '2000-01-01T00:00:00.000Z',
    returnEligible,
    items: [{ id: 'item-1', name: 'Milk', quantity: 1, returnedQuantity: 0 }],
    returns: [],
    ...overrides
  };
}

describe('customer return-window rendering contract', () => {
  it('renders only from the authoritative server eligibility flag without consulting the device clock', async () => {
    const harness = await loadReturnPanelHarness();

    expect(harness.render(order(true))).toContain('data-return-form="order-1"');
    expect(harness.render(order(false))).toBe('');
    expect(harness.render(order(undefined))).toBe('');
  });

  it('restores a persisted return confirmation and current status after reload', async () => {
    const harness = await loadReturnPanelHarness();
    const html = harness.render(order(false, {
      returns: [{
        id: 'return-persisted',
        status: 'approved',
        reason: 'quality',
        details: 'Package opened on arrival',
        requestedAt: '2026-08-24T10:00:00.000Z',
        updatedAt: '2026-08-25T10:00:00.000Z'
      }]
    }));

    expect(html).toContain('return-persisted');
    expect(html).toContain('Status: Approved');
    expect(html).toContain('alert alert-info');
    expect(html).toContain('data-return-success="order-1"');
    expect(html).not.toContain('data-return-form="order-1"');
  });

  it('merges an optimistic submission with the persisted server status and quantities', async () => {
    const harness = await loadReturnPanelHarness();
    const submittedOrder = order(true);
    harness.record(submittedOrder, { id: 'return-merged', status: 'requested' }, [
      { orderItemId: 'item-1', quantity: 1 }
    ]);

    const html = harness.render(order(true, {
      items: [{ id: 'item-1', name: 'Milk', quantity: 1, returnedQuantity: 1 }],
      returns: [{
        id: 'return-merged',
        status: 'received',
        reason: 'quality',
        details: null,
        requestedAt: '2026-08-24T10:00:00.000Z',
        updatedAt: '2026-08-26T10:00:00.000Z'
      }]
    }));

    expect(html).toContain('return-merged');
    expect(html).toContain('Status: Received');
    expect(html).not.toContain('data-return-form="order-1"');
  });

  it('reconciles multiple optimistic returns independently with authoritative rejection and cancellation', async () => {
    const harness = await loadReturnPanelHarness();
    const submittedOrder = order(true, {
      items: [{ id: 'item-1', name: 'Milk', quantity: 4, returnedQuantity: 0 }]
    });
    harness.record(submittedOrder, { id: 'return-one', status: 'requested' }, [
      { orderItemId: 'item-1', quantity: 1 }
    ]);
    harness.record(submittedOrder, { id: 'return-two', status: 'requested' }, [
      { orderItemId: 'item-1', quantity: 2 }
    ]);
    expect(harness.remaining(submittedOrder, submittedOrder.items[0])).toBe(1);

    const firstRejected = order(true, {
      items: [{ id: 'item-1', name: 'Milk', quantity: 4, returnedQuantity: 0 }],
      returns: [{ id: 'return-one', status: 'rejected' }]
    });
    expect(harness.remaining(firstRejected, firstRejected.items[0])).toBe(2);

    const reconciled = order(true, {
      items: [{ id: 'item-1', name: 'Milk', quantity: 4, returnedQuantity: 2 }],
      returns: [
        { id: 'return-one', status: 'cancelled' },
        { id: 'return-two', status: 'requested' }
      ]
    });
    expect(harness.remaining(reconciled, reconciled.items[0])).toBe(2);
  });

  it.each(['requested', 'approved', 'received', 'refunded'])(
    'uses the authoritative returned quantity for a persisted %s return',
    async (status) => {
      const harness = await loadReturnPanelHarness();
      const persistedOrder = order(true, {
        items: [{ id: 'item-1', name: 'Milk', quantity: 3, returnedQuantity: 2 }],
        returns: [{ id: `return-${status}`, status }]
      });

      expect(harness.remaining(persistedOrder, persistedOrder.items[0])).toBe(1);
    }
  );

  it.each([
    ['rejected', 'alert-warning', 'Return rejected'],
    ['cancelled', 'alert-secondary', 'Return cancelled']
  ])('uses non-success semantics for a persisted %s return', async (status, alertClass, heading) => {
    const harness = await loadReturnPanelHarness();
    const html = harness.render(order(false, {
      returns: [{ id: `return-${status}`, status }]
    }));

    expect(html).toContain(`alert ${alertClass}`);
    expect(html).toContain(`<strong>${heading}</strong>`);
    expect(html).toContain(`Status: ${status === 'rejected' ? 'Rejected' : 'Cancelled'}`);
    expect(html).not.toContain('alert alert-success');
    expect(html).not.toContain('data-return-form="order-1"');
  });
});
