import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(sourceDir, '..');
export const storefrontRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: process.env.ENV_FILE || path.join(serverRoot, '.env'), quiet: true });

const renderOrigin = process.env.RENDER === 'true' && process.env.RENDER_EXTERNAL_URL
  ? process.env.RENDER_EXTERNAL_URL
  : undefined;
const defaultAppOrigin = renderOrigin || 'https://localhost:3443';
const defaultResetUrl = `${defaultAppOrigin.replace(/\/$/, '')}/reset-password.html`;
const renderDefaultsEnabled = Boolean(renderOrigin);

const boolValue = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return value;
}, z.boolean());

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional()
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional()
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default(renderDefaultsEnabled ? '0.0.0.0' : '127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HTTPS_PORT: z.coerce.number().int().min(1).max(65535).default(3443),
  APP_ORIGIN: z.string().url().default(defaultAppOrigin),
  ALLOWED_ORIGINS: z.string().default(defaultAppOrigin),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(renderDefaultsEnabled ? 1 : 0),
  TLS_TERMINATED_BY_PROXY: boolValue.default(renderDefaultsEnabled),
  HSTS_MAX_AGE_SECONDS: z.coerce.number().int().min(0).max(63072000).default(300),
  HSTS_INCLUDE_SUBDOMAINS: boolValue.default(false),
  HSTS_PRELOAD: boolValue.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TLS_CERT_PATH: optionalText,
  TLS_KEY_PATH: optionalText,
  HTTP_REDIRECT_PORT: z.coerce.number().int().min(1).max(65535).optional(),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default('am_market'),
  DB_USER: z.string().min(1).default('am_market_app'),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  DB_TLS: boolValue.default(true),
  DB_TLS_CA_PATH: optionalText,
  DB_TLS_SERVERNAME: optionalText,

  SESSION_COOKIE_NAME: z.string().min(1).default('__Host-am_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(20),
  PASSWORD_RESET_URL: z.string().url().default(defaultResetUrl),
  LOCAL_DEV_LOGIN: boolValue.default(false),
  LOCAL_DEV_LOGIN_USER_EMAIL: optionalEmail,

  GUEST_CHECKOUT_CREDENTIAL_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  GUEST_ORDER_ACCESS_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  GUEST_CHECKOUT_LEASE_SECONDS: z.coerce.number().int().min(10).max(120).default(30),
  GUEST_CHECKOUT_WAIT_MS: z.coerce.number().int().min(250).max(30000).default(10000),

  CATALOG_API_ORIGIN: z.string().url().default('https://api.mmarket.ma'),
  CATALOG_API_BASE_URL: z.string().url().default('https://api.mmarket.ma/api'),
  CATALOG_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(8000),
  CATALOG_CACHE_TTL_MS: z.coerce.number().int().min(0).max(3600000).default(60000),

  LOW_STOCK_EVALUATOR_ENABLED: boolValue.default(!renderDefaultsEnabled),
  LOW_STOCK_EVALUATOR_INTERVAL_MS: z.coerce.number().int().min(30000).max(86400000).default(300000),
  LOW_STOCK_EVALUATOR_RUN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
  LOW_STOCK_EVALUATOR_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  LOW_STOCK_EVALUATOR_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  LOW_STOCK_DEFAULT_THRESHOLD: z.coerce.number().int().min(1).max(1000).default(5),
  LOW_STOCK_NOTIFICATION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  SMTP_HOST: optionalText,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: boolValue.default(false),
  SMTP_USER: optionalText,
  SMTP_PASSWORD: optionalText,
  SMTP_FROM: z.string().min(3).default('AM MARKET <no-reply@example.com>'),

  FULFILLMENT_WEBHOOK_SECRET: optionalText,
  FULFILLMENT_WEBHOOK_SECRET_FILE: optionalText,
  FULFILLMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(900).default(300)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid server configuration: ${details}`);
}

const env = parsed.data;
const appUrl = new URL(env.APP_ORIGIN);
const isTest = env.NODE_ENV === 'test';
const isProduction = env.NODE_ENV === 'production';
const secureCookies = appUrl.protocol === 'https:' && !isTest;
const allowedOrigins = new Set(env.ALLOWED_ORIGINS.split(',').map((item) => new URL(item.trim()).origin));

function isLoopbackHost(value) {
  return new Set(['127.0.0.1', '::1', '[::1]', 'localhost']).has(String(value || '').trim().toLowerCase());
}

if (isProduction && appUrl.protocol !== 'https:') {
  throw new Error('APP_ORIGIN must use HTTPS in production.');
}
if (isProduction && [...allowedOrigins].some((origin) => new URL(origin).protocol !== 'https:')) {
  throw new Error('Every ALLOWED_ORIGINS entry must use HTTPS in production.');
}
if (!allowedOrigins.has(appUrl.origin)) {
  throw new Error('ALLOWED_ORIGINS must include APP_ORIGIN.');
}
if (isProduction && !env.DB_TLS) {
  throw new Error('DB_TLS must remain enabled in production.');
}
if (isProduction && !env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is required in production.');
}
if (isProduction && new URL(env.PASSWORD_RESET_URL).protocol !== 'https:') {
  throw new Error('PASSWORD_RESET_URL must use HTTPS in production.');
}
if (isProduction && env.TLS_TERMINATED_BY_PROXY && env.TRUST_PROXY < 1) {
  throw new Error('TRUST_PROXY must identify the trusted TLS proxy in production.');
}
if (env.HSTS_PRELOAD && (!env.HSTS_INCLUDE_SUBDOMAINS || env.HSTS_MAX_AGE_SECONDS < 31536000)) {
  throw new Error('HSTS_PRELOAD requires HSTS_INCLUDE_SUBDOMAINS=true and HSTS_MAX_AGE_SECONDS of at least 31536000.');
}
if (env.SESSION_COOKIE_NAME.startsWith('__Host-') && !secureCookies && !isTest) {
  throw new Error('__Host- cookies require an HTTPS APP_ORIGIN.');
}
if (env.LOCAL_DEV_LOGIN) {
  if (env.NODE_ENV !== 'development') {
    throw new Error('LOCAL_DEV_LOGIN is allowed only when NODE_ENV=development.');
  }
  if (!env.LOCAL_DEV_LOGIN_USER_EMAIL) {
    throw new Error('LOCAL_DEV_LOGIN requires LOCAL_DEV_LOGIN_USER_EMAIL.');
  }
  if (!env.LOCAL_DEV_LOGIN_USER_EMAIL.endsWith('@local.am-market.test')) {
    throw new Error('LOCAL_DEV_LOGIN_USER_EMAIL must use the reserved @local.am-market.test domain.');
  }
  if (appUrl.protocol !== 'https:' || [...allowedOrigins].some((origin) => new URL(origin).protocol !== 'https:')) {
    throw new Error('LOCAL_DEV_LOGIN requires HTTPS application origins.');
  }
  if (!isLoopbackHost(env.HOST) || !isLoopbackHost(appUrl.hostname) || !isLoopbackHost(env.DB_HOST)) {
    throw new Error('LOCAL_DEV_LOGIN requires loopback application and database hosts.');
  }
  if ([...allowedOrigins].some((origin) => !isLoopbackHost(new URL(origin).hostname))) {
    throw new Error('LOCAL_DEV_LOGIN requires every allowed origin to use a loopback host.');
  }
  if (env.TRUST_PROXY !== 0 || env.TLS_TERMINATED_BY_PROXY) {
    throw new Error('LOCAL_DEV_LOGIN cannot run behind a proxy.');
  }
}

function resolveOptionalPath(value) {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.resolve(serverRoot, value);
}

function readSecretFile(value, label) {
  const resolved = resolveOptionalPath(value);
  if (!resolved) return undefined;
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    throw new Error(`${label} could not be read at ${resolved}: ${error.message}`);
  }
}

function readTextSecretFile(value, label) {
  const contents = readSecretFile(value, label);
  return contents?.toString('utf8').trim();
}

if (env.FULFILLMENT_WEBHOOK_SECRET && env.FULFILLMENT_WEBHOOK_SECRET_FILE) {
  throw new Error('Configure only one of FULFILLMENT_WEBHOOK_SECRET or FULFILLMENT_WEBHOOK_SECRET_FILE.');
}
const fulfillmentWebhookSecret = env.FULFILLMENT_WEBHOOK_SECRET ||
  readTextSecretFile(env.FULFILLMENT_WEBHOOK_SECRET_FILE, 'Fulfillment webhook secret');
if (fulfillmentWebhookSecret && Buffer.byteLength(fulfillmentWebhookSecret, 'utf8') < 32) {
  throw new Error('The fulfillment webhook secret must contain at least 32 bytes.');
}
if (isProduction && !fulfillmentWebhookSecret) {
  throw new Error('A fulfillment webhook secret is required in production.');
}

export const config = Object.freeze({
  env: env.NODE_ENV,
  isTest,
  isProduction,
  host: env.HOST,
  httpPort: env.HTTP_REDIRECT_PORT ?? env.PORT,
  httpsPort: env.HTTPS_PORT,
  appOrigin: appUrl.origin,
  allowedOrigins,
  trustProxy: env.TRUST_PROXY,
  tlsTerminatedByProxy: env.TLS_TERMINATED_BY_PROXY,
  hsts: {
    maxAge: env.HSTS_MAX_AGE_SECONDS,
    includeSubDomains: env.HSTS_INCLUDE_SUBDOMAINS,
    preload: env.HSTS_PRELOAD
  },
  logLevel: env.LOG_LEVEL,
  tls: {
    certPath: resolveOptionalPath(env.TLS_CERT_PATH),
    keyPath: resolveOptionalPath(env.TLS_KEY_PATH)
  },
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    tls: env.DB_TLS,
    tlsCaPath: resolveOptionalPath(env.DB_TLS_CA_PATH),
    tlsServername: env.DB_TLS_SERVERNAME
  },
  auth: {
    cookieName: isTest && env.SESSION_COOKIE_NAME.startsWith('__Host-') ? 'am_session' : env.SESSION_COOKIE_NAME,
    secureCookies,
    sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    sessionIdleMs: env.SESSION_IDLE_HOURS * 60 * 60 * 1000,
    resetTtlMs: env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
    resetUrl: env.PASSWORD_RESET_URL,
    localDevLoginEnabled: env.LOCAL_DEV_LOGIN,
    localDevLoginUserEmail: env.LOCAL_DEV_LOGIN_USER_EMAIL
  },
  guestCheckout: {
    credentialTtlMs: env.GUEST_CHECKOUT_CREDENTIAL_TTL_MINUTES * 60 * 1000,
    orderAccessTtlMs: env.GUEST_ORDER_ACCESS_TTL_DAYS * 24 * 60 * 60 * 1000,
    leaseMs: env.GUEST_CHECKOUT_LEASE_SECONDS * 1000,
    waitMs: env.GUEST_CHECKOUT_WAIT_MS
  },
  catalog: {
    origin: new URL(env.CATALOG_API_ORIGIN).origin,
    baseUrl: env.CATALOG_API_BASE_URL.replace(/\/$/, ''),
    timeoutMs: env.CATALOG_TIMEOUT_MS,
    cacheTtlMs: env.CATALOG_CACHE_TTL_MS
  },
  lowStock: {
    enabled: env.LOW_STOCK_EVALUATOR_ENABLED,
    intervalMs: env.LOW_STOCK_EVALUATOR_INTERVAL_MS,
    runTimeoutMs: env.LOW_STOCK_EVALUATOR_RUN_TIMEOUT_MS,
    batchSize: env.LOW_STOCK_EVALUATOR_BATCH_SIZE,
    concurrency: env.LOW_STOCK_EVALUATOR_CONCURRENCY,
    defaultThreshold: env.LOW_STOCK_DEFAULT_THRESHOLD,
    notificationTtlDays: env.LOW_STOCK_NOTIFICATION_TTL_DAYS
  },
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM
  },
  fulfillment: {
    toleranceMs: env.FULFILLMENT_WEBHOOK_TOLERANCE_SECONDS * 1000,
    configured: Boolean(fulfillmentWebhookSecret)
  },
  readTlsCertificate: () => readSecretFile(env.TLS_CERT_PATH, 'TLS certificate'),
  readTlsPrivateKey: () => readSecretFile(env.TLS_KEY_PATH, 'TLS private key'),
  readDatabaseCa: () => readSecretFile(env.DB_TLS_CA_PATH, 'MySQL CA certificate'),
  readFulfillmentWebhookSecret: () => fulfillmentWebhookSecret
});
