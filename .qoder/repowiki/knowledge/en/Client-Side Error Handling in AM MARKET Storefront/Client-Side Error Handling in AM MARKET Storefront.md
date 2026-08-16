---
kind: error_handling
name: Client-Side Error Handling in AM MARKET Storefront
category: error_handling
scope:
    - '**'
source_files:
    - js/app.js
    - js/i18n.js
    - login.html
---

## Overview

AM MARKET is a pure client-side storefront (no backend framework) built with vanilla JavaScript, Bootstrap 5, and FontAwesome. Error handling is implemented entirely in the browser using native `try/catch`, `fetch` response checks, DOM-level fallbacks, and localized user-facing messages via an i18n module.

There are no custom error classes, no centralized error middleware, no `throw`-based error propagation chains, and no `panic/recover` equivalents. Errors are handled locally at the point of failure.

## Network / API Errors

The three data-fetching functions (`fetchCategories`, `fetchProducts`, `fetchProduct`) in `js/app.js` follow a consistent pattern:

- Call `fetch()` against `https://api.mmarket.ma/api`.
- Check `res.ok`; if false, `throw new Error('...')` with a short string message (`'Categories failed'`, `'Products failed'`, `'Product not found'`).
- The caller wraps each call in its own `try/catch` block and renders a localized error UI into the target container instead of bubbling the exception up.

Examples:
- `renderHomeProducts` catches network errors and replaces the product grid with `<div class="col-12 text-center text-danger py-4">${t('failed_load')}</div>`.
- `loadShopPage` does the same for paginated shop loads.
- `openDetail` catches a missing product and shows `${t('product_not_found')}`.
- `loadRelated` silently swallows errors by catching and hiding the related-products section.

For image loading failures, HTML `onerror` handlers swap broken images to a placeholder URL (`https://via.placeholder.com/...`), which is a DOM-level fallback rather than a JS error path.

## LocalStorage Errors

Persistence reads in `loadLS` and `getRecent` wrap `localStorage.getItem` + `JSON.parse` in `try/catch` blocks that fall back to empty arrays. This treats corrupted or missing storage as a non-fatal condition — the app continues without cart/wishlist/orders data.

## Form Validation Errors

On `login.html`, validation is synchronous and inline:
- A `validEmail` regex helper checks email format.
- `markError(wrapId, bad)` toggles an `.error` CSS class on the input wrapper; the CSS (in `css/login.css`) presumably styles it red.
- If any field fails, `toast(t('check_creds'))` or `toast(t('fill_correct'))` displays a Bootstrap toast with the localized message.
- On success, `setLoading(btn, true)` disables the button, swaps its innerHTML to a spinner + `t('please_wait')`, then restores it after a simulated async delay.

There is no server-side validation because login/signup are fully client-side simulations (they use `setTimeout` to fake network latency).

## User-Facing Error Messages

All user-visible error strings are localized through `i18n.js`. Key keys used for error states include:
- `failed_load` — "Failed to load products" / "Échec du chargement des produits"
- `api_error` — "Could not load data from API. Check your connection." / "Impossible de charger les données. Vérifiez votre connexion."
- `product_not_found` — "Product not found" / "Produit introuvable"
- `fill_all` / `fill_correct` — form validation prompts
- `check_creds` — invalid credentials prompt
- `order_ok` / `added_cart` / `removed` / `added_wish` / `removed_wish` — success toasts

These are rendered via the `t(key, vars)` function, which falls back to English if the current language key is missing, and falls back to the raw key if neither exists.

## Toast Notifications

A shared `toast(msg)` helper (defined in both `app.js` and `login.html`) uses Bootstrap's `Toast` component to show transient feedback. It is used for both success and error notifications (e.g., `toast(t('added_cart'))`, `toast(t('check_creds'))`). There is no distinction between success/error toast types — styling is uniform.

## Conventions Observed

1. **Fail-fast on network errors**: `fetch` responses with `!res.ok` immediately throw a descriptive `Error` string; callers never inspect status codes themselves.
2. **Local catch-and-render**: Every async operation that touches the DOM has a `try/catch` that replaces the target element with a localized error message — exceptions are never propagated to global handlers.
3. **Graceful degradation for storage**: Corrupted `localStorage` entries are treated as empty data, not fatal crashes.
4. **Silent failures for non-critical sections**: `loadRelated` catches and hides itself on error, so a single failed related-product fetch does not break the detail view.
5. **Images degrade via `onerror`**: Broken images are swapped to placeholders directly in HTML templates.
6. **Form errors are visual + textual**: Input wrappers get an `.error` class and a toast message is shown; there is no inline `<span>` error text per field.
7. **No global error handler**: There is no `window.onerror`, `unhandledrejection`, or top-level `try/catch` around `DOMContentLoaded`.
8. **No structured error objects**: Errors are plain `Error` instances with string messages; there is no custom error type hierarchy or error code enumeration.
9. **User messages are always localized**: No hardcoded English strings appear in error paths — all user-facing text goes through `t(...)`.

## Key Files

- `js/app.js` — main storefront logic: API calls, try/catch per view, localStorage guards, image `onerror` fallbacks, toast usage.
- `js/i18n.js` — localization dictionary containing all error/success messages (`failed_load`, `api_error`, `product_not_found`, `fill_all`, etc.) and the `t()` translation helper.
- `login.html` — client-side auth forms with `markError`, `setLoading`, `success`, and toast-based validation feedback.
- `css/login.css` — provides the `.error` class styling referenced by `markError`.