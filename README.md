# AM MARKET

AM MARKET is a customer-facing e-commerce storefront backed by a secure Node.js API and MySQL 8. The existing HTML/CSS/JavaScript experience is preserved, while authenticated customer data is stored server-side and the external AM MARKET catalog remains the source of truth for products, availability, and checkout prices.

## Customer features

- Real registration, login, logout, current-session, password change, and one-time password reset.
- Secure `HttpOnly`, `Secure`, `SameSite=Lax` session cookies with rotation, expiration, CSRF protection, and exact-origin checks.
- Customer profiles, synchronized language/theme/notification preferences, and multiple owned delivery addresses.
- Local guest carts and wishlists plus persistent account versions, with an explicit, non-destructive merge choice after sign-in.
- Genuine guest and authenticated checkout, both server-priced, transactional and idempotent with immutable order/address/product snapshots.
- Order history, cancellation, tracking events, return requests, and customer notifications.
- Product ratings and reviews with ownership enforcement and verified-purchase markers.
- Autocomplete, recent searches, recently viewed products, and personalized recommendations.
- Low-stock subscriptions and transition alerts when the upstream catalog supplies numeric stock quantities.
- Trusted local HTTPS, automatic HTTP-to-HTTPS redirection, production ACME guidance, strict security headers, HSTS in production, and TLS-verified MySQL connections.

## Architecture

The browser calls only the same-origin `/api/v1` service. Account authentication credentials never enter Web Storage. Guest cart/wishlist snapshots and the server-issued, expiring bearer token for the latest guest-order confirmation may be retained in that tab's session storage; the server stores only token and idempotency digests. The backend validates every customer input, derives account ownership from the authenticated session, and requires the separate bearer token for access to a guest order.

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

For automated local-development checks that require the isolated shared test account, first attest the exact local database once. The confirmation must exactly match `MYSQL_DATABASE`; the command refuses non-loopback MySQL hosts and will not replace an existing staging or production attestation.

```powershell
& .\server\scripts\run-migrations.ps1 -CredentialsPath 'C:\path\outside\the\repository\mysql-credentials.env' -MarkLocalDevelopmentDatabase -ConfirmedDatabaseName 'am_market'
```

The customer login page always uses real registration and password authentication. The compatibility test-account endpoint remains API-only, is disabled by standard startup, and can be enabled only for loopback development with the database attestation. The regular `/auth/login` endpoint always verifies the stored password hash.

```powershell
& .\server\scripts\run-local.ps1 -CredentialsPath 'C:\path\outside\the\repository\mysql-credentials.env' -EnableLocalDemoLogin
```

The isolated test account is immutably marked and persists only in the attested local MySQL database. Provisioning fails instead of taking over an existing customer at its reserved address. Do not attest a production/shared database, enable this capability in production, or use it for customer authentication.

A plain static preview can still browse the public product and category catalog: customer pages try the same-origin `/api/v1/catalog` proxy first, then fall back to the allowlisted read-only `https://api.mmarket.ma/api` catalog when that route is unavailable. Guest order creation, registration, authenticated carts, checkout, orders, reviews, and other database-backed features require the Node application, so use `https://localhost:3443` for full end-to-end development.

## Password-reset email

Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `RESEND_FROM` through the deployment secret manager to deliver password resets over Resend's HTTPS API. The sender must use a domain verified in the Resend account. Self-hosted environments can instead set `EMAIL_PROVIDER=smtp` and the `SMTP_*` variables described in `server/.env.example`. Configure only one provider.

A reset request always returns the same generic response. Tokens are random, short-lived, stored only as digests, usable once, and revoked if delivery times out, is rejected, or otherwise fails. Without a configured provider the route remains safe, but no email can be delivered. API keys, SMTP passwords, and sender-domain credentials must never be committed or logged.

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

The separate migration regression creates and drops its own randomized database, so it needs an explicitly enabled disposable MySQL administrator connection:

```powershell
$env:TEST_USE_DISPOSABLE_MIGRATION_DATABASE = 'true'
$env:TEST_MYSQL_ADMIN_HOST = '127.0.0.1'
$env:TEST_MYSQL_ADMIN_PORT = '3306'
$env:TEST_MYSQL_ADMIN_USER = 'disposable_test_admin'
$env:TEST_MYSQL_ADMIN_PASSWORD = 'read-from-an-external-secret'
$env:TEST_MYSQL_ADMIN_TLS_CA_PATH = 'C:\path\outside\the\repository\mysql-ca.pem'
$env:TEST_MYSQL_ADMIN_TLS_SERVERNAME = 'localhost' # optional; defaults to localhost
npm run test:integration -- payment-preference-migration.mysql.test.js
```

Use only a disposable server/account with `CREATE DATABASE` and `DROP DATABASE`; do not use production or a shared database. See `server/docs/database.md` for the runner's guarded database naming and crash-recovery behavior.

## Production deployment

Use `server/deploy/Caddyfile.example` as the TLS edge template and follow `server/docs/https.md`. Store all credentials in the host secret manager, run migrations with the migration account, run the app with the least-privilege account, bind Node to loopback behind Caddy, validate certificate renewal, and stage HSTS carefully.

`/api/v1/health/ready` fails closed unless MySQL is TLS-encrypted and every migration shipped with the deployed build is an exact checksum-matching prefix of `schema_migrations`. Valid trailing migrations from a newer build are accepted for rolling-deploy and rollback compatibility; each migration must remain backward compatible until older instances drain. Apply migrations before shifting traffic, and do not grant DDL privileges to the runtime application account.

### Free Render and Aiven preview

The repository-level `render.yaml` deploys the existing Node.js storefront as one free Render web service in Frankfurt. Render supplies the public HTTPS origin and port at runtime; the application trusts exactly one Render proxy hop and keeps `Secure`, `HttpOnly` authentication cookies enabled. The in-process low-stock evaluator is enabled while the free instance is awake; evaluation pauses whenever Render sleeps the service and resumes after it wakes.

Use an external Aiven for MySQL service and enter its host, port, application password, migration username/password, and TLS hostname only when Render prompts for the `sync: false` variables. Upload Aiven's CA certificate as the Render secret file `aiven-ca.pem`; it is exposed only at `/etc/secrets/aiven-ca.pem` and is never committed. The free-service start wrapper applies migrations under the database advisory lock with the separate migration account, removes those higher-privilege variables from the long-running Node process, and then starts the application with the restricted `DB_USER`. Grant the migration account only the privileges listed in `server/docs/database.md`, including `TRIGGER`; keep that trigger-definer account present with the DML privileges its triggers use, and never use the database root account.

Render derives `APP_ORIGIN`, `ALLOWED_ORIGINS`, and `PASSWORD_RESET_URL` from its trusted `RENDER_EXTERNAL_URL`. If a custom domain is added later, set those three variables explicitly to the custom HTTPS origin. The blueprint uses the built-in Resend HTTPS adapter because Render free services block SMTP ports. When Render prompts, provide a sending-only `RESEND_API_KEY` and a `RESEND_FROM` sender on a verified domain; both values remain outside Git.

### Free Back4App and Aiven preview

The repository-level `Dockerfile` packages the same full-stack storefront for Back4App Web Deployment. It runs as the unprivileged `node` user, listens on port `8080`, trusts one HTTPS proxy hop, checks server JavaScript during the image build, and applies migrations with the separate migration account before starting the restricted runtime process.

Back4App does not provide a secret-file mount like Render. Store Aiven's PEM certificate in the deployment secret manager as multiline `DB_TLS_CA`; alternatively, an escaped value containing `\\n` line separators is accepted. Configure `DB_TLS_CA` or `DB_TLS_CA_PATH`, never both. Set `APP_ORIGIN`, `ALLOWED_ORIGINS`, and `PASSWORD_RESET_URL` to the HTTPS `b4a.run` origin assigned at first deployment. The container enables `BACK4APP_DYNAMIC_ORIGIN` because free preview hosts can rotate: only an HTTPS request whose `Origin` exactly matches its current `*.b4a.run` request host is accepted, and password-reset links use that same verified host. Custom domains and other hosts still require the exact configured origin. Keep all database passwords, the inline CA, and the fulfillment secret outside Git.

Database details and invariants are documented in `server/docs/database.md`.

## External-service boundaries

- Card entry is disabled until a PCI-compliant payment provider is connected; the application never collects card details itself.
- Guest order detail and tracking require the server-issued token retained by the current tab and remain available only until its configured expiry (30 days by default); closing the tab can end local access sooner. Guest cancellation, returns and cross-device history require a customer account or support workflow.
- Password-reset delivery requires a configured HTTPS email provider on Render (or SMTP credentials on a host that permits SMTP).
- Finite inventory reservation and low-stock evaluation are exact only when the upstream product payload includes `stock_quantity`; availability-only products remain orderable but cannot have a mathematical oversell guarantee without an upstream quantity.
- Carrier-specific tracking locations and delivery progress require the configured fulfillment integration to send authenticated status updates.
