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
    ['a missing trusted proxy hop', { TRUST_PROXY: '0' }, 'TRUST_PROXY must identify'],
    ['an unsafe HSTS preload policy', { HSTS_PRELOAD: 'true' }, 'HSTS_PRELOAD requires']
  ])('rejects %s', (_label, overrides, expectedMessage) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/config.js')"], {
      cwd: serverRoot,
      env: productionEnvironment(overrides),
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
  });

  it('emits HSTS when production HTTPS is terminated by a trusted proxy', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({ hsts: response.headers['strict-transport-security'] || null }));
    `, productionEnvironment());
    expect(JSON.parse(output).hsts).toBe('max-age=300');
  });

  it('emits HSTS when Node terminates production HTTPS directly', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({ hsts: response.headers['strict-transport-security'] || null }));
    `, productionEnvironment({ TLS_TERMINATED_BY_PROXY: 'false', TRUST_PROXY: '0' }));
    expect(JSON.parse(output).hsts).toBe('max-age=300');
  });

  it('allows a verified one-year subdomain policy without adding a duplicate edge header', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({ hsts: response.headers['strict-transport-security'] || null }));
    `, productionEnvironment({
      HSTS_MAX_AGE_SECONDS: '31536000',
      HSTS_INCLUDE_SUBDOMAINS: 'true'
    }));
    expect(JSON.parse(output).hsts).toBe('max-age=31536000; includeSubDomains');
  });

  it('keeps proxy HTTPS redirects on the configured origin for scheme-relative targets', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('//evil.example/path?from=http');
      console.log(JSON.stringify({ status: response.status, location: response.headers.location }));
    `, productionEnvironment());
    expect(JSON.parse(output)).toEqual({
      status: 308,
      location: 'https://market.example.com//evil.example/path?from=http'
    });
  });

  it('revalidates unversioned storefront assets after a deployment', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} }))
        .get('/js/core.js')
        .set('X-Forwarded-Proto', 'https');
      console.log(JSON.stringify({ cacheControl: response.headers['cache-control'] || null }));
    `, productionEnvironment());
    const { cacheControl } = JSON.parse(output);
    expect(cacheControl).toContain('max-age=0');
    expect(cacheControl).not.toContain('immutable');
  });
});
