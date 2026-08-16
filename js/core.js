/**
 * AM MARKET — core.js (shared infrastructure, loaded on every page after i18n.js)
 *
 *  - API client for api.mmarket.ma with automatic CORS-proxy fallback (file:// safe)
 *  - Cart / wishlist / orders / recently-viewed state, persisted in localStorage
 *    and therefore shared across all pages
 *  - Header, footer and mobile tabbar injection (each page only carries its own
 *    <main> content; everything else is rendered here)
 *  - Product card rendering + helpers (toast, badges, price formatting, sidebar)
 *
 * Page scripts (js/<page>.js) are loaded after this file and add their own logic.
 */

const API = 'https://api.mmarket.ma/api';
const EXCLUDE_CAT = 1811; // Fumoir (smoking) — excluded

// Fallback icons for categories that don't have one from the API
const CAT_ICONS = {
  // French names (as returned by the API)
  'boissons':             '🥤',
  'hygiene':              '🧴',
  'produits laitiers':    '🥛',
  'glaces':               '🍦',
  'epicerie':             '🛒',
  'fruits sec':           '🥜',
  'friandise':            '🍬',
  'maison cuisine':       '🍳',
  'univers bebe':         '👶',
  'snacks sucres':        '🍫',
  'animaux':              '🐾',
  'snacks sales':         '🧂',
  'boulangerie patisserie': '🥐',
  'nettoyage':            '🧹',
  'cadeaux fetes':        '🎁',
  'fournitures bureau':   '📎',
  'divertissement':        '🎮',
  'frais':                 '🥦',
  'petit dejeuner':        '🥐',
  'asiatique':             '🍜',
  'accessoire telephone':  '📱',
  'accessoire téléphone':   '📱',
  // English names (fallbacks)
  'beverages':            '🥤',
  'dairy products':       '🥛',
  'ice creams':           '🍦',
  'groceries':            '🛒',
  'dried fruits':         '🥜',
  'candies':              '🍬',
  'home & kitchen':       '🍳',
  'baby & kids':          '👶',
  'sweet & chocolates':   '🍫',
  'pet supplies':         '🐾',
  'snacks':               '🧂',
  'bakery':               '🥐',
  'cleaning':             '🧹',
  'gifts':                '🎁',
  'stationery':           '📎',
};

function getCatIcon(cat) {
  // Skip any generic/box-like icons from the API, use our mapping instead
  const genericIcons = ['📦', '🏪', '🛒', '🗂️', '❓'];
  if (cat.icon && !genericIcons.includes(cat.icon)) return cat.icon;
  const key = (cat.name || '').toLowerCase().trim();
  return CAT_ICONS[key] || '🏪';
}

const LS = {
  cart: 'am_cart',
  wish: 'am_wish',
  orders: 'am_orders',
  recent: 'am_recent'
};

// ---------- State (localStorage — shared across pages) ----------
let cart = [];
let wishlist = [];
let orders = [];

function loadState() {
  try {
    cart = JSON.parse(localStorage.getItem(LS.cart)) || [];
    wishlist = JSON.parse(localStorage.getItem(LS.wish)) || [];
    orders = JSON.parse(localStorage.getItem(LS.orders)) || [];
  } catch { cart = []; wishlist = []; orders = []; }
}
function saveCart() { localStorage.setItem(LS.cart, JSON.stringify(cart)); updateBadges(); }
function saveWish() { localStorage.setItem(LS.wish, JSON.stringify(wishlist)); updateBadges(); }
function saveOrders() { localStorage.setItem(LS.orders, JSON.stringify(orders)); updateBadges(); renderNotifMenu(); }

// Recently viewed (product snapshots, newest first, max 8)
function getRecent() {
  try { return JSON.parse(localStorage.getItem(LS.recent)) || []; } catch { return []; }
}
function addRecent(product) {
  let list = getRecent().filter(p => String(p.id) !== String(product.id));
  list.unshift({
    id: product.id,
    name: product.name,
    price: product.price,
    image_url: product.image_url,
    brand_name: product.brand_name || ''
  });
  list = list.slice(0, 8);
  localStorage.setItem(LS.recent, JSON.stringify(list));
}

// ---------- API ----------
// CORS proxies used as automatic fallback when a direct fetch is blocked or
// hangs (happens on file:// where the page origin is the opaque "null").
const API_HOST = 'https://api.mmarket.ma';
const PROXIES = [
  { json: true, bin: true, url: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { json: true, bin: false, url: u => 'https://r.jina.ai/' + u },
  { json: true, bin: false, url: u => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u),
    unwrap: d => JSON.parse(d.contents) },
  { json: true, bin: true, url: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
];

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// Fetch API JSON: direct first, then through CORS proxies (file:// safety net)
async function apiJSON(url) {
  try {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    for (const px of PROXIES) {
      try {
        const res = await fetchWithTimeout(px.url(url), 6000);
        if (!res.ok) continue;
        const data = await res.json();
        return px.unwrap ? px.unwrap(data) : data;
      } catch { /* try next proxy */ }
    }
    throw e;
  }
}

// If the browser blocks product images from the API on file://, reroute via a raw proxy
document.addEventListener('error', e => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || !el.src.startsWith(API_HOST)) return;
  const raw = PROXIES.filter(p => p.bin);
  const i = +el.dataset.px || 0;
  if (i >= raw.length) return;
  el.dataset.px = String(i + 1);
  el.src = raw[i].url(el.src);
}, true);

let productCache = {};   // in-memory product cache for this page load
let categories = [];
let categoriesPromise = null;

async function fetchCategories() {
  const data = await apiJSON(`${API}/categories/`);
  // Exclude smoking category
  return (Array.isArray(data) ? data : data.results || [])
    .filter(c => c.id !== EXCLUDE_CAT && c.parent_id == null);
}

async function fetchProducts(page = 1, categoryId = null, search = '') {
  let url = `${API}/products/?include_descendants=true&page=${page}&page_size=12`;
  if (categoryId) url += `&category=${categoryId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  const data = await apiJSON(url); // { count, next, previous, results }
  (data.results || []).forEach(p => { productCache[p.id] = p; });
  return data;
}

async function fetchProduct(id) {
  if (productCache[id]) return productCache[id];
  const p = await apiJSON(`${API}/products/${id}/`);
  productCache[id] = p;
  return p;
}

// Fetch the category list once per page load (memoized promise)
function ensureCategories() {
  if (!categoriesPromise) {
    categoriesPromise = fetchCategories().then(list => { categories = list; return list; });
  }
  return categoriesPromise;
}

// ---------- Helpers ----------
function $(id) { return document.getElementById(id); }

// ---------- Theme (dark / light) ----------
// The initial theme is applied before first paint by a tiny inline script in
// each page <head>; these helpers keep it in sync when the user changes it.
function getTheme() {
  return localStorage.getItem('am_theme') === 'dark' ? 'dark' : 'light';
}
function setTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('am_theme', t);
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-bs-theme', t); // Bootstrap dropdowns/toasts/inputs
}

// ---------- Saved preferences (used by settings + checkout) ----------
function getUser() {
  try { return JSON.parse(localStorage.getItem('am_user')); } catch { return null; }
}

function getDefaultPay() {
  return localStorage.getItem('am_pay') === 'card' ? 'card' : 'cod';
}
function setDefaultPay(p) {
  localStorage.setItem('am_pay', p === 'card' ? 'card' : 'cod');
}

function getDeliveryInfo() {
  try { return JSON.parse(localStorage.getItem('am_delivery')) || {}; } catch { return {}; }
}
function saveDeliveryInfo(info) {
  localStorage.setItem('am_delivery', JSON.stringify(info || {}));
}

function formatPrice(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '—' : Math.round(n) + ' DH';
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}

function toast(msg) {
  const el = $('toast');
  if (!el) return;
  $('toastMsg').textContent = msg;
  new bootstrap.Toast(el, { delay: 2200 }).show();
}

// ---------- Cart & wishlist actions ----------
function addToCart(id, qty = 1, product = null) {
  id = String(id);
  const item = cart.find(i => i.id === id);
  if (item) item.qty += qty;
  else {
    // Keep a product snapshot so cart/checkout pages can render without refetching
    const p = product || productCache[id] || null;
    cart.push(p
      ? { id, qty, name: p.name, price: p.price, image_url: p.image_url, brand_name: p.brand_name || '' }
      : { id, qty });
  }
  saveCart();
  toast(t('added_cart'));
}

function toggleWish(id) {
  id = String(id);
  const idx = wishlist.indexOf(id);
  if (idx >= 0) { wishlist.splice(idx, 1); toast(t('removed_wish')); }
  else { wishlist.push(id); toast(t('added_wish')); }
  saveWish();
}

function deliveryFee(sub) {
  return (sub >= 200 || sub === 0) ? 0 : 20;
}

// Detailed cart items: product data from the localStorage snapshot, the
// in-memory cache, or the API (snapshot is refreshed after a fetch).
async function getCartItems() {
  const items = [];
  let changed = false;
  for (const c of cart) {
    let p = productCache[c.id];
    if (!p && c.name != null) {
      p = { id: String(c.id), name: c.name, price: c.price, image_url: c.image_url, brand_name: c.brand_name || '' };
      productCache[c.id] = p;
    }
    if (!p) {
      try { p = await fetchProduct(c.id); }
      catch { p = { id: String(c.id), name: 'Product', price: 0, image_url: '' }; }
    }
    if (c.name == null || String(c.price) !== String(p.price) || c.image_url !== p.image_url) {
      c.name = p.name; c.price = p.price; c.image_url = p.image_url; c.brand_name = p.brand_name || '';
      changed = true;
    }
    items.push({ id: String(c.id), qty: c.qty, product: p });
  }
  if (changed) localStorage.setItem(LS.cart, JSON.stringify(cart));
  return items;
}

function itemsSubtotal(items) {
  return items.reduce((s, i) => s + (parseFloat(i.product.price) || 0) * i.qty, 0);
}

// ---------- Badges / header widgets ----------
function updateBadges() {
  const cc = cart.reduce((s, i) => s + i.qty, 0);
  const wc = wishlist.length;
  const nc = orders.length;
  [['cartCount', cc], ['mCartCount', cc], ['wishCount', wc], ['mWishCount', wc], ['notifCount', nc]].forEach(([id, n]) => {
    const el = $(id);
    if (!el) return;
    if (el.textContent !== String(n)) {
      el.classList.remove('badge-pop'); void el.offsetWidth; el.classList.add('badge-pop');
    }
    el.textContent = n; el.dataset.n = n;
  });
}

function renderNotifMenu() {
  const menu = $('notifMenu');
  if (!menu) return;
  if (!orders.length) {
    menu.innerHTML = `<li class="notif-empty">${t('notif_empty')}</li>`;
    return;
  }
  menu.innerHTML = orders.slice(0, 5).map(o => `
    <li><a class="dropdown-item notif-item" href="orders.html">
      <i class="fa-solid fa-bag-shopping"></i>
      <span>${t('notif_order', { id: escapeHtml(o.id) })}<br><small class="text-muted">${t('status_processing')}</small></span>
    </a></li>`).join('');
}

function renderAccountPanel() {
  const nameEl = $('apName');
  const link = $('apProfileLink');
  const row = $('logoutRow');
  const u = getUser();
  if (nameEl) nameEl.textContent = u && u.name ? u.name : t('guest');
  // "View Profile" always opens the settings page (guest or logged in)
  if (link) {
    link.setAttribute('href', 'settings.html');
    link.removeAttribute('data-soon');
  }
  if (row) row.style.display = u ? '' : 'none';
}

// Header account dropdown + pill label reflect the logged-in state.
// Guests keep full access to the shop; this only changes labels/links.
function updateAccountUI() {
  const u = getUser();
  const label = $('accountLabel');
  if (label) {
    label.removeAttribute('data-i18n');
    label.textContent = u && u.name ? u.name : t('my_account');
  }
  const userRow = $('ddUserRow');
  if (userRow) {
    userRow.style.display = u ? '' : 'none';
    $('ddUserName').textContent = u ? (u.email || u.name || '') : '';
  }
  const loginRow = $('ddLoginRow');
  if (loginRow) loginRow.style.display = u ? 'none' : '';
  const logoutRow = $('ddLogoutRow');
  const logoutItem = $('ddLogoutItem');
  if (logoutRow) logoutRow.style.display = u ? '' : 'none';
  if (logoutItem) logoutItem.style.display = u ? '' : 'none';
}

// Pages restored from the back/forward cache (e.g. going Back after signing
// in on login.html) keep their old DOM — re-render state-dependent widgets
// so a stale "Guest" or old badge counts never survive navigation.
window.addEventListener('pageshow', e => {
  if (e.persisted) {
    loadState();
    updateBadges();
    renderNotifMenu();
    renderAccountPanel();
    updateAccountUI();
  }
});

// ---------- Sidebar (home + categories pages) ----------
let sidebarActiveCat = null;

async function renderSidebar(activeCat = null) {
  sidebarActiveCat = activeCat;
  const list = $('categoryList');
  if (!list) return;
  try { await ensureCategories(); } catch { return; }
  list.innerHTML = `
    <a class="list-group-item ${activeCat == null ? 'active' : ''}" href="categories.html">
      🏪 ${t('all_categories')}
    </a>
    ${categories.map(c => `
      <a class="list-group-item ${activeCat === c.id ? 'active' : ''}" href="categories.html?cat=${c.id}">
        ${getCatIcon(c)} ${escapeHtml(catName(c.name))}
        <span class="cat-count">${c.product_count || 0}</span>
        <i class="fa-solid fa-chevron-right cat-chev"></i>
      </a>
    `).join('')}`;
}

// ---------- Product card (shared rendering) ----------
function cardHTML(p) {
  const img = p.image_url || '';
  const inWish = wishlist.includes(String(p.id));
  const disc = parseInt(p.discount_percent) || 0;
  const oldPrice = parseFloat(p.original_price);
  const hasOld = oldPrice > 0 && oldPrice > parseFloat(p.price);
  const href = 'product.html?id=' + encodeURIComponent(p.id);

  return `
    <div class="col-6 col-md-4 col-xl-3">
      <div class="product-card">
        ${disc > 0 ? `<span class="badge-disc">-${disc}%</span>` : (p.is_promo ? `<span class="badge-disc badge-promo">Promo 🔥</span>` : '')}
        <a class="product-img" href="${href}">
          <img src="${img}" alt="${escapeHtml(p.name)}" loading="lazy"
               onerror="this.onerror=null;this.src='img/placeholder.svg'">
        </a>
        <div class="product-body">
          <a class="product-title" href="${href}">${escapeHtml(p.name)}</a>
          <div class="product-brand">${p.brand_name ? escapeHtml(p.brand_name) : 'AM Market'}</div>
          <div class="product-foot">
            <div class="product-price">
              <span class="current">${formatPrice(p.price)}</span>
              ${hasOld ? `<span class="old">${formatPrice(oldPrice)}</span>` : ''}
            </div>
            <div class="card-actions">
              <button class="wish-btn ${inWish ? 'active' : ''}" data-wish="${p.id}" title="${t('wish_title')}">
                <i class="fa-${inWish ? 'solid' : 'regular'} fa-heart"></i>
              </button>
              <button class="add-btn" data-id="${p.id}" title="${t('add_to_cart')}">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// Wire add-to-cart / wishlist buttons inside a card grid. `rerender` (optional)
// is called after a wishlist toggle so the page can refresh its cards.
function bindCards(container, rerender) {
  container.querySelectorAll('.add-btn').forEach(btn => {
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); addToCart(btn.dataset.id); };
  });
  container.querySelectorAll('[data-wish]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleWish(btn.dataset.wish);
      if (rerender) rerender();
    };
  });
}

// ---------- Shared layout: header / footer / tabbar ----------
const HEADER_HTML = `
<header class="top-header">
  <div class="container-fluid px-3 px-lg-4">
    <div class="header-card d-flex align-items-center gap-3 header-row">
      <a href="index.html" class="logo">
        <img src="img/logo-round.png" alt="AM MARKET — Shop More, Live Better" class="logo-img">
        <span class="logo-text">
          <span class="brand">AM <span class="text-orange">MARKET</span></span>
          <small data-i18n="tagline">SHOP MORE, LIVE BETTER</small>
        </span>
      </a>

      <div class="search-box flex-grow-1">
        <div class="input-group">
          <span class="search-lead"><i class="fa-solid fa-magnifying-glass"></i></span>
          <input type="text" class="form-control" id="searchInput" placeholder="Search for products, brands and more..." data-i18n-ph="search_ph" />
          <button class="btn btn-orange" id="searchBtn"><i class="fa-solid fa-magnifying-glass"></i> <span class="d-none d-lg-inline" data-i18n="search_btn">Search</span></button>
        </div>
      </div>

      <div class="d-flex align-items-center gap-1 gap-lg-2 header-actions">
        <button class="btn-icon lang-btn" data-lang-toggle title="Français / English">
          <i class="fa-solid fa-globe"></i> <span class="d-none d-md-inline" id="langLabel">EN</span> <i class="fa-solid fa-chevron-down hdr-chev"></i>
        </button>
        <a class="btn-icon labeled" href="wishlist.html" title="Wishlist" data-i18n-title="wish_title">
          <i class="fa-regular fa-heart"></i>
          <span class="badge-count" id="wishCount">0</span>
          <span class="lbl d-none d-xl-block" data-i18n="wish_title">Wishlist</span>
        </a>
        <a class="btn-icon labeled" href="cart.html" title="Cart" data-i18n-title="cart_title">
          <i class="fa-solid fa-cart-shopping"></i>
          <span class="badge-count" id="cartCount">0</span>
          <span class="lbl d-none d-xl-block" data-i18n="cart_title">Cart</span>
        </a>
        <div class="dropdown">
          <button class="btn-icon labeled dropdown-toggle" data-bs-toggle="dropdown" title="Notifications" data-i18n-title="notif_title">
            <i class="fa-regular fa-bell"></i>
            <span class="badge-count" id="notifCount">0</span>
            <span class="lbl d-none d-xl-block" data-i18n="notif_title">Notifications</span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end notif-menu" id="notifMenu"></ul>
        </div>
        <div class="dropdown">
          <button class="account-pill dropdown-toggle" data-bs-toggle="dropdown">
            <i class="fa-regular fa-user"></i> <span class="d-none d-lg-inline" id="accountLabel" data-i18n="my_account">My Account</span> <i class="fa-solid fa-chevron-down hdr-chev"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li id="ddUserRow" style="display:none"><span class="dropdown-item-text small fw-semibold" id="ddUserName"></span></li>
            <li id="ddLoginRow"><a class="dropdown-item" href="login.html"><i class="fa-solid fa-right-to-bracket me-2"></i><span data-i18n="login_link">Login / Sign In</span></a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="orders.html"><i class="fa-solid fa-box me-2"></i><span data-i18n="my_orders">My Orders</span></a></li>
            <li><a class="dropdown-item" href="wishlist.html"><i class="fa-regular fa-heart me-2"></i><span data-i18n="wish_title">Wishlist</span></a></li>
            <li><a class="dropdown-item" href="cart.html"><i class="fa-solid fa-cart-shopping me-2"></i><span data-i18n="cart_title">Cart</span></a></li>
            <li><a class="dropdown-item" href="settings.html"><i class="fa-solid fa-gear me-2"></i><span data-i18n="settings">Settings</span></a></li>
            <li id="ddLogoutRow" style="display:none"><hr class="dropdown-divider"></li>
            <li id="ddLogoutItem" style="display:none"><a class="dropdown-item" href="#" id="ddLogoutLink"><i class="fa-solid fa-arrow-right-from-bracket me-2"></i><span data-i18n="logout">Logout</span></a></li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</header>`;

const FOOTER_HTML = `
<footer class="footer mt-5">
  <div class="footer-main">
    <div class="container">
      <div class="row g-5">

        <!-- Brand -->
        <div class="col-lg-3 col-md-6">
          <div class="footer-brand mb-3">
            <img src="img/logo.png" alt="AM MARKET" class="footer-logo-img">
          </div>
          <p class="footer-desc" data-i18n="footer_desc">Votre marketplace marocaine pour tous les produits du quotidien.</p>
          <div class="footer-socials">
            <a href="#" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>
            <a href="#" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
            <a href="#" aria-label="Messenger"><i class="fa-brands fa-facebook-messenger"></i></a>
            <a href="#" aria-label="Instagram"><i class="fa-brands fa-instagram"></i></a>
          </div>
        </div>

        <!-- Categories -->
        <div class="col-lg-3 col-md-6">
          <h6 class="footer-heading" data-i18n="footer_cats">Catégories</h6>
          <ul class="footer-nav-list">
            <li><a href="categories.html"><i class="fa-solid fa-basket-shopping"></i> <span data-i18n="fcat_food">Alimentation</span></a></li>
            <li><a href="categories.html"><i class="fa-solid fa-bottle-water"></i> <span data-i18n="fcat_drinks">Boissons</span></a></li>
            <li><a href="categories.html"><i class="fa-solid fa-soap"></i> <span data-i18n="fcat_hygiene">Hygiène</span></a></li>
            <li><a href="categories.html"><i class="fa-solid fa-house"></i> <span data-i18n="fcat_home">Maison</span></a></li>
          </ul>
        </div>

        <!-- Help -->
        <div class="col-lg-3 col-md-6">
          <h6 class="footer-heading" data-i18n="footer_help">Aide</h6>
          <ul class="footer-nav-list">
            <li><a href="#"><i class="fa-solid fa-circle-info"></i> <span data-i18n="about">À propos</span></a></li>
            <li><a href="#"><i class="fa-solid fa-phone"></i> <span data-i18n="contact">Contact</span></a></li>
            <li><a href="#"><i class="fa-regular fa-circle-question"></i> <span data-i18n="faqs">FAQs</span></a></li>
            <li><a href="#"><i class="fa-solid fa-truck"></i> <span data-i18n="delivery_link">Livraison</span></a></li>
          </ul>
        </div>

        <!-- Newsletter -->
        <div class="col-lg-3 col-md-6">
          <h6 class="footer-heading" data-i18n="newsletter">Newsletter</h6>
          <p class="footer-desc mb-3" data-i18n="newsletter_sub">Get updates on latest products.</p>
          <form class="footer-newsletter" onsubmit="return false;">
            <div class="newsletter-input-wrap">
              <i class="fa-regular fa-envelope"></i>
              <input type="email" placeholder="Email" aria-label="Email" />
            </div>
            <button type="submit" class="btn btn-blue" data-i18n="go">Go</button>
          </form>
        </div>

      </div>
    </div>
  </div>

  <!-- Footer Bottom -->
  <div class="footer-bottom">
    <div class="container d-flex flex-wrap align-items-center justify-content-between gap-3">
      <p class="mb-0 small" data-i18n-html="rights">© 2026 <a href="index.html" class="text-blue fw-semibold">AM MARKET</a>. Tous droits réservés.</p>
      <div class="footer-payments">
        <!-- Visa -->
        <svg height="22" viewBox="0 0 1000 324" xmlns="http://www.w3.org/2000/svg" aria-label="Visa"><path d="M651.19 0C576.34 0 509.94 38.13 509.94 108.56c0 81.06 116.93 86.61 116.93 127.3 0 17.16-19.68 32.4-53.35 32.4-47.74 0-83.44-21.53-83.44-21.53l-15.32 71.97s40.43 17.9 95.97 17.9c82.16 0 151.16-40.87 151.16-112.73 0-85.63-117.47-90.99-117.47-129.26 0-13.42 16.25-28.1 49.8-28.1 38.03 0 69.01 15.77 69.01 15.77L736.8 14.27S702.73 0 651.19 0zM3.75 5.04L0 25.76s32.35 5.88 61.49 17.63c37.48 13.52 40.14 21.41 46.45 45.66l68.84 264.95h92.96L415.3 5.04h-92.59L243.47 221.1 210.38 32.12c-3.01-17.18-16.05-27.08-32.16-27.08H3.75zm411.93 0L339.47 354h88.38l76.16-349h-88.33zm451.32 0c-16.06 0-24.72 8.61-31.03 23.42L709.32 354h92.87l18.02-51.47h113.3L944.23 354H1000L945.35 5.04h-78.35zm12.16 84.4l27.3 120.56h-73.4l46.1-120.56z" fill="#1434CB"/></svg>
        <!-- Mastercard -->
        <svg height="28" viewBox="0 0 131.39 86.9" xmlns="http://www.w3.org/2000/svg" aria-label="Mastercard"><rect width="131.39" height="86.9" rx="8" fill="#fff" opacity="0"/><circle cx="47.35" cy="43.45" r="35.5" fill="#EB001B"/><circle cx="84.04" cy="43.45" r="35.5" fill="#F79E1B"/><path d="M65.69 13.61a35.5 35.5 0 0 1 0 59.68A35.5 35.5 0 0 1 65.69 13.61z" fill="#FF5F00"/></svg>
        <!-- Wafacash -->
        <span class="payment-text-badge" style="color:#c8102e;font-weight:800;font-size:0.82rem;letter-spacing:-0.3px;">Wafa<span style="color:#1a1a1a;">cash</span></span>
        <!-- CashPlus -->
        <span class="payment-text-badge" style="color:#e8000d;font-weight:800;font-size:0.82rem;">Cash<span style="color:#f7a800;">Plus</span></span>
        <!-- PayPal -->
        <span class="payment-text-badge" style="font-style:italic;font-weight:800;font-size:0.85rem;color:#003087;">Pay<span style="color:#009cde;">Pal</span></span>
      </div>
    </div>
  </div>
</footer>`;

const TABBAR_HTML = `
<nav class="mobile-tabbar" aria-label="Mobile navigation">
  <a class="tab-item" data-tab="home" href="index.html">
    <i class="fa-solid fa-house"></i>
    <span data-i18n="tab_home">Home</span>
    <em class="tab-dot"></em>
  </a>
  <button class="tab-item" data-tab="search" type="button">
    <i class="fa-solid fa-magnifying-glass"></i>
    <span data-i18n="tab_search">Search</span>
    <em class="tab-dot"></em>
  </button>
  <a class="tab-item" data-tab="cart" href="cart.html" title="Cart" data-i18n-title="cart_title">
    <i class="fa-solid fa-cart-shopping"></i>
    <span class="tab-badge" id="mCartCount" data-n="0">0</span>
    <span data-i18n="tab_cart">Cart</span>
    <em class="tab-dot"></em>
  </a>
  <a class="tab-item" data-tab="wishlist" href="wishlist.html">
    <i class="fa-regular fa-heart"></i>
    <span class="tab-badge" id="mWishCount" data-n="0">0</span>
    <span data-i18n="tab_fav">Favorites</span>
    <em class="tab-dot"></em>
  </a>
  <button class="tab-item" data-tab="account" type="button">
    <i class="fa-regular fa-user"></i>
    <span data-i18n="tab_account">Account</span>
    <em class="tab-dot"></em>
  </button>
</nav>
<button id="backToTop" class="back-to-top" title="Back to top" data-i18n-title="back_top">
  <i class="fa-solid fa-arrow-up"></i>
</button>
<div class="toast-container position-fixed bottom-0 end-0 p-3">
  <div id="toast" class="toast align-items-center text-bg-dark border-0"><div class="d-flex"><div class="toast-body" id="toastMsg"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>
</div>`;

// Inject the shared chrome around the page's <main> (this script runs at the
// end of <body>, so the DOM is ready and i18n can translate right after).
document.body.insertAdjacentHTML('afterbegin', HEADER_HTML);
document.body.insertAdjacentHTML('beforeend', FOOTER_HTML + TABBAR_HTML);
if (typeof applyI18n === 'function') applyI18n();

function initHeaderSearch() {
  const input = $('searchInput');
  const btn = $('searchBtn');
  const go = () => {
    const q = input.value.trim();
    location.href = 'categories.html' + (q ? '?q=' + encodeURIComponent(q) : '');
  };
  if (btn) btn.onclick = go;
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// Sync the mobile bottom toolbar active tab with the current page
function initTabbar() {
  const map = { home: 'home', categories: 'home', product: 'home', cart: 'cart', checkout: 'cart', wishlist: 'wishlist', orders: 'account', settings: 'account' };
  const active = map[document.body.dataset.page] || '';
  document.querySelectorAll('.mobile-tabbar [data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === active);
    if (el.tagName !== 'BUTTON') return;
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (tab === 'search') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => $('searchInput')?.focus({ preventScroll: true }), 350);
      } else if (tab === 'account') {
        location.href = localStorage.getItem('am_user') ? 'orders.html' : 'login.html';
      }
    });
  });
}

function initBackToTop() {
  const btt = $('backToTop');
  if (!btt) return;
  window.addEventListener('scroll', () => {
    btt.classList.toggle('show', window.scrollY > 400);
  });
  btt.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
}

// "Coming soon" links + logout (account panel, header dropdown, settings)
document.addEventListener('click', e => {
  const soon = e.target.closest('[data-soon]');
  if (soon) { e.preventDefault(); toast(t('soon')); return; }
  const lo = e.target.closest('#logoutLink, #ddLogoutLink');
  if (lo) {
    e.preventDefault();
    localStorage.removeItem('am_user');
    renderAccountPanel();
    updateAccountUI();
    toast(t('logged_out'));
  }
});

(function coreInit() {
  loadState();
  setTheme(getTheme()); // sync with the pre-paint inline script
  updateBadges();
  renderNotifMenu();
  renderAccountPanel();
  updateAccountUI();
  initHeaderSearch();
  initTabbar();
  initBackToTop();
})();

// Re-render shared widgets when the language changes (pages handle their own content)
window.addEventListener('am:langchange', () => {
  renderAccountPanel();
  updateAccountUI();
  renderNotifMenu();
  if ($('categoryList') && categories.length) renderSidebar(sidebarActiveCat);
});
