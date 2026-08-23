/**
 * AM MARKET — core.js (shared infrastructure, loaded on every page after i18n.js)
 *
 *  - Storefront catalog access through the same-origin backend
 *  - Guest cart/wishlist state locally; authenticated state in MySQL via StoreAPI
 *  - Header, footer and mobile tabbar injection (each page only carries its own
 *    <main> content; everything else is rendered here)
 *  - Product card rendering + helpers (toast, badges, price formatting, sidebar)
 *
 * Page scripts (js/<page>.js) are loaded after this file and add their own logic.
 */

const STORE_FRONTEND_CONTEXT = document.body?.dataset.admin !== 'true';
const API = STORE_FRONTEND_CONTEXT ? '/api/v1/catalog' : 'https://api.mmarket.ma/api';
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

// ---------- State ----------
let cart = [];
let wishlist = [];
let orders = [];
let accountNotifications = [];
let accountUnreadCount = 0;
let currentUser = null;
let currentPreferences = null;
let savedAddresses = [];
let authenticatedRecent = [];
let authenticatedSearches = [];
let sessionKnown = !STORE_FRONTEND_CONTEXT;
let cartSyncPromise = Promise.resolve();
let wishlistSyncPromise = Promise.resolve();
let storeReady = Promise.resolve();

function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && item.id != null)
    .map(item => ({ ...item, id: String(item.id), qty: Math.min(99, Math.max(1, Math.floor(Number(item.qty) || 1))) }));
}

function loadState() {
  try {
    cart = normalizeCart(JSON.parse(localStorage.getItem(LS.cart)));
    const savedWish = JSON.parse(localStorage.getItem(LS.wish));
    wishlist = Array.isArray(savedWish) ? [...new Set(savedWish.filter(id => id != null).map(String))] : [];
    if (STORE_FRONTEND_CONTEXT) orders = [];
    else {
      const savedOrders = JSON.parse(localStorage.getItem(LS.orders));
      orders = Array.isArray(savedOrders) ? savedOrders.filter(order => order && order.id != null && Array.isArray(order.items)) : [];
    }
  } catch { cart = []; wishlist = []; orders = []; }
}

function cartFromApi(payload) {
  return normalizeCart((payload?.cart?.items || []).map(item => ({
    id: item.productId,
    qty: item.quantity,
    name: item.name,
    price: item.unitPrice,
    image_url: item.imageUrl,
    brand_name: item.brand || '',
    is_available: item.isAvailable,
    stock_quantity: item.stockQuantity,
    quantity_available: item.quantityAvailable,
    load_failed: item.verified === false
  })));
}

function wishlistFromApi(payload) {
  return (payload?.items || []).map(item => String(item.productId));
}

async function syncCartToServer(snapshot) {
  const remotePayload = await StoreAPI.cart.get();
  const remote = new Map((remotePayload.cart?.items || []).map(item => [String(item.productId), Number(item.quantity)]));
  const desired = new Map(snapshot.map(item => [String(item.id), Number(item.qty)]));
  if (desired.size === 0) {
    if (remote.size) await StoreAPI.cart.clear();
    cart = [];
    updateBadges();
    return;
  }
  for (const id of remote.keys()) {
    if (!desired.has(id)) await StoreAPI.cart.removeItem(id);
  }
  for (const [id, quantity] of desired) {
    if (!remote.has(id)) await StoreAPI.cart.addItem({ productId: id, quantity });
    else if (remote.get(id) !== quantity) await StoreAPI.cart.updateItem(id, { quantity });
  }
  cart = cartFromApi(await StoreAPI.cart.get());
  updateBadges();
}

function saveCart() {
  updateBadges();
  if (!currentUser) {
    localStorage.setItem(LS.cart, JSON.stringify(cart));
    return Promise.resolve();
  }
  const snapshot = cart.map(item => ({ id: String(item.id), qty: item.qty }));
  cartSyncPromise = cartSyncPromise.catch(() => {}).then(() => syncCartToServer(snapshot)).catch(async error => {
    console.error(error);
    toast(error.message || t('api_error'));
    try { cart = cartFromApi(await StoreAPI.cart.get()); updateBadges(); } catch { /* keep the optimistic UI */ }
    return null;
  });
  return cartSyncPromise;
}

async function syncWishlistToServer(snapshot) {
  const remotePayload = await StoreAPI.wishlist.get();
  const remote = new Set((remotePayload.items || []).map(item => String(item.productId)));
  const desired = new Set(snapshot.map(String));
  for (const id of remote) if (!desired.has(id)) await StoreAPI.wishlist.removeItem(id);
  for (const id of desired) if (!remote.has(id)) await StoreAPI.wishlist.addItem({ productId: id });
  wishlist = wishlistFromApi(await StoreAPI.wishlist.get());
  updateBadges();
}

function saveWish() {
  updateBadges();
  if (!currentUser) {
    localStorage.setItem(LS.wish, JSON.stringify(wishlist));
    return Promise.resolve();
  }
  const snapshot = [...wishlist];
  wishlistSyncPromise = wishlistSyncPromise.catch(() => {}).then(() => syncWishlistToServer(snapshot)).catch(async error => {
    console.error(error);
    toast(error.message || t('api_error'));
    try { wishlist = wishlistFromApi(await StoreAPI.wishlist.get()); updateBadges(); } catch { /* keep the optimistic UI */ }
    return null;
  });
  return wishlistSyncPromise;
}

function saveOrders() {
  if (!STORE_FRONTEND_CONTEXT) localStorage.setItem(LS.orders, JSON.stringify(orders));
  updateBadges();
  renderNotifMenu();
  return Promise.resolve();
}
function waitForStoreMutations() { return Promise.allSettled([cartSyncPromise, wishlistSyncPromise]); }
function whenStoreReady(callback) { return storeReady.then(callback); }

// Recently viewed (product snapshots, newest first, max 8)
function getRecent() {
  if (currentUser) return authenticatedRecent;
  try {
    const value = JSON.parse(localStorage.getItem(LS.recent));
    return Array.isArray(value) ? value.filter(p => p && p.id != null) : [];
  } catch { return []; }
}
function addRecent(product) {
  let list = getRecent().filter(p => String(p.id) !== String(product.id));
  list.unshift({
    id: product.id,
    name: product.name,
    price: product.price,
    image_url: product.image_url,
    brand_name: product.brand_name || '',
    is_available: product.is_available !== false
  });
  list = list.slice(0, 8);
  if (currentUser) {
    authenticatedRecent = list;
    StoreAPI.recent.record({ productId: String(product.id) }).catch(error => console.error(error));
  } else {
    localStorage.setItem(LS.recent, JSON.stringify(list));
  }
}

// ---------- API ----------
// Admin keeps its legacy catalog fallback. The storefront uses only the
// allowlisted same-origin backend and never sends customer traffic to proxies.
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
    if (!res.ok) {
      const error = new Error('HTTP ' + res.status);
      error.status = res.status;
      throw error;
    }
    return await res.json();
  } catch (e) {
    if (e?.status >= 400 && e.status < 500) throw e;
    if (STORE_FRONTEND_CONTEXT) throw e;
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
let productPromises = {}; // de-duplicate overlapping detail requests
let categories = [];
let categoriesPromise = null;

async function fetchCategories() {
  const data = await apiJSON(`${API}/categories/`);
  // Exclude smoking category
  return (Array.isArray(data) ? data : data.results || [])
    .filter(c => c.id !== EXCLUDE_CAT && c.parent_id == null);
}

async function fetchProducts(page = 1, categoryId = null, search = '', ordering = '', pageSize = 12) {
  const safePageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 12)));
  let url = `${API}/products/?include_descendants=true&page=${page}&page_size=${safePageSize}`;
  if (categoryId) url += `&category=${categoryId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (ordering) url += `&ordering=${encodeURIComponent(ordering)}`;
  const data = await apiJSON(url); // { count, next, previous, results }
  (data.results || []).forEach(p => { productCache[p.id] = p; });
  return data;
}

async function fetchProduct(id) {
  if (productCache[id]) return productCache[id];
  if (!productPromises[id]) {
    productPromises[id] = apiJSON(`${API}/products/${id}/`)
      .then(p => { productCache[id] = p; return p; })
      .finally(() => { delete productPromises[id]; });
  }
  return productPromises[id];
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
// The initial theme is applied by theme-init.js before first paint.
function getTheme() {
  if (currentPreferences?.theme) return currentPreferences.theme;
  return localStorage.getItem('am_theme') === 'dark' ? 'dark' : 'light';
}
function setTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('am_theme', t);
  if (currentUser) {
    currentPreferences = { ...(currentPreferences || {}), theme: t };
    StoreAPI.preferences.update({ theme: t }).catch(error => console.error(error));
  }
  applyTheme(t);
}

function applyTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('am_theme', value);
  document.documentElement.setAttribute('data-theme', value);
  document.documentElement.setAttribute('data-bs-theme', value); // Bootstrap dropdowns/toasts/inputs
}

// ---------- Saved preferences (used by settings + checkout) ----------
function getUser() {
  if (STORE_FRONTEND_CONTEXT) return currentUser;
  try { return JSON.parse(localStorage.getItem('am_user') || sessionStorage.getItem('am_user')); } catch { return null; }
}

function getProfile() {
  const user = getUser();
  if (user) return user;
  if (STORE_FRONTEND_CONTEXT && sessionKnown) return {};
  try { return JSON.parse(localStorage.getItem('am_profile')) || {}; } catch { return {}; }
}

function getDefaultPay() {
  if (currentPreferences?.defaultPayment) return currentPreferences.defaultPayment;
  const saved = localStorage.getItem('am_pay');
  return ['cod', 'card', 'wafacash', 'cashplus'].includes(saved) ? saved : 'cod';
}
function setDefaultPay(p) {
  const payment = ['cod', 'card', 'wafacash', 'cashplus'].includes(p) ? p : 'cod';
  localStorage.setItem('am_pay', payment);
  if (currentUser) {
    currentPreferences = { ...(currentPreferences || {}), defaultPayment: payment };
    StoreAPI.preferences.update({ defaultPayment: payment }).catch(error => console.error(error));
  }
}

function getDeliveryInfo() {
  if (currentUser) {
    const address = savedAddresses.find(item => item.isDefault) || savedAddresses[0];
    if (!address) return { name: currentUser.displayName, email: currentUser.email, phone: currentUser.phone || '' };
    return {
      id: address.id, name: address.recipientName, phone: address.phone, email: address.email || currentUser.email,
      address: address.addressLine1, addressLine2: address.addressLine2, city: address.city,
      quartier: address.district, postalCode: address.postalCode, instructions: address.deliveryInstructions
    };
  }
  try { return JSON.parse(localStorage.getItem('am_delivery')) || {}; } catch { return {}; }
}
function saveDeliveryInfo(info) {
  if (currentUser) return;
  localStorage.setItem('am_delivery', JSON.stringify(info || {}));
}

function formatPrice(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat(getLang() === 'fr' ? 'fr-FR' : 'en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(n)} DH`;
}

function normalizeMoroccanPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00212')) digits = digits.slice(5);
  else if (digits.startsWith('212')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

function isValidMoroccanPhone(value) {
  return /^[5-7]\d{8}$/.test(normalizeMoroccanPhone(value));
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}

function motionBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function skeletonCards(count = 8) {
  return Array.from({ length: count }, () => `
    <div class="col-6 col-md-4 col-xl-3" aria-hidden="true">
      <div class="product-card product-card-skeleton">
        <div class="skeleton-block skeleton-image"></div>
        <div class="skeleton-body">
          <div class="skeleton-block skeleton-line title"></div>
          <div class="skeleton-block skeleton-line short"></div>
          <div class="skeleton-block skeleton-line price"></div>
        </div>
      </div>
    </div>`).join('');
}

let toastActionHandler = null;
function toast(msg, actionLabel = '', action = null) {
  const el = $('toast');
  if (!el) return;
  $('toastMsg').textContent = msg;
  const actionBtn = $('toastAction');
  toastActionHandler = typeof action === 'function' ? action : null;
  if (actionBtn) {
    actionBtn.hidden = !toastActionHandler;
    actionBtn.textContent = actionLabel || '';
    actionBtn.onclick = () => {
      const handler = toastActionHandler;
      toastActionHandler = null;
      actionBtn.hidden = true;
      const instance = bootstrap.Toast.getOrCreateInstance(el, { delay: 4000 });
      if (!handler) { instance.hide(); return; }
      el.addEventListener('hidden.bs.toast', () => handler(), { once: true });
      instance.hide();
    };
  }
  bootstrap.Toast.getOrCreateInstance(el, { delay: 4000 }).show();
}

// ---------- Cart & wishlist actions ----------
function addToCart(id, qty = 1, product = null, silent = false) {
  id = String(id);
  const p = product || productCache[id] || null;
  if (p?.is_available === false) {
    if (!silent) toast(t('named_out_stock', { name: p.name || t('product_crumb') }));
    return false;
  }
  qty = Math.min(99, Math.max(1, Math.floor(Number(qty) || 1)));
  const item = cart.find(i => i.id === id);
  if (item) item.qty = Math.min(99, item.qty + qty);
  else {
    // Keep a product snapshot so cart/checkout pages can render without refetching
    cart.push(p
      ? { id, qty, name: p.name, price: p.price, image_url: p.image_url, brand_name: p.brand_name || '', is_available: p.is_available !== false }
      : { id, qty });
  }
  saveCart();
  if (!silent) toast(t('added_cart'));
  return true;
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
    // Prefer full product from API if we only have a thin snapshot (no image)
    const needsFetch = !p || !p.image_url;
    if (needsFetch) {
      try {
        p = await fetchProduct(c.id);
      } catch (error) {
        const hasTrustworthySnapshot = Boolean(c.name && Number.isFinite(parseFloat(c.price)) && parseFloat(c.price) > 0);
        p = p || {
          id: String(c.id),
          name: c.name || 'Product',
          price: c.price || 0,
          image_url: c.image_url || '',
          brand_name: c.brand_name || '',
          is_available: error?.status === 404 ? false : (hasTrustworthySnapshot && c.is_available !== false),
          load_failed: error?.status !== 404 && !hasTrustworthySnapshot
        };
      }
      productCache[c.id] = p;
    }
    if (c.name == null || String(c.price) !== String(p.price) || c.image_url !== p.image_url || c.is_available !== (p.is_available !== false) || Boolean(c.load_failed) !== Boolean(p.load_failed)) {
      c.name = p.name; c.price = p.price; c.image_url = p.image_url; c.brand_name = p.brand_name || ''; c.is_available = p.is_available !== false; c.load_failed = Boolean(p.load_failed);
      changed = true;
    }
    items.push({ id: String(c.id), qty: c.qty, product: p });
  }
  if (changed && !currentUser) localStorage.setItem(LS.cart, JSON.stringify(cart));
  return items;
}

function itemsSubtotal(items) {
  return items.reduce((s, i) => s + (parseFloat(i.product.price) || 0) * i.qty, 0);
}

// ---------- Badges / header widgets ----------
function updateBadges() {
  const cc = cart.reduce((s, i) => s + i.qty, 0);
  const wc = wishlist.length;
  const nc = currentUser ? accountUnreadCount : 0;
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
  if (!accountNotifications.length) {
    menu.innerHTML = `<li class="notif-empty">${t('notif_empty')}</li>`;
    return;
  }
  menu.innerHTML = accountNotifications.slice(0, 5).map(notification => `
    <li><a class="dropdown-item notif-item" href="${notification.orderId
      ? `orders.html?order=${encodeURIComponent(notification.orderId)}`
      : notification.productId
        ? `product.html?id=${encodeURIComponent(notification.productId)}`
        : 'settings.html'}" data-notification-id="${escapeHtml(notification.id)}">
      <i class="fa-solid ${notification.productId ? 'fa-box-open' : 'fa-bag-shopping'}"></i>
      <span>${escapeHtml(notification.payload?.message || notification.type.replaceAll('_', ' '))}<br><small class="text-muted">${new Date(notification.createdAt).toLocaleDateString()}</small></span>
    </a></li>`).join('');
  menu.querySelectorAll('[data-notification-id]').forEach(link => {
    link.addEventListener('click', async event => {
      event.preventDefault();
      const destination = link.getAttribute('href');
      const notification = accountNotifications.find(item => item.id === link.dataset.notificationId);
      try {
        await StoreAPI.notifications.markRead(link.dataset.notificationId);
        if (notification && !notification.readAt) {
          notification.readAt = new Date().toISOString();
          accountUnreadCount = Math.max(0, accountUnreadCount - 1);
          updateBadges();
        }
      } catch (error) {
        console.error(error);
      } finally {
        location.href = destination;
      }
    });
  });
}

function renderAccountPanel() {
  const nameEl = $('apName');
  const link = $('apProfileLink');
  const row = $('logoutRow');
  const u = getUser();
  if (nameEl) nameEl.textContent = u && (u.displayName || u.name) ? (u.displayName || u.name) : t('guest');
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
    label.textContent = u && (u.displayName || u.name) ? (u.displayName || u.name) : t('my_account');
  }
  const userRow = $('ddUserRow');
  if (userRow) {
    userRow.style.display = u ? '' : 'none';
    $('ddUserName').textContent = u ? (u.email || u.displayName || u.name || '') : '';
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
  // Prioritize school / office supplies (Fournitures Bureau) during rentrée
  const RENTREE_CAT = 1363;
  const sorted = [...categories].sort((a, b) => {
    if (a.id === RENTREE_CAT) return -1;
    if (b.id === RENTREE_CAT) return 1;
    return 0;
  });
  list.innerHTML = `
    <a class="list-group-item ${activeCat == null ? 'active' : ''}" href="categories.html">
      🏪 ${t('all_categories')}
    </a>
    ${sorted.map(c => `
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
  const available = p.is_available !== false;
  const disc = parseInt(p.discount_percent) || 0;
  const oldPrice = parseFloat(p.original_price);
  const hasOld = oldPrice > 0 && oldPrice > parseFloat(p.price);
  const href = 'product.html?id=' + encodeURIComponent(p.id);
  return `
    <div class="col-6 col-md-4 col-xl-3">
      <div class="product-card ${available ? '' : 'is-unavailable'}">
        ${disc > 0 ? `<span class="badge-disc">-${disc}%</span>` : (p.is_promo ? `<span class="badge-disc badge-promo">${t('promo')}</span>` : '')}
        <a class="product-img" href="${href}">
          <img src="${img || 'img/placeholder.svg'}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async"
               data-product-image data-image-fallback="img/placeholder.svg">
        </a>
        <div class="product-body">
          <a class="product-title" href="${href}">${escapeHtml(p.name)}</a>
          <div class="product-meta">
            <div class="product-brand">${p.brand_name ? escapeHtml(p.brand_name) : 'AM Market'}</div>
            <span class="product-stock ${available ? '' : 'out'}">${t(available ? 'in_stock' : 'out_stock')}</span>
          </div>
          <div class="product-foot">
            <div class="product-price">
              <span class="current">${formatPrice(p.price)}</span>
              ${hasOld ? `<span class="old">${formatPrice(oldPrice)}</span>` : ''}
            </div>
            <div class="card-actions">
              <button class="wish-btn ${inWish ? 'active' : ''}" data-wish="${p.id}" title="${t('wish_title')}"
                      aria-label="${escapeHtml(t(inWish ? 'remove_named_wish' : 'add_named_wish', { name: p.name }))}"
                      aria-pressed="${inWish}">
                <i class="fa-${inWish ? 'solid' : 'regular'} fa-heart"></i>
              </button>
              <button class="add-btn" data-id="${p.id}" title="${t(available ? 'add_to_cart' : 'out_stock')}"
                      aria-label="${escapeHtml(t(available ? 'add_named_cart' : 'named_out_stock', { name: p.name }))}" ${available ? '' : 'disabled'}>
                <i class="fa-solid fa-cart-plus"></i>
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
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      addToCart(btn.dataset.id);
      const icon = btn.querySelector('i');
      btn.classList.add('is-added');
      if (icon) icon.className = 'fa-solid fa-check';
      setTimeout(() => {
        btn.classList.remove('is-added');
        if (icon) icon.className = 'fa-solid fa-cart-plus';
      }, 650);
    };
  });
  container.querySelectorAll('[data-wish]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = String(btn.dataset.wish);
      const wasSaved = wishlist.includes(id);
      toggleWish(id);
      const syncButton = () => {
        const saved = wishlist.includes(id);
        const name = btn.closest('.product-card')?.querySelector('.product-title')?.textContent?.trim() || t('product_crumb');
        btn.classList.toggle('active', saved);
        btn.setAttribute('aria-pressed', String(saved));
        btn.setAttribute('aria-label', t(saved ? 'remove_named_wish' : 'add_named_wish', { name }));
        const icon = btn.querySelector('i');
        if (icon) icon.className = `fa-${saved ? 'solid' : 'regular'} fa-heart`;
      };
      syncButton();
      if (wasSaved) {
        toast(t('removed_wish'), t('undo'), () => {
          if (!wishlist.includes(id)) wishlist.push(id);
          saveWish();
          if (rerender) rerender({ restoreFocus: true });
          else {
            syncButton();
            btn.focus({ preventScroll: true });
          }
          toast(t('added_wish'));
        });
      }
      btn.classList.add('is-pulsing');
      setTimeout(() => {
        btn.classList.remove('is-pulsing');
        if (rerender) rerender({ restoreFocus: true, removedWishId: btn.dataset.wish });
      }, 220);
    };
  });
}

// ---------- Shared layout: header / footer / tabbar ----------
const HEADER_HTML = `
<a class="skip-link" href="#mainContent" data-i18n="skip_content">Skip to main content</a>
<header class="top-header">
  <div class="container-fluid px-3 px-lg-4">
    <div class="header-card d-flex align-items-center gap-3 header-row">
      <a href="index.html" class="logo" aria-label="AM MARKET home" data-i18n-aria="home_link">
        <img src="img/logo-round.png" alt="AM MARKET" class="logo-img">
        <span class="logo-text">
          <span class="brand">AM <span class="text-orange">MARKET</span></span>
          <small data-i18n="tagline">SHOP MORE, LIVE BETTER</small>
        </span>
      </a>

      <div class="search-box flex-grow-1">
        <div class="input-group">
          <span class="search-lead"><i class="fa-solid fa-magnifying-glass"></i></span>
          <input type="search" class="form-control" id="searchInput" placeholder="Search for products, brands and more..."
                 data-i18n-ph="search_ph" aria-label="Search products" data-i18n-aria="search_label"
                 role="combobox" aria-autocomplete="list" aria-controls="searchSuggestions" aria-expanded="false" autocomplete="off" />
          <button class="btn btn-orange" id="searchBtn" title="Search" data-i18n-title="search_btn"
                  aria-label="Search" data-i18n-aria="search_btn"><i class="fa-solid fa-magnifying-glass"></i></button>
        </div>
        <div class="search-suggestions" id="searchSuggestions" role="listbox" aria-label="Search suggestions"
             data-i18n-aria="search_suggestions" hidden></div>
      </div>

      <div class="d-flex align-items-center gap-1 gap-lg-2 header-actions">
        <button class="btn-icon lang-btn" data-lang-toggle title="Français / English"
                aria-label="Change language" data-i18n-aria="change_language">
          <i class="fa-solid fa-globe"></i>
        </button>
        <a class="btn-icon" href="wishlist.html" title="Wishlist" data-i18n-title="wish_title"
           aria-label="Wishlist" data-i18n-aria="wish_title">
          <i class="fa-regular fa-heart"></i>
          <span class="badge-count" id="wishCount">0</span>
        </a>
        <a class="btn-icon" href="cart.html" title="Cart" data-i18n-title="cart_title"
           aria-label="Cart" data-i18n-aria="cart_title">
          <i class="fa-solid fa-cart-shopping"></i>
          <span class="badge-count" id="cartCount">0</span>
        </a>
        <div class="dropdown">
          <button class="btn-icon dropdown-toggle" data-bs-toggle="dropdown" title="Notifications" data-i18n-title="notif_title"
                  aria-label="Notifications" data-i18n-aria="notif_title">
            <i class="fa-regular fa-bell"></i>
            <span class="badge-count" id="notifCount">0</span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end notif-menu" id="notifMenu"></ul>
        </div>
        <div class="dropdown">
          <button class="btn-icon account-pill dropdown-toggle" data-bs-toggle="dropdown" title="Account"
                  aria-label="Account" data-i18n-aria="account_label">
            <i class="fa-regular fa-user"></i>
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
          <a class="footer-help-link" href="help.html"><i class="fa-regular fa-circle-question"></i> <span data-i18n="help_center">Help Center</span></a>
        </div>

        <!-- Categories -->
        <div class="col-lg-3 col-md-6">
          <h6 class="footer-heading" data-i18n="footer_cats">Catégories</h6>
          <ul class="footer-nav-list">
            <li><a href="categories.html?cat=1363"><i class="fa-solid fa-pen"></i> <span data-i18n="fcat_school">Fournitures</span></a></li>
            <li><a href="categories.html"><i class="fa-solid fa-basket-shopping"></i> <span data-i18n="fcat_food">Alimentation</span></a></li>
            <li><a href="categories.html"><i class="fa-solid fa-bottle-water"></i> <span data-i18n="fcat_drinks">Boissons</span></a></li>
            <li><a href="categories.html"><i class="fa-solid fa-soap"></i> <span data-i18n="fcat_hygiene">Hygiène</span></a></li>
          </ul>
        </div>

        <!-- Help -->
        <div class="col-lg-3 col-md-6">
          <h6 class="footer-heading" data-i18n="footer_help">Aide</h6>
          <ul class="footer-nav-list">
            <li><a href="help.html#about"><i class="fa-solid fa-circle-info"></i> <span data-i18n="about">À propos</span></a></li>
            <li><a href="help.html#orders-help"><i class="fa-solid fa-headset"></i> <span data-i18n="orders_help">Order help</span></a></li>
            <li><a href="help.html#faqs"><i class="fa-regular fa-circle-question"></i> <span data-i18n="faqs">FAQs</span></a></li>
            <li><a href="help.html#delivery"><i class="fa-solid fa-truck"></i> <span data-i18n="delivery_link">Livraison</span></a></li>
          </ul>
        </div>

        <!-- Help center -->
        <div class="col-lg-3 col-md-6">
          <h6 class="footer-heading" data-i18n="help_center">Help Center</h6>
          <p class="footer-desc mb-3" data-i18n="help_center_sub">Delivery, payment and return answers in one place.</p>
          <a class="footer-support-cta" href="help.html">
            <i class="fa-solid fa-arrow-right"></i>
            <span data-i18n="open_help_center">Open Help Center</span>
          </a>
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
      </div>
    </div>
  </div>
</footer>`;

const TABBAR_HTML = `
<nav class="mobile-tabbar" aria-label="Mobile navigation" data-i18n-aria="mobile_nav">
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
  <div id="toast" class="toast align-items-center text-bg-dark border-0" role="status" aria-live="polite">
    <div class="d-flex">
      <div class="toast-body" id="toastMsg"></div>
      <button type="button" class="toast-action" id="toastAction" hidden></button>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close" data-i18n-aria="close"></button>
    </div>
  </div>
</div>`;

// Inject the shared chrome around the page's <main> (this script runs at the
// end of <body>, so the DOM is ready and i18n can translate right after).
// Admin pages reuse the read-only catalog helpers from this file but render
// their own isolated shell. Customer pages do not set this data attribute.
const STORE_CORE_ADMIN_CONTEXT = document.body?.dataset.admin === 'true';
if (!STORE_CORE_ADMIN_CONTEXT) {
  document.body.insertAdjacentHTML('afterbegin', HEADER_HTML);
  document.body.insertAdjacentHTML('beforeend', FOOTER_HTML + TABBAR_HTML);
  const mainContent = document.querySelector('main');
  if (mainContent && !mainContent.id) mainContent.id = 'mainContent';
  if (typeof applyI18n === 'function') applyI18n();
}

function initHeaderSearch() {
  const input = $('searchInput');
  const btn = $('searchBtn');
  const box = $('searchSuggestions');
  if (!input || !box) return;

  const cache = new Map();
  let timer = null;
  let requestSeq = 0;
  let activeIndex = -1;

  const go = (value = input.value) => {
    const q = value.trim();
    if (q && currentUser) {
      const known = cache.get(q.toLowerCase());
      const resultsCount = Array.isArray(known) ? known.length : undefined;
      StoreAPI.search.record({ query: q, ...(resultsCount === undefined ? {} : { resultsCount }) })
        .catch(error => console.error(error));
      authenticatedSearches = [
        { query: q, resultsCount, lastSearchedAt: new Date().toISOString() },
        ...authenticatedSearches.filter(item => item.query.toLowerCase() !== q.toLowerCase())
      ].slice(0, 10);
    }
    location.href = 'categories.html' + (q ? '?q=' + encodeURIComponent(q) : '');
  };

  const close = () => {
    box.hidden = true;
    box.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const open = html => {
    box.innerHTML = html;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    activeIndex = -1;
  };

  const renderProducts = (list, query, labelKey = 'search_suggestions') => {
    if (!list.length) {
      open(`<div class="search-suggestion-status">${t('search_no_suggestions')}</div>
        <a class="search-suggestion-all" href="categories.html?q=${encodeURIComponent(query)}">
          <span>${t('search_all_results', { q: escapeHtml(query) })}</span><i class="fa-solid fa-arrow-right"></i>
        </a>`);
      return;
    }
    list.forEach(p => { productCache[p.id] = p; });
    open(`<div class="search-suggestion-label">${t(labelKey)}</div>${list.slice(0, 5).map((p, i) => `
      <a class="search-suggestion" id="searchOption${i}" role="option" href="product.html?id=${encodeURIComponent(p.id)}">
        <img src="${p.image_url || 'img/placeholder.svg'}" alt="" loading="eager" data-image-fallback="img/placeholder.svg">
        <span class="search-suggestion-copy">
          <strong>${escapeHtml(p.name)}</strong>
          <small>${escapeHtml(p.brand_name || 'AM Market')}</small>
        </span>
        <span class="search-suggestion-price">${formatPrice(p.price)}</span>
      </a>`).join('')}
      <a class="search-suggestion-all" href="categories.html?q=${encodeURIComponent(query)}">
        <span>${t('search_all_results', { q: escapeHtml(query) })}</span><i class="fa-solid fa-arrow-right"></i>
      </a>`);
  };

  const showRecent = () => {
    if (currentUser && authenticatedSearches.length) {
      open(`<div class="search-suggestion-label">${getLang() === 'fr' ? 'Recherches récentes' : 'Recent searches'}</div>${authenticatedSearches.slice(0, 5).map((item, i) => `
        <a class="search-suggestion search-history-item" id="searchOption${i}" role="option" href="categories.html?q=${encodeURIComponent(item.query)}" data-search-query="${escapeHtml(item.query)}">
          <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
          <span class="search-suggestion-copy"><strong>${escapeHtml(item.query)}</strong></span>
        </a>`).join('')}`);
      return;
    }
    const recent = getRecent().slice(0, 4);
    if (recent.length) renderProducts(recent, '', 'recently_viewed');
    else close();
  };

  const requestSuggestions = async query => {
    const q = query.trim();
    if (q.length < 2) { if (!q) showRecent(); else close(); return; }
    const seq = ++requestSeq;
    open(`<div class="search-suggestion-status"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${t('loading')}</div>`);
    try {
      let list = cache.get(q.toLowerCase());
      if (!list) {
        const data = await StoreAPI.search.suggestions(q);
        list = data.products || [];
        cache.set(q.toLowerCase(), list);
      }
      if (seq !== requestSeq || input.value.trim() !== q) return;
      renderProducts(list, q);
    } catch {
      if (seq === requestSeq) open(`<div class="search-suggestion-status">${t('search_unavailable')}</div>`);
    }
  };

  btn?.addEventListener('click', () => go());
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) requestSuggestions(input.value);
    else showRecent();
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => requestSuggestions(input.value), 280);
  });
  input.addEventListener('keydown', e => {
    const options = [...box.querySelectorAll('.search-suggestion, .search-suggestion-all')];
    if (e.key === 'Escape') { close(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
      e.preventDefault();
      activeIndex = e.key === 'ArrowDown'
        ? (activeIndex + 1) % options.length
        : (activeIndex - 1 + options.length) % options.length;
      options.forEach((o, i) => o.classList.toggle('is-active', i === activeIndex));
      input.setAttribute('aria-activedescendant', options[activeIndex].id || '');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) {
        const selectedQuery = options[activeIndex].dataset.searchQuery;
        if (selectedQuery) go(selectedQuery);
        else {
          if (input.value.trim() && currentUser) StoreAPI.search.record({ query: input.value.trim() }).catch(error => console.error(error));
          location.href = options[activeIndex].href;
        }
      }
      else go();
    }
  });
  box.addEventListener('click', event => {
    const link = event.target.closest('.search-suggestion, .search-suggestion-all');
    if (!link || !currentUser) return;
    const query = link.dataset.searchQuery || input.value.trim();
    if (query) StoreAPI.search.record({ query }).catch(error => console.error(error));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) close();
  });
}

// Sync the mobile bottom toolbar active tab with the current page
function initTabbar() {
  const map = { home: 'home', categories: 'home', product: 'home', cart: 'cart', checkout: 'cart', wishlist: 'wishlist', orders: 'account', settings: 'account', help: 'account' };
  const active = map[document.body.dataset.page] || '';
  document.querySelectorAll('.mobile-tabbar [data-tab]').forEach(el => {
    const isActive = el.dataset.tab === active;
    el.classList.toggle('active', isActive);
    if (isActive) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    if (el.tagName !== 'BUTTON') return;
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (tab === 'search') {
        window.scrollTo({ top: 0, behavior: motionBehavior() });
        setTimeout(() => $('searchInput')?.focus({ preventScroll: true }), 350);
      } else if (tab === 'account') {
        location.href = 'settings.html';
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
  btt.onclick = () => window.scrollTo({ top: 0, behavior: motionBehavior() });
}

function initSafeImageFallbacks() {
  document.addEventListener('load', event => {
    const image = event.target.closest?.('img[data-product-image]');
    image?.parentElement?.classList.add('is-loaded');
  }, true);
  document.addEventListener('error', event => {
    const image = event.target.closest?.('img[data-image-fallback]');
    if (!image || image.dataset.fallbackApplied === 'true') return;
    image.dataset.fallbackApplied = 'true';
    image.src = image.dataset.imageFallback;
  }, true);
}

// "Coming soon" links + logout (account panel, header dropdown, settings)
document.addEventListener('click', e => {
  const soon = e.target.closest('[data-soon]');
  if (soon) { e.preventDefault(); toast(t('soon')); return; }
  const lo = e.target.closest('#logoutLink, #ddLogoutLink');
  if (lo) {
    e.preventDefault();
    if (STORE_FRONTEND_CONTEXT) {
      StoreAPI.auth.logout().then(() => {
        currentUser = null;
        currentPreferences = null;
        savedAddresses = [];
        cart = [];
        wishlist = [];
        orders = [];
        accountNotifications = [];
        accountUnreadCount = 0;
        authenticatedRecent = [];
        authenticatedSearches = [];
        updateBadges();
        renderNotifMenu();
        renderAccountPanel();
        updateAccountUI();
        location.replace('index.html');
      }).catch(error => toast(error.message || t('api_error')));
    } else {
      localStorage.removeItem('am_user');
      sessionStorage.removeItem('am_user');
      renderAccountPanel();
      updateAccountUI();
      toast(t('logged_out'));
    }
  }
});

async function loadAuthenticatedState() {
  localStorage.removeItem('am_user');
  sessionStorage.removeItem('am_user');
  const session = await StoreAPI.bootstrap();
  sessionKnown = true;
  if (!session.authenticated) {
    currentUser = null;
    return;
  }
  currentUser = { ...session.user, name: session.user.displayName };
  currentPreferences = session.user.preferences || null;
  cart = [];
  wishlist = [];
  accountNotifications = [];
  authenticatedRecent = [];
  authenticatedSearches = [];
  savedAddresses = [];
  const resources = await Promise.allSettled([
    StoreAPI.cart.get(),
    StoreAPI.wishlist.get(),
    StoreAPI.notifications.list({ limit: 20 }),
    StoreAPI.recent.list({ limit: 8 }),
    StoreAPI.addresses.list(),
    StoreAPI.search.history({ limit: 10 })
  ]);
  const valueAt = index => resources[index].status === 'fulfilled' ? resources[index].value : null;
  const cartPayload = valueAt(0);
  const wishPayload = valueAt(1);
  const notificationPayload = valueAt(2);
  const recentPayload = valueAt(3);
  const addressPayload = valueAt(4);
  const searchPayload = valueAt(5);
  if (cartPayload) cart = cartFromApi(cartPayload);
  if (wishPayload) wishlist = wishlistFromApi(wishPayload);
  accountNotifications = notificationPayload?.notifications || [];
  accountUnreadCount = Number.isFinite(Number(notificationPayload?.unreadCount))
    ? Number(notificationPayload.unreadCount)
    : accountNotifications.filter(item => !item.readAt).length;
  savedAddresses = addressPayload?.addresses || [];
  authenticatedSearches = searchPayload?.searches || [];
  authenticatedRecent = (recentPayload?.products || []).map(product => ({
    id: product.id,
    name: product.name,
    price: product.price,
    image_url: product.imageUrl,
    brand_name: product.brand || '',
    is_available: product.isAvailable
  }));
  if (currentPreferences?.theme) applyTheme(currentPreferences.theme);
  if (currentPreferences?.language && typeof setLang === 'function' && getLang() !== currentPreferences.language) {
    setLang(currentPreferences.language, { persist: false });
  }
}

async function initializeStorefrontState() {
  if (!STORE_FRONTEND_CONTEXT || !window.StoreAPI) return;
  try {
    await loadAuthenticatedState();
  } catch (error) {
    sessionKnown = true;
    currentUser = null;
    console.error('Store session bootstrap failed', error);
  } finally {
    updateBadges();
    renderNotifMenu();
    renderAccountPanel();
    updateAccountUI();
    window.dispatchEvent(new CustomEvent('am:store-ready'));
  }
}

(function coreInit() {
  loadState();
  applyTheme(getTheme()); // sync with the pre-paint theme script without a preference write
  updateBadges();
  renderNotifMenu();
  renderAccountPanel();
  updateAccountUI();
  initHeaderSearch();
  initTabbar();
  initBackToTop();
  initSafeImageFallbacks();
  storeReady = initializeStorefrontState();
})();

// Re-render shared widgets when the language changes (pages handle their own content)
window.addEventListener('am:langchange', () => {
  renderAccountPanel();
  updateAccountUI();
  renderNotifMenu();
  if ($('categoryList') && categories.length) renderSidebar(sidebarActiveCat);
});
