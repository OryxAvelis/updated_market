# HTTPS operations

AM MARKET uses two distinct HTTPS configurations:

- Local development terminates TLS in Node with a certificate issued by a private, user-trusted `mkcert` CA.
- Production terminates TLS at Caddy with a publicly trusted ACME certificate and proxies to Node over loopback.

Private keys, local CA material, and real environment files must never be committed. `server/.gitignore` excludes the complete `server/certs/` directory.

## Local trusted certificate

The setup script accepts an explicit `mkcert` executable or discovers it from `PATH` and then `%LOCALAPPDATA%\AMMarket\tools\mkcert.exe`. It fails before certificate generation when the executable is absent. The local CA is stored outside the repository at `%LOCALAPPDATA%\AMMarket\mkcert-ca` by default.

From the repository root:

```powershell
& .\server\scripts\setup-local-https.ps1
```

To use a specific executable:

```powershell
& .\server\scripts\setup-local-https.ps1 -MkcertPath 'C:\path\to\mkcert.exe'
```

The script installs the CA in the current user's trust store and generates:

- `server/certs/localhost.pem`
- `server/certs/localhost-key.pem`

The certificate covers `localhost`, `127.0.0.1`, and `::1`. The script validates its key pair, dates, trust chain, and both required hostnames without printing private material. Existing files are not overwritten unless `-Force` is supplied intentionally for rotation.

Windows can display a **Security Warning** the first time the private CA is installed. Approve it only when you intentionally ran this script and the prompt identifies the mkcert CA for your current Windows account.

Use these development settings:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
HTTP_REDIRECT_PORT=3000
HTTPS_PORT=3443
APP_ORIGIN=https://localhost:3443
ALLOWED_ORIGINS=https://localhost:3443
TLS_CERT_PATH=./certs/localhost.pem
TLS_KEY_PATH=./certs/localhost-key.pem
```

After starting the server, verify the trusted endpoint and redirect:

```powershell
curl.exe --ssl-no-revoke --fail --show-error https://localhost:3443/api/v1/health/ready
curl.exe --head http://localhost:3000/
```

`--ssl-no-revoke` only avoids Windows Schannel's unavailable-revocation-list error for this private development CA; it does not disable CA or hostname verification. Never use `-k`/`--insecure`.

Do not use `curl -k`, disable browser certificate checks, commit the private key, or copy the mkcert root CA/private key into production. Anyone possessing the local CA private key can issue certificates trusted by that user account.

## Production with Caddy and ACME

Copy `server/deploy/Caddyfile.example` to the production host and replace both example email addresses and every occurrence of `market.example.com`. The example provides an explicit port-80 redirect, ACME certificate issuance and renewal, and a reverse proxy to Node at `127.0.0.1:3000`.

Before starting Caddy:

1. Point the domain's A and/or AAAA records at the production host.
2. Allow inbound TCP ports 80 and 443. Both are needed for normal traffic and reliable ACME validation.
3. Bind Node only to loopback on port 3000; do not expose it directly to the internet.
4. Set `APP_ORIGIN` and `ALLOWED_ORIGINS` to the exact public HTTPS origin.
5. Set `TRUST_PROXY=1` so Express trusts only the single Caddy hop when evaluating secure requests and client addresses.
6. Persist and back up Caddy's data directory so its ACME account and certificates survive restarts.
7. Run `caddy validate --config Caddyfile` before reloading the service.

Caddy obtains a publicly trusted certificate automatically. The development CA and certificate are unrelated to production and must not be deployed there.

## HSTS rollout

HSTS affects future browser navigation and can make a broken TLS deployment difficult to recover from. Node owns the HSTS policy in every production topology, including when Caddy terminates TLS. The example Caddy configuration deliberately does not add a second header, preventing duplicate or conflicting policies. The application starts with `HSTS_MAX_AGE_SECONDS=300`, without subdomains or preload.

Use a staged rollout:

1. Confirm certificate issuance, renewal, HTTP redirects, application links, cookies, and every subresource over HTTPS.
2. Start with `HSTS_MAX_AGE_SECONDS=300` and monitor production.
3. Increase the value gradually to one day, one week, and then `31536000` after successful renewal and rollback exercises.
4. Set `HSTS_INCLUDE_SUBDOMAINS=true` only after every current and delegated subdomain supports HTTPS permanently.
5. Set `HSTS_PRELOAD=true` only after meeting browser preload requirements and understanding that removal can take a long time. Configuration validation requires subdomains and at least a one-year max age before preload is accepted.

ACME automation still needs monitoring. Alert on failed renewals and certificate expiration instead of assuming automatic renewal can never fail.
