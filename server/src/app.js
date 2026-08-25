import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createAdminAuthRouter } from './admin/routes.js';
import { requireAdminCsrf } from './admin/csrf.js';
import { loadAdminSession, requireAdminPage } from './admin/session.js';
import { createAccountRouter } from './account/routes.js';
import { createAuthRouter } from './auth/routes.js';
import { loadSession } from './auth/session.js';
import { createCatalogRouter } from './catalog/routes.js';
import { createCatalogService } from './catalog/service.js';
import { createCartRouter } from './commerce/cart-routes.js';
import { createWishlistRouter } from './commerce/wishlist-routes.js';
import { config, storefrontRoot } from './config.js';
import {
  createHistoryRouter,
  createMeReviewsRouter,
  createNotificationsRouter,
  createProductReviewsRouter,
  createRecommendationsRouter,
  createReviewsRouter,
  createSearchSuggestionsRouter
} from './engagement/routes.js';
import { createLowStockSubscriptionsRouter } from './engagement/low-stock.js';
import { createHealthRouter } from './health/routes.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import { forbidden } from './http/errors.js';
import { createFulfillmentRouter } from './integrations/fulfillment-routes.js';
import { logger } from './logger.js';
import { createGuestOrdersRouter } from './orders/guest-routes.js';
import { createOrdersRouter, createReturnsRouter } from './orders/routes.js';
import { requireCsrf } from './security/csrf.js';
import { requireTrustedOrigin } from './security/origin.js';

const userPages = new Set([
  'index.html', 'all-categories.html', 'categories.html', 'product.html',
  'cart.html', 'checkout.html', 'wishlist.html', 'orders.html',
  'settings.html', 'help.html', 'login.html', 'reset-password.html'
]);
const adminPages = new Set([
  'index.html', 'analytics.html', 'categories.html', 'customers.html',
  'delivery.html', 'inventory.html', 'orders.html', 'products.html',
  'promotions.html', 'settings.html'
]);
const publicCatalogFallbackOrigin = 'https://api.mmarket.ma';

function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", publicCatalogFallbackOrigin],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
        // The storefront is HTTPS in local development as well as production.
        // Upgrade catalog-provided image URLs too, so one legacy HTTP asset
        // cannot downgrade the browser's security indicator.
        upgradeInsecureRequests: []
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    // Node is the single HSTS owner in every production topology. Keeping the
    // policy here also covers TLS proxies that do not add transport headers and
    // avoids conflicting duplicate values at the edge.
    hsts: config.isProduction
      ? config.hsts
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' }
  });
}

function exactCors(req, callback) {
  const origin = req.get('origin');
  if (!origin) return callback(null, { origin: false });
  if (!config.allowedOrigins.has(origin)) return callback(null, { origin: false });
  return callback(null, {
    origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Guest-Order-Token'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600
  });
}

function requireJsonForBody(req, _res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      Number(req.get('content-length') || 0) > 0 && !req.is('application/json')) {
    return next(forbidden('CONTENT_TYPE_REJECTED', 'Requests with a body must use application/json.'));
  }
  return next();
}

function enforceProxyHttps(req, res, next) {
  if (!config.isProduction || !config.tlsTerminatedByProxy || req.secure) return next();
  // Keep the configured origin authoritative. Passing a scheme-relative
  // request target (//host/path) to the URL constructor would otherwise allow
  // an attacker-controlled redirect host.
  const requestTarget = String(req.originalUrl || '/').replace(/[\r\n]/g, '');
  const relativeTarget = requestTarget.startsWith('/') ? requestTarget : `/${requestTarget}`;
  return res.redirect(308, `${config.appOrigin}${relativeTarget}`);
}

function staticAssets(app) {
  const options = {
    dotfiles: 'deny',
    fallthrough: false,
    // The storefront currently serves stable, unversioned filenames such as
    // core.js and common.css. Marking those URLs immutable can leave customers
    // on an old UI for a full deployment cycle, so always revalidate them and
    // let ETags make unchanged responses inexpensive.
    immutable: false,
    maxAge: 0,
    index: false
  };
  app.use('/css', express.static(path.join(storefrontRoot, 'css'), options));
  app.use('/js', express.static(path.join(storefrontRoot, 'js'), options));
  app.use('/img', express.static(path.join(storefrontRoot, 'img'), options));
  app.get('/', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(storefrontRoot, 'index.html')));
  app.get('/:page', (req, res, next) => {
    if (!userPages.has(req.params.page)) return next();
    if (req.params.page === 'reset-password.html') res.set('Referrer-Policy', 'no-referrer');
    return res.set('Cache-Control', 'no-cache').sendFile(path.join(storefrontRoot, req.params.page));
  });
}

function adminAssets(app) {
  const options = {
    dotfiles: 'deny',
    fallthrough: false,
    immutable: false,
    maxAge: 0,
    index: false
  };
  const adminRoot = path.join(storefrontRoot, 'admin');
  app.use('/admin/css', express.static(path.join(adminRoot, 'css'), options));
  app.use('/admin/js', express.static(path.join(adminRoot, 'js'), options));
  app.get('/admin/login.html', (_req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(path.join(adminRoot, 'login.html'));
  });
  app.get('/admin', loadAdminSession, requireAdminPage, (_req, res) => {
    res.redirect(302, '/admin/index.html');
  });
  app.get('/admin/:page', loadAdminSession, (req, res, next) => {
    if (!adminPages.has(req.params.page)) return next();
    return requireAdminPage(req, res, () => {
      res.set('Cache-Control', 'no-store').sendFile(path.join(adminRoot, req.params.page));
    });
  });
}

export function createApp({
  database,
  catalog = createCatalogService(),
  mailService,
  fulfillmentWebhookSecret = config.readFulfillmentWebhookSecret()
} = {}) {
  if (!database) throw new Error('createApp requires a database pool.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.locals.db = database;
  app.locals.catalog = catalog;

  app.use(pinoHttp({
    logger,
    genReqId(req, res) {
      const existing = req.headers['x-request-id'];
      const id = typeof existing === 'string' && /^[A-Za-z0-9._-]{8,100}$/.test(existing) ? existing : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token', 'req.headers.idempotency-key', 'req.headers.x-guest-order-token', 'req.headers.x-am-fulfillment-signature', 'res.headers.set-cookie', 'req.body.email', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.token']
  }));
  app.use(securityHeaders());
  app.use(enforceProxyHttps);
  app.use(cors(exactCors));
  // This server-to-server route verifies the exact raw body with HMAC. It is
  // intentionally mounted before browser session/origin/CSRF middleware.
  app.use('/api/v1/integrations/fulfillment', createFulfillmentRouter({
    secret: fulfillmentWebhookSecret,
    toleranceMs: config.fulfillment.toleranceMs
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(requireJsonForBody);
  app.use('/api/v1/admin', requireTrustedOrigin, loadAdminSession, requireAdminCsrf, createAdminAuthRouter());
  app.use('/api/v1', requireTrustedOrigin, loadSession, requireCsrf);

  app.use('/api/v1/health', createHealthRouter());
  app.use('/api/v1/auth', createAuthRouter({ mailService }));
  app.use('/api/v1/me', createAccountRouter());
  app.use('/api/v1/me/low-stock-subscriptions', createLowStockSubscriptionsRouter(catalog));
  app.use('/api/v1/cart', createCartRouter(catalog));
  app.use('/api/v1/wishlist', createWishlistRouter(catalog));
  app.use('/api/v1/guest-orders', createGuestOrdersRouter(catalog, { database }));
  app.use('/api/v1/orders', createOrdersRouter(catalog));
  app.use('/api/v1/returns', createReturnsRouter());
  app.use('/api/v1/catalog/products/:productId/reviews', createProductReviewsRouter(catalog));
  app.use('/api/v1/reviews', createReviewsRouter());
  app.use('/api/v1/me/reviews', createMeReviewsRouter());
  app.use('/api/v1/me', createHistoryRouter(catalog));
  app.use('/api/v1/catalog/search/suggestions', createSearchSuggestionsRouter(catalog));
  app.use('/api/v1/notifications', createNotificationsRouter());
  app.use('/api/v1/me/recommendations', createRecommendationsRouter(catalog));
  app.use('/api/v1/catalog', createCatalogRouter(catalog));

  staticAssets(app);
  adminAssets(app);
  app.use('/api', notFoundHandler);
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use(errorHandler);
  return app;
}
