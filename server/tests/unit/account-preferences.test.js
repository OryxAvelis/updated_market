import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAccountRouter } from '../../src/account/routes.js';

function preferenceHarness({ snapshots = 3 } = {}) {
  const state = {
    preferences: {
      language: 'en',
      theme: 'light',
      default_payment: 'cod',
      order_notifications: 1,
      low_stock_notifications: 1,
      personalization_enabled: 1,
      updated_at: new Date('2026-08-26T00:00:00.000Z')
    },
    snapshots,
    events: []
  };
  const connection = {
    async beginTransaction() { state.events.push('begin'); },
    async commit() { state.events.push('commit'); },
    async rollback() { state.events.push('rollback'); },
    release() { state.events.push('release'); },
    async execute(statement, parameters) {
      const query = statement.replace(/\s+/g, ' ').trim();
      if (query === 'SELECT user_id FROM user_preferences WHERE user_id = ? LIMIT 1 FOR UPDATE') {
        state.events.push('lock-preference');
        return [[{ user_id: parameters[0] }]];
      }
      if (query.startsWith('UPDATE user_preferences SET')) {
        state.events.push('update');
        if (query.includes('theme = ?')) state.preferences.theme = parameters[0];
        if (query.includes('personalization_enabled = ?')) {
          state.preferences.personalization_enabled = parameters[0] ? 1 : 0;
        }
        return [{ affectedRows: 1 }];
      }
      if (query === 'DELETE FROM recommendation_snapshots WHERE user_id = ?') {
        state.events.push('delete-snapshots');
        state.snapshots = 0;
        return [{ affectedRows: snapshots }];
      }
      if (query.startsWith('SELECT language, theme, default_payment')) {
        state.events.push('select');
        return [[{ ...state.preferences }]];
      }
      throw new Error(`Unexpected account-preference query: ${query}`);
    }
  };
  const database = { async getConnection() { return connection; } };
  const app = express();
  app.locals.db = database;
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 42, accountKind: 'customer', user: { id: 'customer-public-id' } };
    next();
  });
  app.use('/api/v1/me', createAccountRouter());
  return { app, state };
}

describe('account preference personalization boundary', () => {
  it('deletes recommendation snapshots inside the explicit opt-out transaction', async () => {
    const { app, state } = preferenceHarness();

    const response = await request(app)
      .patch('/api/v1/me/preferences')
      .send({ personalizationEnabled: false });

    expect(response.status).toBe(200);
    expect(response.body.preferences.personalizationEnabled).toBe(false);
    expect(state.snapshots).toBe(0);
    expect(state.events).toEqual([
      'begin', 'lock-preference', 'update', 'delete-snapshots', 'select', 'commit', 'release'
    ]);
  });

  it.each([
    { payload: { theme: 'dark' }, caseName: 'unrelated preference update' },
    { payload: { personalizationEnabled: true }, caseName: 'explicit personalization enable' }
  ])('preserves recommendation snapshots for an $caseName', async ({ payload }) => {
    const { app, state } = preferenceHarness();

    const response = await request(app).patch('/api/v1/me/preferences').send(payload);

    expect(response.status).toBe(200);
    expect(state.snapshots).toBe(3);
    expect(state.events).toEqual(['begin', 'lock-preference', 'update', 'select', 'commit', 'release']);
  });
});
