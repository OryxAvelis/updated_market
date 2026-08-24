# AM MARKET

AM MARKET is a customer-facing e-commerce storefront backed by a secure Node.js API and MySQL 8. The existing HTML/CSS/JavaScript experience is preserved, while authenticated customer data is stored server-side and the external AM MARKET catalog remains the source of truth for products, availability, and checkout prices.

## Customer features

- Real registration, login, logout, current-session, password change, and one-time password reset.
- Secure `HttpOnly`, `Secure`, `SameSite=Lax` session cookies with rotation, expiration, CSRF protection, and exact-origin checks.
- Customer profiles, synchronized language/theme/notification preferences, and multiple owned delivery addresses.
- Persistent authenticated carts and wishlists, with safe guest-cart/wishlist merge after sign-in.
- Server-priced, transactional, idempotent checkout with immutable order/address/product snapshots.
- Order history, cancellation, tracking events, return requests, and customer notifications.
- Product ratings and reviews with ownership enforcement and verified-purchase markers.
- Autocomplete, recent searches, recently viewed products, and personalized recommendations.
- Low-stock subscriptions and transition alerts when the upstream catalog supplies numeric stock quantities.
- Trusted local HTTPS, automatic HTTP-to-HTTPS redirection, production ACME guidance, strict security headers, HSTS in production, and TLS-verified MySQL connections.

## Architecture

The browser calls only the same-origin `/api/v1` service. Authentication credentials never enter Web Storage; only guest cart/wishlist product IDs and non-sensitive display preferences may be cached locally. The backend validates every customer input and derives ownership from the authenticated session.

The MySQL schema and migrations are in `server/src/db/migrations/`. It covers users, preferences, addresses, sessions, password resets, cart, wishlist, orders, tracking, cancellations, returns, reviews, activity history, notifications, low-stock subscriptions, recommendations, and outbox events.

## Local prerequisites

- Node.js 22 or newer
- MySQL 8.0 or newer
- A database server certificate trusted through an explicit CA file
- `mkcert` for the locally trusted browser certificate

Install the backend dependencies:

```powershell
Set-Location .\server
npm ci
Set-Location ..
```

Create an external credential file outside the repository. `run-local.ps1` expects the application account keys below; `run-migrations.ps1` additionally expects a separate DDL-capable migration account:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=am_market
MYSQL_USER=am_market_app
MYSQL_PASSWORD=replace-with-a-long-random-password
MYSQL_MIGRATION_USER=am_market_migrator
MYSQL_MIGRATION_PASSWORD=replace-with-a-different-long-random-password
MYSQL_SSL_CA=C:\path\outside\the\repository\mysql-ca.pem
```

Do not put real passwords, `.env` files, private keys, CA private material, or generated certificates in Git.

Generate and trust the local HTTPS certificate, apply migrations, and start the storefront:

```powershell
& .\server\scripts\setup-local-https.ps1
& .\server\scripts\run-migrations.ps1 -CredentialsPath 'C:\path\outside\the\repository\mysql-credentials.env'
& .\server\scripts\run-local.ps1 -CredentialsPath 'C:\path\outside\the\repository\mysql-credentials.env'
```

Open [https://localhost:3443](https://localhost:3443). Requests to `http://localhost:3000` are redirected with HTTP 308. The backend intentionally serves only the allowlisted customer pages and static asset directories.

A plain static preview can still browse the public product and category catalog: customer pages try the same-origin `/api/v1/catalog` proxy first, then fall back to the allowlisted read-only `https://api.mmarket.ma/api` catalog when that route is unavailable. Registration, authenticated carts, checkout, orders, reviews, and other account features still require the Node application, so use `https://localhost:3443` for full end-to-end development.

## Password-reset email

Set the `SMTP_*` variables described in `server/.env.example` through the deployment secret manager. A reset request always returns the same generic response. Tokens are random, short-lived, stored only as digests, usable once, and revoked if delivery fails. Without SMTP credentials the reset route remains safe, but no email can be delivered.

## Tests

From `server/`:

```powershell
npm run check
npm test
```

The real-MySQL integration suite is opt-in and must use a dedicated disposable test database:

```powershell
$env:TEST_USE_DATABASE = 'true'
$env:NODE_ENV = 'test'
npm run test:integration
```

Set the documented `DB_*`, TLS, `APP_ORIGIN`, and `ALLOWED_ORIGINS` variables first. The suite applies migrations and removes only its randomized test fixtures; never point it at production or a shared database.

## Production deployment

Use `server/deploy/Caddyfile.example` as the TLS edge template and follow `server/docs/https.md`. Store all credentials in the host secret manager, run migrations with the migration account, run the app with the least-privilege account, bind Node to loopback behind Caddy, validate certificate renewal, and stage HSTS carefully.

Database details and invariants are documented in `server/docs/database.md`.

## External-service boundaries

- Card entry is disabled until a PCI-compliant payment provider is connected; the application never collects card details itself.
- Password-reset delivery requires production SMTP credentials.
- Low-stock evaluation is exact only when the upstream product payload includes `stock_quantity`.
- Carrier-specific tracking locations and delivery progress require the configured fulfillment integration to send authenticated status updates.
