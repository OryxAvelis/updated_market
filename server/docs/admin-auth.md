# Administrator authentication

AM MARKET uses a separate administrator identity boundary. Administrator
records live in `admin_identities`, sessions live in `admin_sessions`, and
neither table grants administrator access to a customer record in `users`.

## Provision the first administrator

1. Apply database migrations with `npm run migrate`.
2. From the `server` directory, run `npm run admin:provision` and answer the
   prompts. Password entry is hidden and is requested twice.
3. Alternatively, provide `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `ADMIN_DISPLAY_NAME`, and `ADMIN_ROLE` through the process environment or a
   secret manager, then run `npm run admin:provision`.
4. Remove the provisioning variables from the process environment when the
   command finishes. Never put administrator credentials in Git, an `.env`
   example, a command-line argument, browser storage, or frontend source.

`ADMIN_ROLE` accepts `owner`, `manager`, or `support`. Provisioning is
create-only: an existing identity is never overwritten by this command.

## Runtime boundary

- Open `/admin/login.html` on the same HTTPS origin as the storefront.
- All non-login administrator HTML routes are checked by the server before the
  file is returned.
- The administrator session uses a separate secure, HTTP-only, SameSite=Strict
  cookie. A separate double-submit CSRF token protects state-changing requests.
- Customer cookies and customer database rows cannot satisfy administrator
  authorization.
- The current administration screens keep their existing browser-local
  workspace data behavior. Authentication is server-backed, but migrating
  those workspace records into authoritative server APIs is a separate task.
