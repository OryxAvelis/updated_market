---
kind: external_dependency
name: mmarket.ma REST API (backend data source)
slug: mmarket-ma-api
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
source_files:
    - js/app.js
---

- The front-end app consumes a live REST API hosted at `https://api.mmarket.ma/api` for product and category data.
- All client-side state (cart, wishlist, orders) is persisted in `localStorage`; the API is used only to fetch catalog data.
- Verify exact endpoints/methods against the official API docs when extending the storefront.