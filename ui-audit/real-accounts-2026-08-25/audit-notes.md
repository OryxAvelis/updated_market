# AM MARKET real-account UX verification

Date: 2026-08-25

## Overall health

Customer account flow: **Healthy**. The standard storefront now exposes only real sign-in, registration, and password recovery. A customer can shop as a guest, create an account, merge guest shopping, sign out, return with the same credentials, and restore backend-owned data.

## Verified flow

1. **Real sign-in — Healthy**
   - Normal email and password fields, password recovery, and account creation are visible.
   - The local arbitrary-credential presentation no longer appears or overrides the customer form.
   - Evidence: `03-real-login-desktop.png`.

2. **Registration and validation — Healthy**
   - Empty submission produces clear inline errors and focuses the first invalid field.
   - A syntactically valid Gmail account registered through the real API and created one normalized MySQL user row with an Argon2id password hash.
   - Evidence: `04-real-signup-desktop.png`, `05-signup-validation-desktop.png`.

3. **Authenticated settings — Healthy**
   - Profile data and the merged cart were restored from the account.
   - Dark mode and French were saved, survived a full reload, and survived logout/login.
   - The unavailable card option is described honestly without unfinished-product wording.
   - Evidence: `06-authenticated-settings-desktop.png`, `07-authenticated-settings-mobile-dark-fr.png`.

4. **Guest shopping and checkout — Healthy**
   - A signed-out visitor browsed, added a catalogue product, opened the cart, and continued to checkout without a login redirect.
   - Checkout clearly states that no account is required and offers sign-in only as an optional cross-device benefit.
   - Evidence: `08-guest-checkout-mobile-fr.png`.

5. **Cross-device persistence — Healthy (API/MySQL evidence)**
   - The automated MySQL lifecycle test registered multiple unique Gmail accounts, verified normalized uniqueness and Argon2id storage, then restored preferences, an address, cart, and wishlist through a second independent HTTP agent.
   - Both device sessions remained valid until a password change intentionally revoked the other session.
   - Duplicate registration left exactly one user row.

6. **Administrator separation — Healthy boundary**
   - A direct visit to a protected administrator page redirected to the dedicated sign-in screen.
   - Invalid credentials produced clear feedback without exposing whether an identity exists.
   - A disposable-MySQL integration test verified the separate administrator identity, HTTP-only session, CSRF protection, protected-page access, and logout revocation; its temporary identity was removed.
   - Evidence: `09-admin-protected-login.png`.

## Accessibility and UX observations

- Forms expose labels, inline alerts, password visibility controls, loading/disabled behavior, and focused error recovery.
- Desktop login hierarchy remains clear after removing the warning block; signup and recovery are now discoverable again.
- Mobile settings and checkout remain readable with fixed bottom navigation, dark mode, and French localization.
- Screenshot inspection cannot prove full WCAG compliance, screen-reader announcement timing, keyboard order across every page, or real-device browser behavior; those require dedicated assistive-technology and device testing.

## Evidence limits

- Inbox ownership is not verified because email-verification delivery is not implemented.
- Password-reset email delivery depends on production SMTP configuration.
- The exact database lifecycle is covered with temporary QA records that were removed after verification.
- The persistent administrator identity is not provisioned until the owner explicitly authorizes that privileged access change.
