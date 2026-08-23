import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const serverRoot = new URL('../../', import.meta.url);

function productionEnvironment(overrides = {}) {
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    LOG_LEVEL: 'silent',
    APP_ORIGIN: 'https://market.example.com',
    ALLOWED_ORIGINS: 'https://market.example.com',
    PASSWORD_RESET_URL: 'https://market.example.com/reset-password.html',
    DB_PASSWORD: 'unit-test-database-password',
    DB_TLS: 'true',
    FULFILLMENT_WEBHOOK_SECRET: 'unit-test-fulfillment-secret-value-32-bytes',
    FULFILLMENT_WEBHOOK_SECRET_FILE: '',
    TRUST_PROXY: '1',
    TLS_TERMINATED_BY_PROXY: 'true',
    ...overrides
  };
  delete environment.ENV_FILE;
  return environment;
}

function runModule(source, environment) {
  return execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: serverRoot,
    env: environment,
    encoding: 'utf8'
  }).trim();
}

describe('production transport fail-closed configuration', () => {
  it.each([
    ['unencrypted MySQL', { DB_TLS: 'false' }, 'DB_TLS must remain enabled'],
    ['an insecure allowed origin', { ALLOWED_ORIGINS: 'http://market.example.com' }, 'must use HTTPS'],
    ['a missing trusted proxy hop', { TRUST_PROXY: '0' }, 'TRUST_PROXY must identify']
  ])('rejects %s', (_label, overrides, expectedMessage) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/config.js')"], {
      cwd: serverRoot,
      env: productionEnvironment(overrides),
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
  });

  it('lets the public TLS proxy own HSTS without duplicate policies', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({ hsts: response.headers['strict-transport-security'] || null }));
    `, productionEnvironment());
    expect(JSON.parse(output)).toEqual({ hsts: null });
  });

  it('emits HSTS when Node terminates production HTTPS directly', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({ hsts: response.headers['strict-transport-security'] || null }));
    `, productionEnvironment({ TLS_TERMINATED_BY_PROXY: 'false', TRUST_PROXY: '0' }));
    expect(JSON.parse(output).hsts).toBe('max-age=31536000; includeSubDomains');
  });
});
