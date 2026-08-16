---
kind: frontend_style
name: CSS Variables + Custom Stylesheet Design System for AM MARKET Storefront
category: frontend_style
scope:
    - '**'
source_files:
    - css/style.css
    - css/login.css
---

## What system/approach is used

The project uses a **plain CSS design system** built on CSS custom properties (variables) and hand-authored stylesheets. There is no CSS framework (no Bootstrap, Tailwind, etc.) — the only external dependency is the Inter font loaded via Google Fonts and an icon set referenced by `<i>` tags (likely Font Awesome). The styling strategy centers on a shared `:root` token palette that defines colors, spacing, shadows, and border radii, then composes component classes on top of those tokens.

## Key files and packages

- `css/style.css` — main storefront stylesheet (~1270 lines): header, hero banner, sidebar categories, product cards, detail view, cart, footer, pagination, filters panel, responsive breakpoints, and utility classes (`text-orange`, `bg-orange`, `text-blue`).
- `css/login.css` — standalone login/signup page stylesheet (~384 lines) with its own `:root` token block, split-brand card layout, form inputs, social buttons, and animations.
- `index.html` / `login.html` — HTML pages that import the corresponding CSS files and reference the shared `img/` assets.
- `js/app.js` / `js/i18n.js` — client-side logic; they do not generate inline styles, keeping presentation in CSS.

## Architecture and conventions

### Design tokens
Both sheets declare a consistent token set at the top:
- Colors: `--orange`, `--orange-dark`, `--orange-light`, `--orange-soft`, `--text`, `--muted`, `--border`.
- Spacing/shapes: `--radius`, `--radius-sm`.
- Shadows: `--shadow`, `--shadow-md`, `--shadow-lg`.
The store and login pages reuse the same orange/blue brand palette so the two surfaces feel visually unified even though they are separate files.

### Component class naming
Classes follow a flat, descriptive BEM-like convention without a strict methodology:
- Semantic element names: `.product-card`, `.product-img`, `.product-body`, `.product-title`, `.product-price`, `.cart-item`, `.order-card`, `.auth-card`, `.auth-brand`, `.auth-form-side`, `.input-group-custom`, `.btn-submit`, `.trust-box`, `.cat-card`, `.hero-banner`, `.top-header`, `.footer-main`, `.filters-panel`, `.lang-btn`, `.back-to-top`.
- Utility classes for quick overrides: `.text-orange`, `.bg-orange`, `.text-blue`, `.badge-count`, `.badge-disc`.
- View toggling via a single `.view` / `.view.active` pattern to show/hide SPA sections.

### Layout patterns
- Flexbox is the primary layout model (header rows, product footers, trust badges, footer columns, auth card).
- CSS Grid is used for the category grid: `grid-template-columns: repeat(auto-fill, minmax(105px, 1fr))`.
- Sticky header (`position: sticky; top: 0`) and fixed "back to top" button.
- Product images use `aspect-ratio: 1` with `object-fit: contain` for uniform thumbnails.

### Animations and micro-interactions
- Hover lifts: `transform: translateY(-Xpx)` plus shadow escalation on `.product-card`, `.trust-box`, `.cat-card`, `.footer-socials a`, `.social-btn`.
- Button press: `transform: scale(0.98)` on `.btn-orange`, `.btn-submit`.
- Staggered entrance: `.hero-text h1/p/.btn-light` use `@keyframes heroRise` with staggered delays; login page uses `riseIn` and `formIn`/`formInBack`.
- Floating decorative bubbles: `.hero-bubbles span` and `.bubbles span` with `@keyframes heroFloat` / `float`.
- Focus states: search and input groups highlight via `:focus-within` with `border-color: var(--orange)` and a soft ring `box-shadow: 0 0 0 3px rgba(26,111,12,0.12)`.
- Error state: `.input-group-custom.error` triggers a `shake` keyframe animation.

### Responsive strategy
Breakpoints are defined directly in each stylesheet using media queries:
- `991.98px`: hide sidebar on smaller screens.
- `860px` (login): stack auth card vertically, hide perks list.
- `767.98px`: wrap header row, push search to full width below logo.
- `575.98px`: shrink logo, tighten category grid.
No mobile-first approach is enforced — rules are added as needed per breakpoint.

### Shared visual identity
- Primary brand color is a blue shade (`#1a6fd4`) named `--orange` across both sheets, with lighter/darker variants for hover and backgrounds.
- Rounded corners consistently use `var(--radius)` (14px) or `--radius-sm` (10px); large cards use 16–22px radius.
- Subtle borders via `--border` and very light box shadows (`rgba(0,0,0,0.05)`–`0.1`) give depth without heavy elevation.
- Footer uses a thick top border colored with `--orange` as a brand accent.

## Conventions and constraints observed

- **All colors go through variables**: Hardcoded color literals appear only in gradients/backgrounds; interactive states and text colors reference `--orange`, `--text`, `--muted`, `--border`.
- **Consistent focus rings**: Search and form inputs use `:focus-within` to apply the orange border + glow ring, establishing a uniform interaction cue.
- **View switching is CSS-driven**: Pages toggle visibility with `.view { display: none }` / `.view.active { display: block; animation: fadeUp }`; JS only toggles classes.
- **Icons are markup-based**: Icons are inserted via `<i>` elements (Font Awesome style), styled purely with CSS size/color — no SVG sprites or icon fonts managed in CSS.
- **Animations are lightweight**: All transitions use `0.15s–0.35s` durations with ease/ease-in-out curves; no heavy GPU-accelerated effects beyond transforms and opacity.
- **Responsive behavior is additive**: Existing layouts are preserved until a breakpoint triggers a specific override (e.g., hiding the sidebar rather than redesigning it).
- **No CSS preprocessing**: Files are plain `.css`; there is no SCSS/Sass/Less build step, no PostCSS, no Tailwind config.