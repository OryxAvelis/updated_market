import { describe, expect, it } from 'vitest';
import { classifyStock, createLowStockEvaluator, stockTransition } from '../../src/engagement/low-stock.js';

describe('low-stock state transitions', () => {
  it('never treats an absent, fractional, or negative quantity as real stock data', () => {
    expect(classifyStock(null, 5)).toBe('unknown');
    expect(classifyStock(undefined, 5)).toBe('unknown');
    expect(classifyStock(2.5, 5)).toBe('unknown');
    expect(classifyStock(-1, 5)).toBe('unknown');
  });

  it('uses the configured inclusive threshold', () => {
    expect(classifyStock(6, 5)).toBe('available');
    expect(classifyStock(5, 5)).toBe('low');
    expect(classifyStock(0, 5)).toBe('low');
  });

  it('emits only boundary transitions and not repeated observations', () => {
    expect(stockTransition('unknown', 'available')).toBeNull();
    expect(stockTransition('unknown', 'low')).toBe('low_stock');
    expect(stockTransition('available', 'low')).toBe('low_stock');
    expect(stockTransition('low', 'low')).toBeNull();
    expect(stockTransition('low', 'available')).toBe('restocked');
    expect(stockTransition('available', 'available')).toBeNull();
  });

  it('prevents overlapping runs and lets shutdown await the active run', async () => {
    let releaseQuery;
    let queryStarted;
    const started = new Promise((resolve) => { queryStarted = resolve; });
    const database = {
      execute() {
        queryStarted();
        return new Promise((resolve) => { releaseQuery = resolve; });
      }
    };
    const evaluator = createLowStockEvaluator({
      database,
      catalog: { async getProduct() { throw new Error('No product should be fetched.'); } },
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      options: {
        enabled: true,
        intervalMs: 60_000,
        runTimeoutMs: 10_000,
        batchSize: 10,
        concurrency: 2,
        defaultThreshold: 5,
        notificationTtlDays: 30
      }
    });

    evaluator.start();
    await started;
    await expect(evaluator.runNow()).resolves.toEqual({ skipped: true, reason: 'already_running' });
    releaseQuery([[], []]);
    await evaluator.stop();
    await expect(evaluator.runNow()).resolves.toEqual({ skipped: true, reason: 'disabled' });
  });
});
