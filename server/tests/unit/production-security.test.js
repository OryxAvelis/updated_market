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
    ENFORCE_PROXY_HTTPS_REDIRECT: 'true',
    LOCAL_DEV_LOGIN: 'false',
    LOCAL_DEV_LOGIN_USER_EMAIL: '',
    ...overrides
  };
  delete environment.ENV_FILE;
  return environment;
}

function developmentEnvironment(overrides = {}) {
  const environment = {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    APP_ORIGIN: 'https://localhost:3443',
    ALLOWED_ORIGINS: 'https://localhost:3443,https://127.0.0.1:3443',
    PASSWORD_RESET_URL: 'https://localhost:3443/reset-password.html',
    DB_HOST: '127.0.0.1',
    DB_TLS: 'true',
    TRUST_PROXY: '0',
    TLS_TERMINATED_BY_PROXY: 'false',
    LOCAL_DEV_LOGIN: 'false',
    LOCAL_DEV_LOGIN_USER_EMAIL: '',
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
  it('uses Render HTTPS, proxy, bind host, and assigned port defaults', () => {
    const environment = productionEnvironment({
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://am-market-example.onrender.com',
      PORT: '10000'
    });
    for (const key of [
      'APP_ORIGIN',
      'ALLOWED_ORIGINS',
      'PASSWORD_RESET_URL',
      'HOST',
      'TRUST_PROXY',
      'TLS_TERMINATED_BY_PROXY',
      'HTTP_REDIRECT_PORT',
      'LOW_STOCK_EVALUATOR_ENABLED'
    ]) delete environment[key];

    const output = runModule(`
      const { config } = await import('./src/config.js');
      console.log(JSON.stringify({
        host: config.host,
        port: config.httpPort,
        appOrigin: config.appOrigin,
        allowedOrigins: [...config.allowedOrigins],
        trustProxy: config.trustProxy,
        tlsTerminatedByProxy: config.tlsTerminatedByProxy,
        resetUrl: config.auth.resetUrl,
        lowStockEnabled: config.lowStock.enabled
      }));
    `, environment);

    expect(JSON.parse(output)).toEqual({
      host: '0.0.0.0',
      port: 10000,
      appOrigin: 'https://am-market-example.onrender.com',
      allowedOrigins: ['https://am-market-example.onrender.com'],
      trustProxy: 1,
      tlsTerminatedByProxy: true,
      resetUrl: 'https://am-market-example.onrender.com/reset-password.html',
      lowStockEnabled: false
    });
  });

  it.each([
    ['unencrypted MySQL', { DB_TLS: 'false' }, 'DB_TLS must remain enabled'],
    ['an insecure allowed origin', { ALLOWED_ORIGINS: 'http://market.example.com' }, 'must use HTTPS'],
    ['a cross-origin password-reset destination', {
      PASSWORD_RESET_URL: 'https://attacker.example/reset-password.html'
    }, 'PASSWORD_RESET_URL must use the APP_ORIGIN origin'],
    ['a credential-bearing password-reset destination', {
      PASSWORD_RESET_URL: 'https://user:password@market.example.com/reset-password.html'
    }, 'PASSWORD_RESET_URL must not contain URL credentials'],
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

  it('allows a managed HTTPS edge to disable only the redundant application redirect', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({
        status: response.status,
        location: response.headers.location || null,
        hsts: response.headers['strict-transport-security'] || null
      }));
    `, productionEnvironment({ ENFORCE_PROXY_HTTPS_REDIRECT: 'false' }));
    expect(JSON.parse(output)).toEqual({
      status: 200,
      location: null,
      hsts: 'max-age=300'
    });
  });

  it('accepts only the current same-host Back4App preview origin when dynamic previews are enabled', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const app = createApp({ database: {} });
      const hostname = 'ammarket2026-xybllx49.b4a.run';
      const currentOrigin = \`https://\${hostname}\`;
      const otherOrigin = 'https://another-preview.b4a.run';
      const headers = (origin) => ({
        Host: hostname,
        Origin: origin,
        'X-Forwarded-Proto': 'https'
      });
      const allowedPreflight = await request(app)
        .options('/api/v1/auth/register')
        .set(headers(currentOrigin))
        .set('Access-Control-Request-Method', 'POST');
      const deniedPreflight = await request(app)
        .options('/api/v1/auth/register')
        .set(headers(otherOrigin))
        .set('Access-Control-Request-Method', 'POST');
      const allowedMutation = await request(app)
        .post('/api/v1/auth/register')
        .set(headers(currentOrigin))
        .send({});
      const deniedMutation = await request(app)
        .post('/api/v1/auth/register')
        .set(headers(otherOrigin))
        .send({});
      console.log(JSON.stringify({
        allowedCors: allowedPreflight.headers['access-control-allow-origin'] || null,
        deniedCors: deniedPreflight.headers['access-control-allow-origin'] || null,
        allowedCode: allowedMutation.body.error?.code || null,
        deniedCode: deniedMutation.body.error?.code || null
      }));
    `, productionEnvironment({ BACK4APP_DYNAMIC_ORIGIN: 'true' }));
    expect(JSON.parse(output)).toEqual({
      allowedCors: 'https://ammarket2026-xybllx49.b4a.run',
      deniedCors: null,
      allowedCode: 'CSRF_INVALID',
      deniedCode: 'ORIGIN_REJECTED'
    });
  });

  it('requires the dynamic Back4App preview mode to stay behind the trusted production TLS proxy', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/config.js')"], {
      cwd: serverRoot,
      env: productionEnvironment({
        BACK4APP_DYNAMIC_ORIGIN: 'true',
        TLS_TERMINATED_BY_PROXY: 'false',
        TRUST_PROXY: '0'
      }),
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'BACK4APP_DYNAMIC_ORIGIN requires production behind a trusted TLS proxy'
    );
  });

  it('allows only the pinned public catalog as an external connection fallback', () => {
    const output = runModule(`
      const [{ createApp }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('supertest')
      ]);
      const response = await request(createApp({ database: {} })).get('/');
      console.log(JSON.stringify({ csp: response.headers['content-security-policy'] || '' }));
    `, productionEnvironment({ CATALOG_API_ORIGIN: 'https://catalog.internal.example' }));
    const { csp } = JSON.parse(output);
    expect(csp).toContain("connect-src 'self' https://api.mmarket.ma");
    expect(csp).not.toContain('catalog.internal.example');
    expect(csp).not.toContain('connect-src *');
  });
});

describe('password-reset email provider configuration', () => {
  const noEmailProvider = {
    EMAIL_PROVIDER: '',
    RESEND_API_KEY: '',
    RESEND_FROM: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: ''
  };

  it('supports an explicitly configured Resend HTTPS provider and otherwise stays safely disabled', () => {
    const disabled = runModule(`
      const { config } = await import('./src/config.js');
      console.log(config.email.provider);
    `, productionEnvironment(noEmailProvider));
    expect(disabled).toBe('none');

    const enabled = runModule(`
      const { config } = await import('./src/config.js');
      console.log(JSON.stringify({
        provider: config.email.provider,
        from: config.email.resend.from,
        timeoutMs: config.email.httpTimeoutMs
      }));
    `, productionEnvironment({
      ...noEmailProvider,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_unit_test_key_1234567890',
      RESEND_FROM: 'AM MARKET <reset@market.example>',
      EMAIL_HTTP_TIMEOUT_MS: '5000'
    }));
    expect(JSON.parse(enabled)).toEqual({
      provider: 'resend',
      from: 'AM MARKET <reset@market.example>',
      timeoutMs: 5000
    });
  });

  it('keeps legacy SMTP-only configuration routed through the SMTP provider', () => {
    const output = runModule(`
      const { config } = await import('./src/config.js');
      console.log(JSON.stringify({
        provider: config.email.provider,
        host: config.smtp.host,
        authenticated: Boolean(config.smtp.user && config.smtp.password)
      }));
    `, productionEnvironment({
      ...noEmailProvider,
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'unit-test-smtp-password'
    }));
    expect(JSON.parse(output)).toEqual({
      provider: 'smtp',
      host: 'smtp.example.com',
      authenticated: true
    });
  });

  it('redacts the Resend API key from structured application logs', () => {
    const apiKey = 're_unit_test_log_secret_1234567890';
    const output = runModule(`
      const [{ logger }, { config }] = await Promise.all([
        import('./src/logger.js'), import('./src/config.js')
      ]);
      logger.info({ config }, 'configuration audit');
    `, productionEnvironment({
      ...noEmailProvider,
      LOG_LEVEL: 'info',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: apiKey,
      RESEND_FROM: 'AM MARKET <reset@market.example>'
    }));
    expect(output).not.toContain(apiKey);
    expect(output).toContain('[REDACTED]');
  });

  it.each([
    ['a missing Resend API key', {
      ...noEmailProvider,
      EMAIL_PROVIDER: 'resend',
      RESEND_FROM: 'AM MARKET <reset@market.example>'
    }, 'valid RESEND_API_KEY'],
    ['an invalid Resend sender', {
      ...noEmailProvider,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_unit_test_key_1234567890',
      RESEND_FROM: 'not an address'
    }, 'RESEND_FROM'],
    ['ambiguous provider credentials', {
      ...noEmailProvider,
      RESEND_API_KEY: 're_unit_test_key_1234567890',
      RESEND_FROM: 'AM MARKET <reset@market.example>',
      SMTP_HOST: 'smtp.example.com'
    }, 'EMAIL_PROVIDER is required'],
    ['partial SMTP authentication', {
      ...noEmailProvider,
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'mailer'
    }, 'must be configured together']
  ])('rejects %s', (_label, overrides, expectedMessage) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/config.js')"], {
      cwd: serverRoot,
      env: productionEnvironment(overrides),
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
  });
});

describe('database TLS CA configuration', () => {
  it('accepts an inline database CA without exposing it on the config object', () => {
    const output = runModule(`
      const { config } = await import('./src/config.js');
      console.log(JSON.stringify({
        ca: config.readDatabaseCa().toString('utf8'),
        exposed: Object.hasOwn(config.db, 'tlsCa')
      }));
    `, productionEnvironment({
      DB_TLS_CA: '-----BEGIN CERTIFICATE-----\\nunit-test-ca\\n-----END CERTIFICATE-----',
      DB_TLS_CA_PATH: ''
    }));

    expect(JSON.parse(output)).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nunit-test-ca\n-----END CERTIFICATE-----\n',
      exposed: false
    });
  });

  it('rejects ambiguous database CA sources', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/config.js')"], {
      cwd: serverRoot,
      env: productionEnvironment({
        DB_TLS_CA: 'inline-ca',
        DB_TLS_CA_PATH: './certs/mysql-ca.pem'
      }),
      encoding: 'utf8'
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Configure only one of DB_TLS_CA or DB_TLS_CA_PATH');
  });
});

describe('local demo login fail-closed configuration', () => {
  const enabled = {
    LOCAL_DEV_LOGIN: 'true',
    LOCAL_DEV_LOGIN_USER_EMAIL: 'demo@local.am-market.test'
  };

  function expectConfigRejection(environment, expectedMessage) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/config.js')"], {
      cwd: serverRoot,
      env: environment,
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
  }

  it('defaults off and allows an explicitly enabled loopback-only development configuration', () => {
    const defaultEnvironment = developmentEnvironment();
    delete defaultEnvironment.LOCAL_DEV_LOGIN;
    delete defaultEnvironment.LOCAL_DEV_LOGIN_USER_EMAIL;

    const defaultOutput = runModule(`
      const { config } = await import('./src/config.js');
      console.log(JSON.stringify(config.auth));
    `, defaultEnvironment);
    expect(JSON.parse(defaultOutput)).toMatchObject({ localDevLoginEnabled: false });

    const enabledOutput = runModule(`
      const { config } = await import('./src/config.js');
      console.log(JSON.stringify(config.auth));
    `, developmentEnvironment(enabled));
    expect(JSON.parse(enabledOutput)).toMatchObject({
      localDevLoginEnabled: true,
      localDevLoginUserEmail: 'demo@local.am-market.test'
    });
  });

  it.each([
    ['production', productionEnvironment(enabled), 'allowed only when NODE_ENV=development'],
    ['test', developmentEnvironment({ ...enabled, NODE_ENV: 'test' }), 'allowed only when NODE_ENV=development'],
    ['a non-loopback bind host', developmentEnvironment({ ...enabled, HOST: '0.0.0.0' }), 'requires loopback application and database hosts'],
    ['a non-loopback application origin', developmentEnvironment({
      ...enabled,
      APP_ORIGIN: 'https://dev.example.test',
      ALLOWED_ORIGINS: 'https://dev.example.test'
    }), 'requires loopback application and database hosts'],
    ['a non-loopback allowed origin', developmentEnvironment({
      ...enabled,
      ALLOWED_ORIGINS: 'https://localhost:3443,https://dev.example.test'
    }), 'requires every allowed origin to use a loopback host'],
    ['an insecure application origin', developmentEnvironment({
      ...enabled,
      APP_ORIGIN: 'http://localhost:3443',
      ALLOWED_ORIGINS: 'http://localhost:3443',
      SESSION_COOKIE_NAME: 'am_session'
    }), 'requires HTTPS application origins'],
    ['an insecure allowed origin', developmentEnvironment({
      ...enabled,
      ALLOWED_ORIGINS: 'https://localhost:3443,http://127.0.0.1:3000'
    }), 'requires HTTPS application origins'],
    ['a non-loopback database', developmentEnvironment({ ...enabled, DB_HOST: 'db.example.test' }), 'requires loopback application and database hosts'],
    ['a trusted proxy', developmentEnvironment({ ...enabled, TRUST_PROXY: '1' }), 'cannot run behind a proxy'],
    ['proxy TLS termination', developmentEnvironment({ ...enabled, TLS_TERMINATED_BY_PROXY: 'true' }), 'cannot run behind a proxy'],
    ['a missing fixed account email', developmentEnvironment({
      LOCAL_DEV_LOGIN: 'true',
      LOCAL_DEV_LOGIN_USER_EMAIL: ''
    }), 'requires LOCAL_DEV_LOGIN_USER_EMAIL'],
    ['a non-reserved account email', developmentEnvironment({
      LOCAL_DEV_LOGIN: 'true',
      LOCAL_DEV_LOGIN_USER_EMAIL: 'customer@example.com'
    }), 'must use the reserved @local.am-market.test domain']
  ])('rejects enablement in %s', (_label, environment, expectedMessage) => {
    expectConfigRejection(environment, expectedMessage);
  });

  it.each([
    ['a non-development process', developmentEnvironment({
      NODE_ENV: 'test',
      LOCAL_DEVELOPMENT_DATABASE_CONFIRMATION: 'am_market'
    }), 'only in development mode'],
    ['a non-loopback database', developmentEnvironment({
      DB_HOST: 'database.example.test',
      LOCAL_DEVELOPMENT_DATABASE_CONFIRMATION: 'am_market'
    }), 'only through a loopback MySQL host']
  ])('prevents direct database attestation from %s', (_label, environment, expectedMessage) => {
    const result = spawnSync(process.execPath, ['scripts/mark-local-development-database.js'], {
      cwd: serverRoot,
      env: environment,
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
  });

  it('maps arbitrary submitted values only to the dedicated demo user', () => {
    const output = runModule(`
      const [{ createApp }, { config }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('./src/config.js'), import('supertest')
      ]);
      const selectedEmails = [];
      const user = {
        id: 41,
        public_id: '00000000-0000-4000-8000-000000000041',
        email: config.auth.localDevLoginUserEmail,
        email_normalized: config.auth.localDevLoginUserEmail,
        display_name: 'AM MARKET Shopper',
        phone_e164: null,
        password_hash: 'not-used-by-demo-login',
        account_kind: 'local_demo',
        status: 'active',
        email_verified_at: null
      };
      const connection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute() { return [{ affectedRows: 1 }, []]; }
      };
      const database = {
        async execute(sql, params = []) {
          if (sql.includes('FROM users')) {
            selectedEmails.push(params[0]);
            return [[user], []];
          }
          throw new Error('Unexpected pool query: ' + sql);
        },
        async getConnection() { return connection; }
      };
      const app = createApp({
        database,
        mailService: { async sendPasswordReset() { return false; } }
      });
      const bootstrap = await request(app).get('/api/v1/auth/session');
      const response = await request(app)
        .post('/api/v1/auth/demo-login')
        .set('Origin', config.appOrigin)
        .set('Cookie', '__Host-am_csrf=' + bootstrap.body.csrfToken)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email: 'completely arbitrary', password: 'x' });
      const strictResponse = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', config.appOrigin)
        .set('Cookie', '__Host-am_csrf=' + bootstrap.body.csrfToken)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email: 'completely arbitrary', password: 'x' });
      const reservedStrictResponse = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', config.appOrigin)
        .set('Cookie', '__Host-am_csrf=' + bootstrap.body.csrfToken)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email: config.auth.localDevLoginUserEmail, password: 'a-valid-length-password' });
      console.log(JSON.stringify({
        status: response.status,
        body: response.body,
        strictStatus: strictResponse.status,
        strictCode: strictResponse.body?.error?.code,
        reservedStrictStatus: reservedStrictResponse.status,
        reservedStrictCode: reservedStrictResponse.body?.error?.code,
        selectedEmails,
        cookies: response.headers['set-cookie'] || []
      }));
    `, developmentEnvironment(enabled));

    const result = JSON.parse(output);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      localDemo: true,
      user: {
        email: 'demo@local.am-market.test',
        displayName: 'AM MARKET Shopper'
      }
    });
    expect(result.selectedEmails).toEqual(['demo@local.am-market.test']);
    expect({ status: result.strictStatus, code: result.strictCode }).toEqual({
      status: 422,
      code: 'VALIDATION_FAILED'
    });
    expect({ status: result.reservedStrictStatus, code: result.reservedStrictCode }).toEqual({
      status: 403,
      code: 'INVALID_CREDENTIALS'
    });
    expect(result.cookies.some((cookie) => cookie.startsWith('__Host-am_session=') && /;\s*HttpOnly(?:;|$)/i.test(cookie))).toBe(true);
  });
});
