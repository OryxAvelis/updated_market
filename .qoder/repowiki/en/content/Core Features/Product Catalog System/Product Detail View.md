# Product Detail View

<cite>
**Referenced Files in This Document**
- [index.html](file://index.html)
- [app.js](file://js/app.js)
- [style.css](file://css/style.css)
- [i18n.js](file://js/i18n.js)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains the product detail view system that renders a single product’s information, pricing, availability, quantity selection, and purchase actions. It also covers wishlist integration, related products recommendations based on category matching, recent products tracking, data caching, error handling for missing products, and responsive layout behavior for mobile devices.

## Project Structure
The application is a single-page interface with multiple views (home, shop, detail, cart, checkout, orders, wishlist). The detail view is one of these views and is dynamically rendered when a user opens a product.

```mermaid
graph TB
A["index.html<br/>Views container"] --> B["js/app.js<br/>View logic & API calls"]
B --> C["js/i18n.js<br/>Translations & category names"]
B --> D["css/style.css<br/>UI styles & responsive rules"]
B --> E["External API<br/>https://api.mmarket.ma/api"]
```

**Diagram sources**
- [index.html:201-215](file://index.html#L201-L215)
- [app.js:585-698](file://js/app.js#L585-L698)
- [i18n.js:370-418](file://js/i18n.js#L370-L418)
- [style.css:514-555](file://css/style.css#L514-L555)

**Section sources**
- [index.html:201-215](file://index.html#L201-L215)
- [app.js:585-698](file://js/app.js#L585-L698)

## Core Components
- Dynamic product detail rendering: loads product by ID, displays name, brand, category, weight/volume, availability status, description, image, and pricing.
- Pricing display: shows current price, strikethrough original price when applicable, and discount badge percentage.
- Quantity selector: increment/decrement controls with min value enforcement.
- Add-to-cart and buy-now actions: add items to cart; buy-now adds item and navigates to checkout.
- Wishlist toggle: add/remove product from wishlist with UI feedback.
- Related products recommendation: shows up to four other products from the same category as the current product.
- Recent products tracking: stores recently viewed products locally and surfaces them on the home page.
- Data caching: caches fetched product details to avoid repeated network requests.
- Error handling: graceful messages when product not found or API fails.
- Responsive layout: adapts grid and typography for mobile via Bootstrap classes and CSS.

**Section sources**
- [app.js:585-698](file://js/app.js#L585-L698)
- [app.js:701-708](file://js/app.js#L701-L708)
- [app.js:897-924](file://js/app.js#L897-L924)
- [app.js:100-114](file://js/app.js#L100-L114)
- [app.js:135-142](file://js/app.js#L135-L142)
- [index.html:201-215](file://index.html#L201-L215)
- [style.css:514-555](file://css/style.css#L514-L555)

## Architecture Overview
The detail view follows a client-side SPA pattern:
- Navigation triggers openDetail(id), which fetches product data, updates breadcrumbs, and renders HTML into the detail section.
- Related products are computed from cached or loaded product lists filtered by category.
- User interactions (quantity changes, add-to-cart, buy-now, wishlist toggle) update local state and persist to localStorage where appropriate.
- i18n provides localized strings and category name translations.

```mermaid
sequenceDiagram
participant U as "User"
participant V as "View Router"
participant D as "openDetail(id)"
participant API as "API /products/{id}"
participant R as "loadRelated(product)"
participant LS as "localStorage"
U->>V : Click product card
V->>D : openDetail(id)
D->>LS : addRecent(product)
D->>API : fetchProduct(id)
API-->>D : product object
D->>D : Render detail HTML (name, brand, category, weight/volume, availability, price, badges)
D->>R : loadRelated(product)
R-->>D : Related products list
D-->>U : Show detail view with actions
```

**Diagram sources**
- [app.js:585-698](file://js/app.js#L585-L698)
- [app.js:100-114](file://js/app.js#L100-L114)
- [app.js:135-142](file://js/app.js#L135-L142)

## Detailed Component Analysis

### Dynamic Product Detail Rendering
- Loads product by ID using a cached-first strategy; if not cached, fetches from API and caches result.
- Renders breadcrumb with product name.
- Displays:
  - Brand name (if present)
  - Product name
  - Category badge (localized via i18n mapping)
  - Weight/volume badge (if present)
  - Availability badge (in stock/out of stock)
  - Description text
  - Image with fallback placeholder on error
- Adds event listeners for quantity controls, add-to-cart, buy-now, and wishlist toggle.

```mermaid
flowchart TD
Start(["openDetail(id)"]) --> Fetch["Fetch product (cache or API)"]
Fetch --> Exists{"Product exists?"}
Exists -- No --> Err["Show 'Product not found' message"]
Exists -- Yes --> Render["Render detail HTML"]
Render --> Actions["Bind qty +/-, add-to-cart, buy-now, wishlist"]
Actions --> Related["Load related products by category"]
Related --> End(["Detail view ready"])
```

**Diagram sources**
- [app.js:585-669](file://js/app.js#L585-L669)
- [app.js:671-698](file://js/app.js#L671-L698)

**Section sources**
- [app.js:585-669](file://js/app.js#L585-L669)

### Pricing Display with Original Price Strikethrough and Discount Badges
- Current price is always shown.
- If an original price exists and is greater than the current price, it is displayed with a strikethrough style.
- If a discount percentage exists, a discount badge is shown alongside the price.
- Formatting uses a helper to round and append currency unit.

```mermaid
flowchart TD
PStart(["Render price block"]) --> CheckOld{"Has original_price > price?"}
CheckOld -- Yes --> ShowOld["Show original price with line-through"]
CheckOld -- No --> SkipOld["Skip original price"]
PStart --> CheckDisc{"discount_percent > 0?"}
CheckDisc -- Yes --> Badge["Show discount badge"]
CheckDisc -- No --> NoBadge["No discount badge"]
ShowOld --> End(["Price block complete"])
SkipOld --> End
Badge --> End
NoBadge --> End
```

**Diagram sources**
- [app.js:619-623](file://js/app.js#L619-L623)
- [app.js:145-148](file://js/app.js#L145-L148)

**Section sources**
- [app.js:619-623](file://js/app.js#L619-L623)
- [app.js:145-148](file://js/app.js#L145-L148)

### Quantity Selector with Increment/Decrement Controls
- Provides minus and plus buttons around a numeric input.
- Minus button enforces a minimum value of 1.
- Plus button increments the value.
- Values are read when adding to cart or buying now.

```mermaid
flowchart TD
QStart(["User interacts with qty box"]) --> Minus{"Minus clicked?"}
Minus -- Yes --> Dec["Set value = max(1, value - 1)"]
Minus -- No --> Plus{"Plus clicked?"}
Plus -- Yes --> Inc["Set value = value + 1"]
Plus -- No --> Read["Read value on action"]
Dec --> Read
Inc --> Read
Read --> End(["Use value for add-to-cart/buy-now"])
```

**Diagram sources**
- [app.js:657-661](file://js/app.js#L657-L661)

**Section sources**
- [app.js:657-661](file://js/app.js#L657-L661)

### Add-to-Cart and Buy-Now Functionality
- Add-to-cart:
  - Adds or updates item quantity in the cart array.
  - Persists cart to localStorage.
  - Shows a toast notification.
- Buy-now:
  - Adds item to cart with selected quantity.
  - Navigates to the checkout view.

```mermaid
sequenceDiagram
participant U as "User"
participant D as "Detail View"
participant C as "addToCart(id, qty)"
participant LS as "localStorage"
participant T as "Toast"
U->>D : Click "Add to Cart"
D->>C : addToCart(id, qty)
C->>LS : Save updated cart
C->>T : Show "Added to cart"
Note over C,T : Cart badge updates automatically
U->>D : Click "Buy Now"
D->>C : addToCart(id, qty)
D->>D : Navigate to checkout
```

**Diagram sources**
- [app.js:701-708](file://js/app.js#L701-L708)
- [app.js:660-661](file://js/app.js#L660-L661)

**Section sources**
- [app.js:701-708](file://js/app.js#L701-L708)
- [app.js:660-661](file://js/app.js#L660-L661)

### Wishlist Integration with Toggle Functionality
- Toggle function adds or removes the product ID from the wishlist array.
- Updates localStorage and shows a toast notification.
- On wishlist view, product details are resolved from cache or fetched on demand.

```mermaid
flowchart TD
WStart(["Toggle wishlist"]) --> InList{"ID already in wishlist?"}
InList -- Yes --> Remove["Remove ID from wishlist"]
InList -- No --> Add["Push ID to wishlist"]
Remove --> Save["Save to localStorage"]
Add --> Save
Save --> Notify["Show toast (added/removed)"]
Notify --> End(["Wishlist updated"])
```

**Diagram sources**
- [app.js:897-904](file://js/app.js#L897-L904)
- [app.js:906-924](file://js/app.js#L906-L924)

**Section sources**
- [app.js:897-904](file://js/app.js#L897-L904)
- [app.js:906-924](file://js/app.js#L906-L924)

### Related Products Recommendation System Based on Category Matching
- Filters the current product list to find other products sharing the same category identifier or category name.
- Limits results to four items.
- If fewer than four are found, fills remaining slots with additional non-duplicate products from the list.
- Hides the related section if no matches exist.

```mermaid
flowchart TD
RStart(["loadRelated(product)"]) --> Filter["Filter by same category id or name"]
Filter --> Limit{"At least 4 items?"}
Limit -- Yes --> Render["Render up to 4 related cards"]
Limit -- No --> Fill["Fill remaining with other products"]
Fill --> Render
Render --> Show{"Any items?"}
Show -- Yes --> Visible["Show related section"]
Show -- No --> Hidden["Hide related section"]
```

**Diagram sources**
- [app.js:671-698](file://js/app.js#L671-L698)

**Section sources**
- [app.js:671-698](file://js/app.js#L671-L698)

### Recent Products Tracking
- When opening a product detail, the product is added to a recent list stored in localStorage.
- The list is deduplicated by product ID and limited to eight entries.
- Home view renders a “Recently Viewed” section using the stored list.

```mermaid
flowchart TD
RS(["Open detail"]) --> Add["Add product to recent list"]
Add --> Dedup["Remove duplicates by ID"]
Dedup --> Trim["Keep only top 8"]
Trim --> Store["Save to localStorage"]
Store --> Home["Home view renders recent section"]
```

**Diagram sources**
- [app.js:100-114](file://js/app.js#L100-L114)
- [app.js:594-596](file://js/app.js#L594-L596)

**Section sources**
- [app.js:100-114](file://js/app.js#L100-L114)
- [app.js:594-596](file://js/app.js#L594-L596)

### Product Data Caching
- A simple in-memory cache maps product IDs to full product objects.
- Detail view checks cache before making network requests.
- Shop view also populates cache while loading pages to support cart and wishlist rendering without extra calls.

```mermaid
flowchart TD
CStart(["fetchProduct(id)"]) --> Hit{"Cache has id?"}
Hit -- Yes --> ReturnCached["Return cached product"]
Hit -- No --> Fetch["Fetch from API"]
Fetch --> CacheStore["Store in cache"]
CacheStore --> ReturnNew["Return new product"]
```

**Diagram sources**
- [app.js:135-142](file://js/app.js#L135-L142)
- [app.js:570-572](file://js/app.js#L570-L572)

**Section sources**
- [app.js:135-142](file://js/app.js#L135-L142)
- [app.js:570-572](file://js/app.js#L570-L572)

### Error Handling for Missing Products
- If fetching a product fails, the detail view replaces content with a localized “Product not found” message.
- Global API errors during initialization show a localized failure message.

```mermaid
flowchart TD
EStart(["openDetail(id)"]) --> TryFetch["Try fetchProduct(id)"]
TryFetch --> Ok{"Success?"}
Ok -- Yes --> Render["Render detail"]
Ok -- No --> ErrMsg["Show 'Product not found'"]
```

**Diagram sources**
- [app.js:594-668](file://js/app.js#L594-L668)
- [app.js:1009-1017](file://js/app.js#L1009-L1017)

**Section sources**
- [app.js:594-668](file://js/app.js#L594-L668)
- [app.js:1009-1017](file://js/app.js#L1009-L1017)

### Responsive Layout Adaptation for Mobile Devices
- Uses Bootstrap grid classes to adapt columns for different screen sizes.
- Mobile bottom toolbar provides quick access to key views.
- Detail view image and content stack vertically on small screens and align side-by-side on larger screens.
- CSS defines consistent spacing, typography, and interactive states across devices.

```mermaid
graph LR
M["Mobile viewport"] --> Grid["Bootstrap grid cols"]
Grid --> Detail["Detail view stacks vertically"]
Grid --> Cards["Product cards adapt to 2-col grid"]
M --> Toolbar["Mobile tabbar navigation"]
```

**Diagram sources**
- [index.html:201-215](file://index.html#L201-L215)
- [index.html:372-403](file://index.html#L372-L403)
- [style.css:514-555](file://css/style.css#L514-L555)

**Section sources**
- [index.html:201-215](file://index.html#L201-L215)
- [index.html:372-403](file://index.html#L372-L403)
- [style.css:514-555](file://css/style.css#L514-L555)

## Dependency Analysis
- app.js depends on:
  - index.html DOM structure for views and elements.
  - i18n.js for localized strings and category name translation.
  - style.css for visual presentation and responsive behavior.
  - External API for categories and products.
- i18n.js provides language switching and category name mapping used throughout the app.
- CSS provides reusable components like product cards, detail image area, and quantity controls.

```mermaid
graph TB
JS["app.js"] --> HTML["index.html"]
JS --> I18N["i18n.js"]
JS --> CSS["style.css"]
JS --> API["External API"]
I18N --> HTML
CSS --> HTML
```

**Diagram sources**
- [app.js:117-142](file://js/app.js#L117-L142)
- [i18n.js:370-418](file://js/i18n.js#L370-L418)
- [style.css:514-555](file://css/style.css#L514-L555)

**Section sources**
- [app.js:117-142](file://js/app.js#L117-L142)
- [i18n.js:370-418](file://js/i18n.js#L370-L418)
- [style.css:514-555](file://css/style.css#L514-L555)

## Performance Considerations
- Caching product details reduces redundant network calls and speeds up repeat visits.
- Client-side filtering and sorting minimize server load for common operations.
- Lazy loading images and placeholders improve perceived performance.
- LocalStorage persistence avoids re-fetching cart, wishlist, and recent items.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- Product not found:
  - Occurs when API returns an error for a specific product ID.
  - The view shows a localized message; verify the product ID and network connectivity.
- API failure during initialization:
  - If categories or initial products cannot be loaded, a localized error message is displayed.
  - Check internet connection and API availability.
- Wishlist or cart not updating:
  - Ensure localStorage is enabled and not blocked by browser settings.
  - Verify that badges update after actions; check console for errors.
- Related products not showing:
  - Requires at least one other product in the same category; otherwise the section is hidden.

**Section sources**
- [app.js:594-668](file://js/app.js#L594-L668)
- [app.js:1009-1017](file://js/app.js#L1009-L1017)

## Conclusion
The product detail view integrates dynamic rendering, robust pricing display, intuitive quantity controls, and seamless purchase flows. Wishlist toggling, category-based related recommendations, and recent products tracking enhance user experience. Caching and error handling ensure reliability, while responsive design guarantees usability across devices.

[No sources needed since this section summarizes without analyzing specific files]