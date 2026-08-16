---
kind: configuration_system
name: Client-Side Configuration via Hardcoded Constants and localStorage
category: configuration_system
scope:
    - '**'
source_files:
    - js/app.js
    - js/i18n.js
    - index.html
    - login.html
---

## What system/approach is used

This repository has no centralized configuration framework, build-time config files (`.env`, `*.yaml`, `*.toml`, `application.properties`), or server-side config loader. Instead, runtime configuration is expressed as **hardcoded JavaScript constants** at the top of `js/app.js` and **user preferences persisted in `localStorage`**. There are no environment variables, feature flags, or external config sources.

## Key files and packages

- `js/app.js` — defines all application-level constants: API base URL (`const API = 'https://api.mmarket.ma/api'`), excluded category ID (`EXCLUDE_CAT = 1811`), category icon fallback map (`CAT_ICONS`), local storage key prefixes (`LS = { cart: 'am_cart', wish: 'am_wish', orders: 'am_orders', recent: 'am_recent' }`), default filter values (`maxPrice = 1000`, `onlyAvailable = true`, `onlyPromo = false`), currency formatting suffix (`DH`), delivery fee threshold (free over 200 DH), and product cache object.
- `js/i18n.js` — defines the bilingual string dictionary (`I18N.en`, `I18N.fr`) plus a category name mapping (`CAT_EN`) that translates API French category names to English display names. It also provides the language persistence layer under the `am_lang` localStorage key.
- `index.html` / `login.html` — HTML pages reference the JS modules; no inline config blocks exist beyond `<html lang="en">` which is overridden by i18n logic.

## Architecture and conventions

1. **Constants-first configuration**: All tunables live as module-level `const` declarations near the top of `app.js`. New runtime knobs should be added there rather than scattered through functions.
2. **Single source of truth for the API endpoint**: The `API` constant is the only place the backend base URL is declared; all `fetch` calls interpolate `${API}/...`. Changing the backend requires editing this one line.
3. **User preference storage via localStorage keys with a stable prefix**: User data uses keys prefixed `am_` (`am_cart`, `am_wish`, `am_orders`, `am_recent`, `am_lang`, `am_user`). This convention keeps client-side state namespaced and avoids collisions with other scripts.
4. **Language selection**: The active locale is read from `localStorage.getItem('am_lang')` and defaults to `'en'`; toggling writes the new value and dispatches a custom `am:langchange` event so other components can react.
5. **No build-time or deployment-time configuration**: There is no `.env`, no webpack/vite config, no Docker/CI config. The same static files are deployed unchanged; behavior differences across environments would require code changes.
6. **Hardcoded business rules as constants**: Delivery free-shipping threshold (200 DH), excluded category (smoking, id 1811), pagination page size (12), max price slider range (0–1000) — all embedded directly in `app.js`.
7. **i18n as the only "configurable content"**: UI text is not inlined in templates but loaded via `data-i18n*` attributes resolved by `i18n.js`, making strings the only user-editable surface without touching code.

## Conventions and constraints

- **Do not hardcode URLs elsewhere**: All network endpoints must go through the `API` constant in `app.js` (observed consistently across `fetchCategories`, `fetchProducts`, `fetchProduct`).
- **Persist user settings under the `am_` namespace in `localStorage`**: Enforced by the existing keys `am_cart`, `am_wish`, `am_orders`, `am_recent`, `am_lang`, `am_user`.
- **Default language is English**: `getLang()` returns `'en'` when `am_lang` is missing or invalid; French must be explicitly selected.
- **Category exclusion is a single numeric constant**: Add new excluded categories by modifying `EXCLUDE_CAT` or extending the filter in `fetchCategories`.
- **Currency is fixed to Moroccan Dirham (DH)**: Formatting via `formatPrice` appends `' DH'`; no currency selector exists.
- **No secrets or sensitive configuration are stored in the repo**: No API keys, tokens, or credentials appear in any file — authentication on the login page is simulated locally.
- **HTML attribute-based localization is required for new strings**: New UI text should be added to both `I18N.en` and `I18N.fr` in `i18n.js` and referenced via `data-i18n`, `data-i18n-ph`, `data-i18n-title`, or `data-i18n-html` (the latter restricted to the whitelisted keys `hero_title`, `rights`).