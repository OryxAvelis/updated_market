---
kind: dependency_management
name: CDN-Referenced Frontend Dependencies (No Package Manager)
category: dependency_management
scope:
    - '**'
source_files:
    - index.html
    - login.html
---

This repository is a pure client-side storefront and authentication UI with no build toolchain, package manager, or vendoring strategy. Third-party dependencies are declared inline in the HTML files via `<link>` and `<script>` tags that point to public CDNs.

**Systems / approach used**
- No package manager: there is no `package.json`, `go.mod`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile`, `composer.json`, or any lockfile anywhere in the repository.
- No vendoring: no `node_modules/`, `vendor/`, `bower_components/`, or similar directories exist.
- Direct CDN references: all third-party libraries are loaded at runtime from public CDNs by URL.

**Key dependency declarations**
- Bootstrap 5.3.3 CSS: referenced in both `index.html` and `login.html` via `https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css`.
- Bootstrap 5.3.3 JS bundle: referenced in both pages via `https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js` with an `integrity` hash (`sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA5N6jIeHz`) and `crossorigin="anonymous"`.
- Font Awesome 6.5.1: referenced via `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css`.
- Google Fonts (Inter): referenced via `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap`.
- Local application code: `js/app.js`, `js/i18n.js`, `css/style.css`, `css/login.css`, and `img/*` are served as local relative paths.
- External API: the app fetches product data from `api.mmarket.ma` (documented in the project overview).

**Architecture and conventions**
- Version pinning is done per-page by hardcoding the exact version number in each CDN URL (e.g. `bootstrap@5.3.3`, `font-awesome/6.5.1`). There is no shared manifest centralizing these versions.
- The only integrity safeguard is the SRI `integrity` attribute on the Bootstrap JS `<script>` tag; CSS links do not include `integrity` hashes.
- Both `index.html` and `login.html` duplicate the same set of CDN `<link>`/`<script>` tags rather than sharing a partial/template, so updating a library requires editing every page manually.
- The i18n system (`js/i18n.js`) is self-contained and does not depend on external localization libraries — it appears to be hand-rolled for EN/FR support.

**Conventions and constraints**
- All third-party assets must be reachable over HTTPS from jsDelivr, cdnjs, and fonts.googleapis.com at runtime; if those CDNs are blocked or unavailable, the UI will load without styling, icons, or Bootstrap components.
- Because there is no lockfile, the effective dependency versions are whatever the CDN currently serves for the pinned URLs; upgrading means changing the URL string in each HTML file.
- There is no automated update process, audit tooling, or vulnerability scanning configured in this repository for the frontend dependencies.