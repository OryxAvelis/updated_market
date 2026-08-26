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
const STORE_DOCUMENT_URL = new URL(document.baseURI);
const STATIC_CATALOG_PREVIEW = STORE_DOCUMENT_URL.protocol === 'file:' ||
  (['127.0.0.1', 'localhost'].includes(STORE_DOCUMENT_URL.hostname) && STORE_DOCUMENT_URL.port === '8785');
const SUPPORTED_PAYMENT_METHODS = ['cod', 'wafacash', 'cashplus'];

// Shared Font Awesome icons for category surfaces (sidebar, Home and directory).
const CAT_ICONS = {
  // French names (as returned by the API)
  'boissons':               'fa-bottle-water',
  'hygiene':                'fa-pump-soap',
  'produits laitiers':      'fa-cheese',
  'glaces':                 'fa-ice-cream',
  'epicerie':               'fa-basket-shopping',
  'fruits sec':             'fa-seedling',
  'friandise':              'fa-candy-cane',
  'maison cuisine':         'fa-kitchen-set',
  'univers bebe':           'fa-baby',
  'snacks sucres':          'fa-cookie-bite',
  'animaux':                'fa-paw',
  'snacks sales':           'fa-bowl-food',
  'boulangerie patisserie': 'fa-bread-slice',
  'nettoyage':              'fa-broom',
  'cadeaux fetes':          'fa-gift',
  'fournitures bureau':     'fa-paperclip',
  'divertissement':         'fa-gamepad',
  'frais':                  'fa-carrot',
  'petit dejeuner':         'fa-mug-hot',
  'asiatique':              'fa-bowl-rice',
  'accessoire telephone':   'fa-mobile-screen-button',
  // English names (fallbacks)
  'beverages':              'fa-bottle-water',
  'personal care':          'fa-pump-soap',
  'dairy products':         'fa-cheese',
  'ice creams':             'fa-ice-cream',
  'groceries':              'fa-basket-shopping',
  'dried fruits':           'fa-seedling',
  'candies':                'fa-candy-cane',
  'home & kitchen':         'fa-kitchen-set',
  'baby & kids':            'fa-baby',
  'sweet & chocolates':     'fa-cookie-bite',
  'pet supplies':           'fa-paw',
  'snacks':                 'fa-bowl-food',
  'bakery':                 'fa-bread-slice',
  'cleaning':               'fa-broom',
  'gifts':                  'fa-gift',
  'stationery':             'fa-paperclip',
  'entertainment':          'fa-gamepad',
  'fresh food':             'fa-carrot',
  'breakfast':              'fa-mug-hot',
  'asian food':             'fa-bowl-rice',
  'phone accessories':      'fa-mobile-screen-button',
};

function getCatIcon(cat) {
  const key = String(cat?.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const iconClass = CAT_ICONS[key] || 'fa-store';
  return `<i class="fa-solid ${iconClass} category-icon" aria-hidden="true"></i>`;
}

const LS = {
  cart: 'am_cart',
  wish: 'am_wish',
  orders: 'am_orders',
  recent: 'am_recent'
};

const STORE_AUTH_CHANNEL_NAME = 'am-market-auth-state-v1';
const STORE_AUTH_SESSION_LOCK_NAME = 'am-market-auth-session-v1';
const MAX_GUEST_COMMERCE_ITEMS = 100;

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
let cartSyncPromise = Promise.resolve(true);
let wishlistSyncPromise = Promise.resolve();
// Baselines detect each local edit; touched IDs stay pending until a current
// authoritative refresh succeeds, so a later queued save can repair a failed one.
let authenticatedCartSyncBaseline = new Map();
let authenticatedWishlistSyncBaseline = new Set();
let authenticatedCartPendingSyncIds = new Set();
let authenticatedWishlistPendingSyncIds = new Set();
let cartSyncRevision = 0;
let wishlistSyncRevision = 0;
let storeReady = Promise.resolve();
let authStateEpoch = 0;
let sessionExpiryHandled = false;
let storeAuthChannel = null;
const authenticatedResourceState = {
  cart: 'ready',
  wishlist: 'ready',
  notifications: 'ready',
  recent: 'ready',
  search: 'ready'
};
let accountRecoveryPending = false;

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
  if (!payload?.cart || !Array.isArray(payload.cart.items)) throw new TypeError('Invalid cart response');
  if (payload.cart.items.some(item => !item || typeof item !== 'object' || item.productId == null ||
      !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 99)) {
    throw new TypeError('Invalid cart item');
  }
  const normalized = normalizeCart(payload.cart.items.map(item => ({
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
  if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new TypeError('Duplicate cart item');
  return normalized;
}

function wishlistFromApi(payload) {
  if (!Array.isArray(payload?.items)) throw new TypeError('Invalid wishlist response');
  if (payload.items.some(item => !item || typeof item !== 'object' || item.productId == null)) {
    throw new TypeError('Invalid wishlist item');
  }
  const items = payload.items.map(item => String(item.productId));
  if (new Set(items).size !== items.length) throw new TypeError('Duplicate wishlist item');
  return items;
}

function cartSyncState(items) {
  return new Map(normalizeCart(items).map(item => [String(item.id), Number(item.qty)]));
}

function wishlistSyncState(items) {
  return new Set((Array.isArray(items) ? items : []).filter(id => id != null).map(String));
}

function adoptAuthenticatedCartState(items) {
  const normalized = normalizeCart(items);
  authenticatedCartSyncBaseline = cartSyncState(normalized);
  authenticatedCartPendingSyncIds = new Set();
  return normalized;
}

function adoptAuthenticatedCart(payload) {
  return adoptAuthenticatedCartState(cartFromApi(payload));
}

function adoptAuthenticatedWishlistState(items) {
  const normalized = [...wishlistSyncState(items)];
  authenticatedWishlistSyncBaseline = new Set(normalized);
  authenticatedWishlistPendingSyncIds = new Set();
  return normalized;
}

function adoptAuthenticatedWishlist(payload) {
  return adoptAuthenticatedWishlistState(wishlistFromApi(payload));
}

function resetAuthenticatedCommerceSyncState() {
  authenticatedCartSyncBaseline = new Map();
  authenticatedWishlistSyncBaseline = new Set();
  authenticatedCartPendingSyncIds = new Set();
  authenticatedWishlistPendingSyncIds = new Set();
  cartSyncRevision += 1;
  wishlistSyncRevision += 1;
}

function cartSyncIntents(previous, desired) {
  const intents = [];
  previous.forEach((_quantity, id) => {
    if (!desired.has(id)) intents.push({ type: 'remove', id });
  });
  desired.forEach((quantity, id) => {
    if (!previous.has(id) || previous.get(id) !== quantity) {
      intents.push({ type: 'set', id, quantity });
    }
  });
  return intents;
}

function wishlistSyncIntents(previous, desired) {
  const intents = [];
  previous.forEach(id => {
    if (!desired.has(id)) intents.push({ type: 'remove', id });
  });
  desired.forEach(id => {
    if (!previous.has(id)) intents.push({ type: 'add', id });
  });
  return intents;
}

function notificationsFromApi(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.notifications) || payload.notifications.length > 50) {
    throw new TypeError('Invalid notifications response');
  }
  const notifications = payload.notifications.map(item => {
    if (!item || typeof item !== 'object' || item.id == null) throw new TypeError('Invalid notification item');
    return {
      id: String(item.id),
      type: typeof item.type === 'string' ? item.type : '',
      orderId: item.orderId == null ? null : String(item.orderId),
      productId: item.productId == null ? null : String(item.productId),
      productName: typeof item.productName === 'string' ? item.productName : '',
      payload: { stockQuantity: item.payload?.stockQuantity },
      readAt: item.readAt || null,
      createdAt: item.createdAt || null,
      expiresAt: item.expiresAt || null
    };
  });
  const unreadCount = payload.unreadCount == null
    ? notifications.filter(item => !item.readAt).length
    : Number(payload.unreadCount);
  if (!Number.isSafeInteger(unreadCount) || unreadCount < 0) throw new TypeError('Invalid notification count');
  return { notifications, unreadCount };
}

function recentFromApi(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.products) || payload.products.length > 50) {
    throw new TypeError('Invalid recently viewed response');
  }
  return payload.products.map(product => {
    const price = Number(product?.price);
    if (!product || typeof product !== 'object' || product.id == null ||
        typeof product.name !== 'string' || product.price == null || product.price === '' ||
        !Number.isFinite(price) || price < 0 ||
        typeof product.isAvailable !== 'boolean') {
      throw new TypeError('Invalid recently viewed product');
    }
    return {
      id: String(product.id),
      name: product.name,
      price: price.toFixed(2),
      image_url: typeof product.imageUrl === 'string' ? product.imageUrl : '',
      brand_name: typeof product.brand === 'string' ? product.brand : '',
      is_available: product.isAvailable !== false
    };
  });
}

function searchesFromApi(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.searches) || payload.searches.length > 50) {
    throw new TypeError('Invalid search history response');
  }
  return payload.searches.map(item => {
    const query = typeof item?.query === 'string' ? item.query.trim() : '';
    if (!query || query.length > 100) throw new TypeError('Invalid search history item');
    return {
      query,
      resultsCount: Number.isSafeInteger(Number(item.resultsCount)) && Number(item.resultsCount) >= 0
        ? Number(item.resultsCount)
        : null,
      count: Number.isSafeInteger(Number(item.count)) && Number(item.count) >= 0 ? Number(item.count) : 0,
      lastSearchedAt: item.lastSearchedAt || null
    };
  });
}

function markAuthenticatedResourceReady(resource) {
  const recovered = authenticatedResourceState[resource] !== 'ready';
  authenticatedResourceState[resource] = 'ready';
  if (!recovered) return;
  renderAccountRecovery();
  window.dispatchEvent(new CustomEvent('am:account-resources-recovered', { detail: { resources: [resource] } }));
}

function normalizeStoreSignedOutReason(reason) {
  if (reason === 'unauthorized' || reason === 'account-closed' ||
      reason === 'password-changed' || reason === 'password-reset' ||
      reason === 'account-changed' || reason === 'session-changed') return reason;
  return 'logout';
}

async function withStoreAuthSessionLock(work) {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') {
    const error = new Error('A cross-tab account lock is unavailable.');
    error.code = 'AUTH_LOCK_UNAVAILABLE';
    throw error;
  }
  return locks.request(STORE_AUTH_SESSION_LOCK_NAME, { mode: 'exclusive' }, work);
}

function preserveGuestCommerceAfterExternalSessionChange() {
  authStateEpoch += 1;
  sessionExpiryHandled = true;
  currentPreferences = null;
  savedAddresses = [];
  orders = [];
  accountNotifications = [];
  accountUnreadCount = 0;
  authenticatedRecent = [];
  authenticatedSearches = [];
  sessionKnown = true;
  accountRecoveryPending = false;
  cartSyncPromise = Promise.resolve(true);
  wishlistSyncPromise = Promise.resolve();
  resetAuthenticatedCommerceSyncState();
  Object.keys(authenticatedResourceState).forEach(resource => {
    authenticatedResourceState[resource] = 'ready';
  });
  loadState();
  updateBadges();
  renderNotifMenu();
  renderAccountPanel();
  updateAccountUI();
  renderAccountRecovery();
  syncVisibleWishlistControls();
}

function transitionStoreToSignedOut({ reason = 'unauthorized', notify = true } = {}) {
  if (!currentUser) {
    preserveGuestCommerceAfterExternalSessionChange();
    return false;
  }
  const normalizedReason = normalizeStoreSignedOutReason(reason);
  sessionExpiryHandled = true;
  authStateEpoch += 1;
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
  sessionKnown = true;
  accountRecoveryPending = false;
  cartSyncPromise = Promise.resolve(true);
  wishlistSyncPromise = Promise.resolve();
  resetAuthenticatedCommerceSyncState();
  Object.keys(authenticatedResourceState).forEach(resource => {
    authenticatedResourceState[resource] = 'ready';
  });

  try {
    localStorage.removeItem('am_user');
    localStorage.removeItem('am_profile');
    localStorage.removeItem('am_delivery');
    localStorage.removeItem(LS.orders);
  } catch (storageError) {
    console.warn('[AM MARKET] Could not clear legacy local account state', storageError);
  }
  try {
    sessionStorage.removeItem('am_user');
    sessionStorage.removeItem('am_profile');
  } catch (storageError) {
    console.warn('[AM MARKET] Could not clear legacy session account state', storageError);
  }
  if (STORE_FRONTEND_CONTEXT) loadState();

  updateBadges();
  renderNotifMenu();
  renderAccountPanel();
  updateAccountUI();
  renderAccountRecovery();
  syncVisibleWishlistControls();
  if (notify) toast(t(normalizedReason === 'unauthorized' ? 'checkout_session_expired' : 'logged_out'));
  window.dispatchEvent(new CustomEvent('am:session-expired', { detail: { reason: normalizedReason } }));
  return true;
}

function refreshGuestCommerceFromStorage() {
  if (!STORE_FRONTEND_CONTEXT || currentUser) return false;
  loadState();
  updateBadges();
  syncVisibleWishlistControls();
  window.dispatchEvent(new CustomEvent('am:guest-commerce-changed'));
  return true;
}

function initializeStoreAuthBroadcast() {
  if (!STORE_FRONTEND_CONTEXT || storeAuthChannel || typeof window.BroadcastChannel !== 'function') return false;
  try {
    storeAuthChannel = new window.BroadcastChannel(STORE_AUTH_CHANNEL_NAME);
    storeAuthChannel.addEventListener('message', event => {
      const message = event?.data;
      if (!message || message.version !== 1) return;
      if (message.type === 'guest-commerce-changed') {
        refreshGuestCommerceFromStorage();
        return;
      }
      const messageUserId = String(message.userId || '').trim();
      const currentUserId = String(currentUser?.id || '').trim();
      if (message.type === 'signed-out') {
        if (!messageUserId) return;
        if (!currentUserId) {
          preserveGuestCommerceAfterExternalSessionChange();
          return;
        }
        if (currentUserId !== messageUserId) return;
        transitionStoreToSignedOut({ reason: message.reason, notify: true });
        return;
      }
      if (message.type === 'session-invalidated') {
        if (messageUserId && currentUserId && messageUserId !== currentUserId) return;
        if (!currentUserId) {
          preserveGuestCommerceAfterExternalSessionChange();
          return;
        }
        transitionStoreToSignedOut({ reason: message.reason, notify: false });
        return;
      }
      if (message.type !== 'account-changed' || !messageUserId) return;
      if (!currentUserId) {
        preserveGuestCommerceAfterExternalSessionChange();
        return;
      }
      if (currentUserId !== messageUserId) {
        transitionStoreToSignedOut({ reason: 'account-changed', notify: false });
      }
    });
    return true;
  } catch (error) {
    storeAuthChannel = null;
    console.warn('[AM MARKET] Cross-tab sign-out coordination is unavailable', error);
    return false;
  }
}

function broadcastStoreSignedOut(reason = 'logout', userId = currentUser?.id) {
  if (!storeAuthChannel && !initializeStoreAuthBroadcast()) return false;
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;
  try {
    storeAuthChannel.postMessage({
      version: 1,
      type: 'signed-out',
      reason: normalizeStoreSignedOutReason(reason),
      userId: normalizedUserId
    });
    return true;
  } catch (error) {
    console.warn('[AM MARKET] Could not notify other tabs about sign-out', error);
    return false;
  }
}

function broadcastStoreSessionInvalidated(reason = 'password-changed', userId = currentUser?.id) {
  if (!storeAuthChannel && !initializeStoreAuthBroadcast()) return false;
  const normalizedUserId = String(userId || '').trim();
  try {
    storeAuthChannel.postMessage({
      version: 1,
      type: 'session-invalidated',
      reason: normalizeStoreSignedOutReason(reason),
      ...(normalizedUserId ? { userId: normalizedUserId } : {})
    });
    return true;
  } catch (error) {
    console.warn('[AM MARKET] Could not notify other tabs about the changed session', error);
    return false;
  }
}

function broadcastStoreAccountChanged(userId) {
  if (!storeAuthChannel && !initializeStoreAuthBroadcast()) return false;
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;
  try {
    storeAuthChannel.postMessage({ version: 1, type: 'account-changed', userId: normalizedUserId });
    return true;
  } catch (error) {
    console.warn('[AM MARKET] Could not notify other tabs about the active account', error);
    return false;
  }
}

function broadcastStoreGuestCommerceChanged() {
  if (!storeAuthChannel && !initializeStoreAuthBroadcast()) return false;
  try {
    storeAuthChannel.postMessage({ version: 1, type: 'guest-commerce-changed' });
    return true;
  } catch (error) {
    console.warn('[AM MARKET] Could not notify other tabs about guest commerce changes', error);
    return false;
  }
}

function handleStoreUnauthorized(error) {
  if (Number(error?.status) !== 401) return false;
  if (!currentUser) return sessionExpiryHandled;

  const signedOutUserId = currentUser.id;
  transitionStoreToSignedOut({ reason: 'unauthorized', notify: true });
  broadcastStoreSignedOut('unauthorized', signedOutUserId);
  return true;
}

function captureAuthenticatedRequest() {
  return { epoch: authStateEpoch, user: currentUser };
}

function isAuthenticatedRequestCurrent(context) {
  return Boolean(context?.user && currentUser === context.user && authStateEpoch === context.epoch);
}

function assertAuthenticatedRequestCurrent(context) {
  if (isAuthenticatedRequestCurrent(context)) return;
  const error = new Error('The authenticated request is no longer current.');
  error.code = 'AUTH_REQUIRED';
  error.status = 401;
  throw error;
}

async function syncCartToServer(desired, touchedIds, authContext, revision) {
  assertAuthenticatedRequestCurrent(authContext);
  const remotePayload = await StoreAPI.cart.get();
  assertAuthenticatedRequestCurrent(authContext);
  const remote = new Map(cartFromApi(remotePayload).map(item => [String(item.id), Number(item.qty)]));
  for (const id of touchedIds) {
    if (!desired.has(id)) {
      if (remote.has(id)) {
        await StoreAPI.cart.removeItem(id);
        remote.delete(id);
      }
      assertAuthenticatedRequestCurrent(authContext);
      continue;
    }
    const quantity = desired.get(id);
    if (!remote.has(id)) {
      await StoreAPI.cart.addItem({ productId: id, quantity });
    } else if (remote.get(id) !== quantity) {
      await StoreAPI.cart.updateItem(id, { quantity });
    }
    remote.set(id, quantity);
    assertAuthenticatedRequestCurrent(authContext);
  }
  const refreshed = await StoreAPI.cart.get();
  assertAuthenticatedRequestCurrent(authContext);
  if (revision === cartSyncRevision) {
    cart = adoptAuthenticatedCart(refreshed);
    updateBadges();
  }
  markAuthenticatedResourceReady('cart');
}

function saveCart() {
  updateBadges();
  if (!currentUser) {
    localStorage.setItem(LS.cart, JSON.stringify(cart));
    return Promise.resolve(true);
  }
  const desired = cartSyncState(cart);
  cartSyncIntents(authenticatedCartSyncBaseline, desired).forEach(intent => {
    authenticatedCartPendingSyncIds.add(intent.id);
  });
  const touchedIds = new Set(authenticatedCartPendingSyncIds);
  authenticatedCartSyncBaseline = new Map(desired);
  const revision = ++cartSyncRevision;
  const authContext = captureAuthenticatedRequest();
  cartSyncPromise = cartSyncPromise.catch(() => false).then(() => syncCartToServer(desired, touchedIds, authContext, revision)).then(() => true).catch(async error => {
    if (handleStoreUnauthorized(error)) return false;
    if (!isAuthenticatedRequestCurrent(authContext)) return false;
    console.error('Cart synchronization failed', error);
    toast(t('api_error'));
    try {
      const refreshed = await StoreAPI.cart.get();
      if (!isAuthenticatedRequestCurrent(authContext)) return false;
      if (revision === cartSyncRevision) {
        cart = adoptAuthenticatedCart(refreshed);
        updateBadges();
        window.dispatchEvent(new CustomEvent('am:cart-reconciled'));
      }
    } catch (reloadError) {
      if (handleStoreUnauthorized(reloadError)) return false;
      authenticatedResourceState.cart = 'error';
      console.error('Cart recovery after synchronization failure failed', reloadError);
      renderAccountRecovery();
      window.dispatchEvent(new CustomEvent('am:account-resource-error', { detail: { resource: 'cart' } }));
    }
    return false;
  });
  return cartSyncPromise;
}

async function syncWishlistToServer(desired, touchedIds, authContext, revision) {
  assertAuthenticatedRequestCurrent(authContext);
  const remotePayload = await StoreAPI.wishlist.get();
  assertAuthenticatedRequestCurrent(authContext);
  const remote = new Set(wishlistFromApi(remotePayload));
  for (const id of touchedIds) {
    if (!desired.has(id)) {
      if (remote.has(id)) {
        await StoreAPI.wishlist.removeItem(id);
        remote.delete(id);
      }
      assertAuthenticatedRequestCurrent(authContext);
      continue;
    }
    if (!remote.has(id)) {
      await StoreAPI.wishlist.addItem({ productId: id });
      remote.add(id);
      assertAuthenticatedRequestCurrent(authContext);
    }
  }
  const refreshed = await StoreAPI.wishlist.get();
  assertAuthenticatedRequestCurrent(authContext);
  if (revision === wishlistSyncRevision) {
    wishlist = adoptAuthenticatedWishlist(refreshed);
    updateBadges();
  }
  markAuthenticatedResourceReady('wishlist');
}

function saveWish() {
  updateBadges();
  if (!currentUser) {
    localStorage.setItem(LS.wish, JSON.stringify(wishlist));
    return Promise.resolve();
  }
  const desired = wishlistSyncState(wishlist);
  wishlistSyncIntents(authenticatedWishlistSyncBaseline, desired).forEach(intent => {
    authenticatedWishlistPendingSyncIds.add(intent.id);
  });
  const touchedIds = new Set(authenticatedWishlistPendingSyncIds);
  authenticatedWishlistSyncBaseline = new Set(desired);
  const revision = ++wishlistSyncRevision;
  const authContext = captureAuthenticatedRequest();
  wishlistSyncPromise = wishlistSyncPromise.catch(() => {}).then(() => syncWishlistToServer(desired, touchedIds, authContext, revision)).catch(async error => {
    if (handleStoreUnauthorized(error)) return null;
    if (!isAuthenticatedRequestCurrent(authContext)) return null;
    console.error('Wishlist synchronization failed', error);
    toast(t('api_error'));
    try {
      const refreshed = await StoreAPI.wishlist.get();
      if (!isAuthenticatedRequestCurrent(authContext)) return null;
      if (revision === wishlistSyncRevision) {
        wishlist = adoptAuthenticatedWishlist(refreshed);
        updateBadges();
        window.dispatchEvent(new CustomEvent('am:account-resources-recovered', {
          detail: { resources: ['wishlist'] }
        }));
      }
    } catch (reloadError) {
      if (handleStoreUnauthorized(reloadError)) return null;
      authenticatedResourceState.wishlist = 'error';
      console.error('Wishlist recovery after synchronization failure failed', reloadError);
      renderAccountRecovery();
      window.dispatchEvent(new CustomEvent('am:account-resource-error', { detail: { resource: 'wishlist' } }));
    }
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
async function waitForStoreMutations({ requireCartSync = true } = {}) {
  const startedAuthenticated = Boolean(currentUser);
  const startedAuthEpoch = authStateEpoch;
  let pendingCartSync;
  let pendingWishlistSync;
  let cartResult;
  let wishlistResult;
  do {
    pendingCartSync = cartSyncPromise;
    pendingWishlistSync = wishlistSyncPromise;
    [cartResult, wishlistResult] = await Promise.allSettled([pendingCartSync, pendingWishlistSync]);
  } while (pendingCartSync !== cartSyncPromise || pendingWishlistSync !== wishlistSyncPromise);
  if (startedAuthenticated && startedAuthEpoch !== authStateEpoch) {
    const error = new Error('The authenticated session expired during synchronization.');
    error.code = 'AUTH_REQUIRED';
    error.status = 401;
    throw error;
  }
  if (requireCartSync && currentUser &&
      (cartResult.status !== 'fulfilled' || cartResult.value !== true || authenticatedResourceState.cart !== 'ready')) {
    if (cartResult.status === 'fulfilled' && cartResult.value === false && authenticatedResourceState.cart === 'ready' &&
        pendingCartSync === cartSyncPromise) {
      // The failed optimistic write was reconciled from the server. Fail this
      // navigation once, then let a later explicit attempt use that confirmed state.
      cartSyncPromise = Promise.resolve(true);
    }
    const error = new Error('The authenticated cart could not be synchronized.');
    error.code = 'CART_SYNC_FAILED';
    throw error;
  }
  return [cartResult, wishlistResult];
}
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
    StoreAPI.recent.record({ productId: String(product.id) }).catch(error => {
      if (!handleStoreUnauthorized(error)) console.error('Recently viewed record failed', error);
    });
  } else {
    localStorage.setItem(LS.recent, JSON.stringify(list));
  }
}

// ---------- API ----------
// Prefer the same-origin backend so production benefits from its validation and
// cache. A static/local preview has no /api/v1/catalog route, so public catalog
// reads may fall back to the allowlisted MMarket API (which supports CORS).
const API_HOST = 'https://api.mmarket.ma';
const DIRECT_CATALOG_API = `${API_HOST}/api`;
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

function directCatalogFallbackUrl(url) {
  if (!STORE_FRONTEND_CONTEXT || !STATIC_CATALOG_PREVIEW || typeof url !== 'string') return null;
  const backendPrefix = `${API}/`;
  if (!url.startsWith(backendPrefix)) return null;
  return `${DIRECT_CATALOG_API}/${url.slice(backendPrefix.length)}`;
}

function canUseDirectCatalogFallback(error) {
  const status = Number(error?.status);
  if (error?.catalogFailure === 'network') return true;
  if (error?.catalogFailure === 'html-success') return true;
  if (!Number.isInteger(status)) return false;
  if ([404, 405, 502, 504].includes(status)) return true;
  return status === 503 && error?.code === 'CATALOG_UNAVAILABLE';
}

async function fetchApiJson(url, timeoutMs) {
  let res;
  try {
    res = await fetchWithTimeout(url, timeoutMs);
  } catch (cause) {
    const error = new Error(cause?.message || 'Network request failed');
    error.name = cause?.name || 'NetworkError';
    error.catalogFailure = 'network';
    error.cause = cause;
    throw error;
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const body = await res.text();
  let data;
  let parseError = null;
  try {
    data = JSON.parse(body);
  } catch (error) {
    parseError = error;
  }

  if (!res.ok) {
    const error = new Error('HTTP ' + res.status);
    error.status = res.status;
    error.code = data?.error?.code || data?.code || null;
    error.catalogFailure = 'http';
    throw error;
  }

  if (parseError) {
    const error = new Error('Invalid JSON response');
    error.status = res.status;
    error.catalogFailure = !contentType.includes('json') && /^\s*(?:<!doctype\s+html|<html\b)/i.test(body)
      ? 'html-success'
      : 'invalid-json';
    error.cause = parseError;
    throw error;
  }
  return data;
}

// Fetch API JSON: direct first, then through CORS proxies (file:// safety net)
async function apiJSON(url) {
  try {
    return await fetchApiJson(url, 8000);
  } catch (e) {
    const fallbackUrl = directCatalogFallbackUrl(url);
    if (fallbackUrl && canUseDirectCatalogFallback(e)) {
      return await fetchApiJson(fallbackUrl, 8000);
    }
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
  if (STORE_FRONTEND_CONTEXT || !el || el.tagName !== 'IMG' || !el.src.startsWith(API_HOST)) return;
  const raw = PROXIES.filter(p => p.bin);
  const i = +el.dataset.px || 0;
  if (i >= raw.length) return;
  el.dataset.px = String(i + 1);
  el.src = raw[i].url(el.src);
}, true);

let productCache = Object.create(null);   // in-memory product cache for this page load
let productPromises = Object.create(null); // de-duplicate overlapping detail requests
let categories = [];
let categoriesPromise = null;
let catalogBrands = [];
let catalogBrandsPromise = null;

async function fetchCategories() {
  const data = await apiJSON(`${API}/categories/`);
  return (Array.isArray(data) ? data : data.results || [])
    .filter(c => c.parent_id == null);
}

async function fetchBrands() {
  const data = await apiJSON(`${API}/brands/`);
  if (!Array.isArray(data)) throw new TypeError('Invalid catalog brands response');
  return data;
}

async function fetchProducts(page = 1, categoryId = null, search = '', ordering = '', pageSize = 12, filters = {}) {
  const safePageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 12)));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  let url = `${API}/products/?include_descendants=true&page=${safePage}&page_size=${safePageSize}`;
  if (categoryId) url += `&category=${encodeURIComponent(String(categoryId))}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (ordering) url += `&ordering=${encodeURIComponent(ordering)}`;
  if (filters.brand) url += `&brand=${encodeURIComponent(String(filters.brand))}`;
  if (filters.maxPrice != null && filters.maxPrice !== ''
      && Number.isFinite(Number(filters.maxPrice)) && Number(filters.maxPrice) >= 0) {
    url += `&max_price=${encodeURIComponent(String(Number(filters.maxPrice)))}`;
  }
  const data = await apiJSON(url); // { count, next, previous, results }
  (data.results || []).forEach(p => { productCache[p.id] = p; });
  return data;
}

async function fetchProduct(id) {
  const key = String(id);
  if (productCache[key]) return productCache[key];
  if (!productPromises[key]) {
    productPromises[key] = apiJSON(`${API}/products/${encodeURIComponent(key)}/`)
      .then(p => { productCache[key] = p; return p; })
      .finally(() => { delete productPromises[key]; });
  }
  return productPromises[key];
}

// Fetch the category list once per page load (memoized promise)
function ensureCategories() {
  if (!categoriesPromise) {
    categoriesPromise = fetchCategories()
      .then(list => { categories = list; return list; })
      .catch(error => {
        categoriesPromise = null;
        throw error;
      });
  }
  return categoriesPromise;
}

function ensureBrands() {
  if (!catalogBrandsPromise) {
    catalogBrandsPromise = fetchBrands()
      .then(list => { catalogBrands = list; return list; })
      .catch(error => {
        catalogBrandsPromise = null;
        throw error;
      });
  }
  return catalogBrandsPromise;
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
    StoreAPI.preferences.update({ theme: t }).catch(error => {
      if (!handleStoreUnauthorized(error)) console.error('Theme preference update failed', error);
    });
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
  if (SUPPORTED_PAYMENT_METHODS.includes(currentPreferences?.defaultPayment)) return currentPreferences.defaultPayment;
  const saved = localStorage.getItem('am_pay');
  return SUPPORTED_PAYMENT_METHODS.includes(saved) ? saved : 'cod';
}
function setDefaultPay(p) {
  const payment = SUPPORTED_PAYMENT_METHODS.includes(p) ? p : 'cod';
  localStorage.setItem('am_pay', payment);
  if (currentUser) {
    currentPreferences = { ...(currentPreferences || {}), defaultPayment: payment };
    StoreAPI.preferences.update({ defaultPayment: payment }).catch(error => {
      if (!handleStoreUnauthorized(error)) console.error('Payment preference update failed', error);
    });
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function safeImageUrl(value, fallback = 'img/placeholder.svg') {
  const raw = String(value ?? '').trim();
  if (!raw) return escapeHtml(fallback);
  try {
    const url = new URL(raw, document.baseURI);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return escapeHtml(fallback);
    }
    return escapeHtml(url.href);
  } catch {
    return escapeHtml(fallback);
  }
}

function safeNonNegativeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
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
  if (currentUser && authenticatedResourceState.cart !== 'ready') {
    if (!silent) toast(accountRecoveryMessage(['cart']));
    renderAccountRecovery();
    return false;
  }
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
    if (!currentUser && cart.length >= MAX_GUEST_COMMERCE_ITEMS) {
      if (!silent) toast(t('guest_cart_limit'));
      return false;
    }
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
  if (currentUser && authenticatedResourceState.wishlist !== 'ready') {
    toast(accountRecoveryMessage(['wishlist']));
    renderAccountRecovery();
    return false;
  }
  id = String(id);
  const idx = wishlist.indexOf(id);
  if (idx >= 0) { wishlist.splice(idx, 1); toast(t('removed_wish')); }
  else {
    if (!currentUser && wishlist.length >= MAX_GUEST_COMMERCE_ITEMS) {
      toast(t('guest_wish_limit'));
      return false;
    }
    wishlist.push(id);
    toast(t('added_wish'));
  }
  saveWish();
  return true;
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
    const serverAuthoritative = Boolean(currentUser);
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
    if (serverAuthoritative) {
      // Keep cached display metadata, but never let a stale catalog card
      // override the cart endpoint's availability and verification decision.
      p = {
        ...(p || {}),
        id: String(c.id),
        name: c.name || p?.name || t('product_crumb'),
        price: c.price ?? p?.price ?? 0,
        image_url: c.image_url || p?.image_url || '',
        brand_name: c.brand_name || p?.brand_name || '',
        is_available: c.is_available === true,
        stock_quantity: c.stock_quantity ?? null,
        quantity_available: c.quantity_available === true,
        load_failed: Boolean(c.load_failed)
      };
      productCache[c.id] = p;
    }
    if (c.name == null || String(c.price) !== String(p.price) || c.image_url !== p.image_url ||
        c.is_available !== (p.is_available !== false) || c.stock_quantity !== p.stock_quantity ||
        c.quantity_available !== p.quantity_available || Boolean(c.load_failed) !== Boolean(p.load_failed)) {
      c.name = p.name; c.price = p.price; c.image_url = p.image_url; c.brand_name = p.brand_name || '';
      c.is_available = p.is_available !== false; c.stock_quantity = p.stock_quantity ?? null;
      c.quantity_available = p.quantity_available === true; c.load_failed = Boolean(p.load_failed);
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

function notificationMessage(notification) {
  const typeKeys = {
    order_confirmed: 'notif_order_confirmed',
    order_preparing: 'notif_order_preparing',
    order_shipping: 'notif_order_shipping',
    order_delivered: 'notif_order_delivered',
    order_cancelled: 'notif_order_cancelled',
    return_requested: 'notif_return_requested',
    low_stock: 'notif_low_stock',
    back_in_stock: 'notif_back_in_stock'
  };
  const key = typeKeys[notification?.type];
  if (!key) return t('notif_generic');
  return t(key, {
    product: notification.productName || (getLang() === 'fr' ? 'Ce produit' : 'This product'),
    quantity: Number.isFinite(Number(notification.payload?.stockQuantity))
      ? Number(notification.payload.stockQuantity)
      : ''
  });
}

function notificationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getLang() === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium'
  }).format(date);
}

function renderNotifMenu() {
  const menu = $('notifMenu');
  if (!menu) return;
  if (currentUser && authenticatedResourceState.notifications === 'loading') {
    menu.innerHTML = `<li class="notif-empty" role="status">${escapeHtml(t('loading'))}</li>`;
    return;
  }
  if (currentUser && authenticatedResourceState.notifications === 'error') {
    menu.innerHTML = `<li class="notif-empty">
      <p class="mb-2">${escapeHtml(accountRecoveryMessage(['notifications']))}</p>
      <button type="button" class="btn btn-sm btn-outline-orange state-action" id="retryAccountNotifications">${escapeHtml(t('retry'))}</button>
    </li>`;
    $('retryAccountNotifications')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      await retryAuthenticatedResources();
      requestAnimationFrame(() => {
        const target = authenticatedResourceState.notifications === 'error'
          ? $('retryAccountNotifications')
          : menu.querySelector('a, button') || menu.closest('.dropdown')?.querySelector('[data-bs-toggle="dropdown"]');
        target?.focus({ preventScroll: true });
      });
    });
    return;
  }
  if (!currentUser) {
    const signInCopy = getLang() === 'fr'
      ? 'Connectez-vous pour recevoir les mises à jour de commande et de stock sur tous vos appareils.'
      : 'Sign in to receive order and stock updates across devices.';
    const signInLabel = getLang() === 'fr' ? 'Se connecter' : 'Sign in';
    menu.innerHTML = `<li class="notif-empty"><p class="mb-2">${escapeHtml(signInCopy)}</p><a class="btn btn-sm btn-outline-orange state-action" href="login.html?next=index.html">${escapeHtml(signInLabel)}</a></li>`;
    return;
  }
  if (!accountNotifications.length) {
    menu.innerHTML = `<li class="notif-empty">${t('notif_empty')}</li>`;
    return;
  }
  menu.innerHTML = accountNotifications.slice(0, 5).map(notification => {
    const destination = notification.orderId
      ? `orders.html?order=${encodeURIComponent(notification.orderId)}`
      : notification.productId
        ? `product.html?id=${encodeURIComponent(notification.productId)}`
        : 'settings.html';
    return `
    <li><a class="dropdown-item notif-item" href="${escapeHtml(destination)}" data-notification-id="${escapeHtml(notification.id)}">
      <i class="fa-solid ${notification.productId ? 'fa-box-open' : 'fa-bag-shopping'}"></i>
      <span>${escapeHtml(notificationMessage(notification))}<br><small class="text-muted">${escapeHtml(notificationDate(notification.createdAt))}</small></span>
    </a></li>`;
  }).join('');
  menu.querySelectorAll('[data-notification-id]').forEach(link => {
    link.addEventListener('click', async event => {
      event.preventDefault();
      const destination = link.getAttribute('href');
      const notification = accountNotifications.find(item => item.id === link.dataset.notificationId);
      const authContext = captureAuthenticatedRequest();
      let sessionExpired = false;
      try {
        await StoreAPI.notifications.markRead(link.dataset.notificationId);
        if (!isAuthenticatedRequestCurrent(authContext)) {
          sessionExpired = true;
          return;
        }
        if (notification && !notification.readAt) {
          notification.readAt = new Date().toISOString();
          accountUnreadCount = Math.max(0, accountUnreadCount - 1);
          updateBadges();
        }
      } catch (error) {
        sessionExpired = handleStoreUnauthorized(error);
        if (!sessionExpired) console.error('Notification update failed', error);
      } finally {
        if (!sessionExpired) location.href = destination;
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

async function renderSidebar(activeCat = null, { restoreFocus = false } = {}) {
  sidebarActiveCat = activeCat;
  const list = $('categoryList');
  if (!list) return;
  try {
    await ensureCategories();
  } catch (error) {
    console.error('Category sidebar load failed', error);
    list.innerHTML = `<div class="p-3 text-center" role="alert">
      <p class="small text-danger mb-2">${escapeHtml(t('api_error'))}</p>
      <button type="button" class="btn btn-sm btn-outline-orange state-action" id="retrySidebarCategories">${escapeHtml(t('retry'))}</button>
    </div>`;
    const retry = $('retrySidebarCategories');
    retry?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      renderSidebar(activeCat, { restoreFocus: true });
    });
    if (restoreFocus) requestAnimationFrame(() => retry?.focus({ preventScroll: true }));
    return;
  }
  // Prioritize school / office supplies (Fournitures Bureau) during rentrée
  const RENTREE_CAT = 1363;
  const sorted = [...categories].sort((a, b) => {
    if (a.id === RENTREE_CAT) return -1;
    if (b.id === RENTREE_CAT) return 1;
    return 0;
  });
  list.innerHTML = `
    <a class="list-group-item ${activeCat == null ? 'active' : ''}" href="categories.html">
      ${getCatIcon({ name: 'all categories' })} ${t('all_categories')}
    </a>
    ${sorted.map(c => `
      <a class="list-group-item ${String(activeCat) === String(c.id) ? 'active' : ''}" href="categories.html?cat=${encodeURIComponent(String(c.id))}">
        ${getCatIcon(c)} ${escapeHtml(catName(c.name))}
        <span class="cat-count">${safeNonNegativeCount(c.product_count)}</span>
        <i class="fa-solid fa-chevron-right cat-chev"></i>
      </a>
    `).join('')}`;
  if (restoreFocus) requestAnimationFrame(() => list.querySelector('a')?.focus({ preventScroll: true }));
}

// ---------- Product card (shared rendering) ----------
function cardHTML(p) {
  const id = String(p?.id ?? '');
  const imageSrc = safeImageUrl(p?.image_url);
  const inWish = wishlist.includes(id);
  const available = p.is_available !== false;
  const disc = parseInt(p.discount_percent) || 0;
  const oldPrice = parseFloat(p.original_price);
  const hasOld = oldPrice > 0 && oldPrice > parseFloat(p.price);
  const href = 'product.html?id=' + encodeURIComponent(id);
  const safeHref = escapeHtml(href);
  return `
    <div class="col-6 col-md-4 col-xl-3">
      <div class="product-card ${available ? '' : 'is-unavailable'}">
        ${disc > 0 ? `<span class="badge-disc">-${disc}%</span>` : (p.is_promo ? `<span class="badge-disc badge-promo">${t('promo')}</span>` : '')}
        <a class="product-img" href="${safeHref}">
          <img src="${imageSrc}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async"
               data-product-image data-image-fallback="img/placeholder.svg">
        </a>
        <div class="product-body">
          <a class="product-title" href="${safeHref}">${escapeHtml(p.name)}</a>
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
              <button class="wish-btn ${inWish ? 'active' : ''}" data-wish="${escapeHtml(id)}" title="${escapeHtml(t('wish_title'))}"
                      aria-label="${escapeHtml(t(inWish ? 'remove_named_wish' : 'add_named_wish', { name: p.name }))}"
                      aria-pressed="${inWish}">
                <i class="fa-${inWish ? 'solid' : 'regular'} fa-heart"></i>
              </button>
              <button class="add-btn" data-id="${escapeHtml(id)}" title="${escapeHtml(t(available ? 'add_to_cart' : 'out_stock'))}"
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
function restoreWishlistControlFocus(container, productId) {
  requestAnimationFrame(() => {
    const control = [...container.querySelectorAll('[data-wish]')]
      .find(button => button.dataset.wish === String(productId));
    (control || container.querySelector('.state-action'))?.focus({ preventScroll: true });
  });
}

function rerenderCardsWithFocus(container, rerender, context) {
  try {
    Promise.resolve(rerender(context))
      .then(() => restoreWishlistControlFocus(container, context.productId))
      .catch(error => console.error('Product grid refresh failed', error));
  } catch (error) {
    console.error('Product grid refresh failed', error);
  }
}

function bindCards(container, rerender) {
  container.querySelectorAll('.add-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      if (!addToCart(btn.dataset.id)) return;
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
      if (!toggleWish(id)) return;
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
          if (rerender) rerenderCardsWithFocus(container, rerender, { restoreFocus: true, productId: id });
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
        if (rerender) rerenderCardsWithFocus(container, rerender, {
          restoreFocus: true,
          removedWishId: id,
          productId: id
        });
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
        <div class="visually-hidden" id="searchSuggestionStatus" role="status" aria-live="polite" aria-atomic="true"></div>
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
  const status = $('searchSuggestionStatus');
  if (!input || !box) return;

  const cache = new Map();
  let timer = null;
  let requestSeq = 0;
  let activeIndex = -1;

  const recordSearch = payload => StoreAPI.search.record(payload).catch(error => {
    if (!handleStoreUnauthorized(error)) console.error('Search history update failed', error);
  });

  const resultCountFor = query => {
    const normalized = query.toLowerCase();
    const cachedCount = cache.get(normalized)?.resultCount;
    if (Number.isSafeInteger(cachedCount)) return cachedCount;
    const recentCount = authenticatedSearches.find(item => item.query.toLowerCase() === normalized)?.resultsCount;
    return Number.isSafeInteger(recentCount) ? recentCount : undefined;
  };

  const recordKnownSearch = query => {
    const resultsCount = resultCountFor(query);
    recordSearch({ query, ...(resultsCount === undefined ? {} : { resultsCount }) });
    return resultsCount;
  };

  const go = (value = input.value) => {
    const q = value.trim();
    if (q && currentUser) {
      const resultsCount = recordKnownSearch(q);
      authenticatedSearches = [
        { query: q, resultsCount, lastSearchedAt: new Date().toISOString() },
        ...authenticatedSearches.filter(item => item.query.toLowerCase() !== q.toLowerCase())
      ].slice(0, 10);
    }
    location.href = 'categories.html' + (q ? '?q=' + encodeURIComponent(q) : '');
  };

  const close = () => {
    clearTimeout(timer);
    timer = null;
    requestSeq += 1;
    box.hidden = true;
    box.innerHTML = '';
    if (status) status.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const open = (html, statusMessage = '') => {
    box.innerHTML = html;
    if (status) status.textContent = statusMessage;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const renderProducts = (list, query, labelKey = 'search_suggestions') => {
    if (!list.length) {
      open(`<div class="search-suggestion-status" role="presentation">${t('search_no_suggestions')}</div>
        <a class="search-suggestion-all" id="searchOptionAll" role="option" aria-selected="false" href="categories.html?q=${encodeURIComponent(query)}">
          <span>${t('search_all_results', { q: escapeHtml(query) })}</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
        </a>`, t('search_no_suggestions'));
      return;
    }
    list.forEach(p => { productCache[p.id] = p; });
    open(`<div class="search-suggestion-label" role="presentation">${t(labelKey)}</div>${list.slice(0, 5).map((p, i) => `
      <a class="search-suggestion" id="searchOption${i}" role="option" aria-selected="false" href="product.html?id=${encodeURIComponent(p.id)}">
        <img src="${safeImageUrl(p.image_url)}" alt="" loading="eager" data-image-fallback="img/placeholder.svg">
        <span class="search-suggestion-copy">
          <strong>${escapeHtml(p.name)}</strong>
          <small>${escapeHtml(p.brand_name || 'AM Market')}</small>
        </span>
        <span class="search-suggestion-price">${formatPrice(p.price)}</span>
      </a>`).join('')}
      <a class="search-suggestion-all" id="searchOptionAll" role="option" aria-selected="false" href="categories.html?q=${encodeURIComponent(query)}">
        <span>${t('search_all_results', { q: escapeHtml(query) })}</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
      </a>`);
  };

  const showRecent = () => {
    if (currentUser && authenticatedResourceState.search === 'loading') {
      open(`<div class="search-suggestion-status" role="presentation">${escapeHtml(t('loading'))}</div>`, t('loading'));
      return;
    }
    if (currentUser && authenticatedResourceState.search === 'error') {
      open(`<div class="search-suggestion-status" role="presentation">${escapeHtml(accountRecoveryMessage(['search']))}</div>
        <button type="button" class="search-suggestion-all" id="searchOptionRetry" role="option" aria-selected="false">${escapeHtml(t('retry'))}</button>`,
      accountRecoveryMessage(['search']));
      $('searchOptionRetry')?.addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        await retryAuthenticatedResources();
        showRecent();
        input.focus({ preventScroll: true });
      });
      return;
    }
    if (currentUser && authenticatedSearches.length) {
      open(`<div class="search-suggestion-label" role="presentation">${getLang() === 'fr' ? 'Recherches récentes' : 'Recent searches'}</div>${authenticatedSearches.slice(0, 5).map((item, i) => `
        <a class="search-suggestion search-history-item" id="searchOption${i}" role="option" aria-selected="false" href="categories.html?q=${encodeURIComponent(item.query)}" data-search-query="${escapeHtml(item.query)}">
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
    open(`<div class="search-suggestion-status" role="presentation"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${t('loading')}</div>`, t('loading'));
    try {
      let cached = cache.get(q.toLowerCase());
      if (!cached) {
        const data = await StoreAPI.search.suggestions(q);
        cached = {
          products: data.products || [],
          resultCount: Number.isSafeInteger(data.resultCount) ? data.resultCount : undefined
        };
        cache.set(q.toLowerCase(), cached);
      }
      if (seq !== requestSeq || input.value.trim() !== q) return;
      renderProducts(cached.products, q);
    } catch {
      if (seq === requestSeq) open(`<div class="search-suggestion-status" role="presentation">${t('search_unavailable')}</div>`, t('search_unavailable'));
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
    const options = [...box.querySelectorAll('[role="option"]')];
    if (e.key === 'Escape') { close(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
      e.preventDefault();
      activeIndex = e.key === 'ArrowDown'
        ? (activeIndex + 1) % options.length
        : (activeIndex - 1 + options.length) % options.length;
      options.forEach((o, i) => {
        const isActive = i === activeIndex;
        o.classList.toggle('is-active', isActive);
        o.setAttribute('aria-selected', String(isActive));
      });
      input.setAttribute('aria-activedescendant', options[activeIndex].id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) {
        const selectedQuery = options[activeIndex].dataset.searchQuery;
        if (selectedQuery) go(selectedQuery);
        else if (options[activeIndex].matches('button')) options[activeIndex].click();
        else {
          if (input.value.trim() && currentUser) recordKnownSearch(input.value.trim());
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
    if (query) recordKnownSearch(query);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) close();
  });
  window.addEventListener('am:account-resources-recovered', event => {
    if (event.detail?.resources?.includes('search') && document.activeElement === input && input.value.trim().length < 2) {
      showRecent();
    }
  });
  window.addEventListener('am:langchange', () => {
    if (!box.hidden && input.value.trim().length < 2) showRecent();
  });
}

// Sync the mobile bottom toolbar active tab with the current page
function initTabbar() {
  const map = { home: 'home', categories: 'home', 'all-categories': 'home', product: 'home', cart: 'cart', checkout: 'cart', wishlist: 'wishlist', orders: 'account', settings: 'account', help: 'account' };
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

// Unavailable action links + logout (account panel, header dropdown, settings)
document.addEventListener('click', e => {
  const soon = e.target.closest('[data-soon]');
  if (soon) { e.preventDefault(); toast(t('soon')); return; }
  const lo = e.target.closest('#logoutLink, #ddLogoutLink');
  if (lo) {
    e.preventDefault();
    if (STORE_FRONTEND_CONTEXT) {
      withStoreAuthSessionLock(async () => {
        const signedOutUserId = currentUser?.id;
        await StoreAPI.auth.logout();
        transitionStoreToSignedOut({ reason: 'logout', notify: false });
        if (!broadcastStoreSignedOut('logout', signedOutUserId)) {
          broadcastStoreSessionInvalidated('logout');
        }
      }).then(() => {
        location.replace('index.html');
      }).catch(error => {
        if (handleStoreUnauthorized(error)) {
          location.replace('index.html');
          return;
        }
        console.error('Logout failed', error);
        toast(t('api_error'));
      });
    } else {
      localStorage.removeItem('am_user');
      sessionStorage.removeItem('am_user');
      renderAccountPanel();
      updateAccountUI();
      toast(t('logged_out'));
    }
  }
});

function getAuthenticatedResourceState(resource) {
  if (!currentUser || !Object.prototype.hasOwnProperty.call(authenticatedResourceState, resource)) return 'ready';
  return authenticatedResourceState[resource];
}

function failedAccountResources() {
  return Object.entries(authenticatedResourceState)
    .filter(([, state]) => state === 'error')
    .map(([resource]) => resource);
}

function accountRecoveryMessage(resources) {
  const french = getLang() === 'fr';
  const labels = french
    ? {
        cart: 'votre panier',
        wishlist: 'vos favoris',
        notifications: 'vos notifications',
        recent: 'vos produits récemment consultés',
        search: 'vos recherches récentes'
      }
    : {
        cart: 'your cart',
        wishlist: 'your saved items',
        notifications: 'your notifications',
        recent: 'your recently viewed products',
        search: 'your recent searches'
      };
  const names = [...new Set(resources)].map(resource => labels[resource]).filter(Boolean);
  if (!names.length) {
    return french
      ? "Impossible de charger les données de votre compte. Vos données n'ont pas été effacées."
      : "We couldn't load your account data. Your data has not been erased.";
  }
  const joined = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} ${french ? 'et' : 'and'} ${names.at(-1)}`;
  return french
    ? `Impossible de charger ${joined}. Vos données n'ont pas été effacées.`
    : `We couldn't load ${joined}. Your data has not been erased.`;
}

function renderAccountRecovery() {
  const existing = $('accountResourceRecovery');
  const page = document.body.dataset.page;
  const resources = currentUser
    ? failedAccountResources().filter(resource => !(
      (page === 'cart' && resource === 'cart') ||
      (page === 'wishlist' && resource === 'wishlist')
    ))
    : [];
  if (!resources.length) {
    existing?.remove();
    return;
  }

  const wrapper = existing || document.createElement('div');
  wrapper.id = 'accountResourceRecovery';
  wrapper.className = 'container-fluid px-3 px-lg-4 mt-2';
  wrapper.setAttribute('role', 'alert');
  wrapper.setAttribute('aria-live', 'assertive');
  wrapper.replaceChildren();

  const alert = document.createElement('div');
  alert.className = 'alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2 mb-0';
  const message = document.createElement('span');
  message.textContent = accountRecoveryMessage(resources);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-sm btn-outline-orange state-action';
  retry.textContent = t('retry');
  retry.disabled = accountRecoveryPending;
  retry.addEventListener('click', () => retryAuthenticatedResources());
  alert.append(message, retry);
  wrapper.appendChild(alert);

  if (!existing) {
    const main = document.querySelector('main');
    if (main?.parentNode) main.parentNode.insertBefore(wrapper, main);
    else document.body.prepend(wrapper);
  }
}

async function retryAuthenticatedResources() {
  if (!currentUser || accountRecoveryPending) return false;
  const requested = failedAccountResources();
  if (!requested.length) return true;
  const recoveryHadFocus = $('accountResourceRecovery')?.contains(document.activeElement) === true;
  const authContext = captureAuthenticatedRequest();
  accountRecoveryPending = true;
  renderAccountRecovery();

  const requests = requested.map(resource => ({
    cart: () => StoreAPI.cart.get(),
    wishlist: () => StoreAPI.wishlist.get(),
    notifications: () => StoreAPI.notifications.list({ limit: 20 }),
    recent: () => StoreAPI.recent.list({ limit: 8 }),
    search: () => StoreAPI.search.history({ limit: 10 })
  })[resource]());
  const results = await Promise.allSettled(requests);
  const unauthorized = results.find(result => result.status === 'rejected' && Number(result.reason?.status) === 401);
  if (unauthorized && handleStoreUnauthorized(unauthorized.reason)) {
    accountRecoveryPending = false;
    return false;
  }
  if (!isAuthenticatedRequestCurrent(authContext)) {
    accountRecoveryPending = false;
    return false;
  }
  const recovered = [];
  results.forEach((result, index) => {
    const resource = requested[index];
    if (result.status === 'fulfilled') {
      try {
        if (resource === 'cart') cart = adoptAuthenticatedCart(result.value);
        else if (resource === 'wishlist') wishlist = adoptAuthenticatedWishlist(result.value);
        else if (resource === 'notifications') {
          const state = notificationsFromApi(result.value);
          accountNotifications = state.notifications;
          accountUnreadCount = state.unreadCount;
        } else if (resource === 'recent') authenticatedRecent = recentFromApi(result.value);
        else if (resource === 'search') authenticatedSearches = searchesFromApi(result.value);
        authenticatedResourceState[resource] = 'ready';
        recovered.push(resource);
      } catch (error) {
        authenticatedResourceState[resource] = 'error';
        console.error(`Authenticated ${resource} recovery returned invalid data`, error);
      }
    } else {
      authenticatedResourceState[resource] = 'error';
      console.error(`Authenticated ${resource} recovery failed`, result.reason);
    }
  });

  accountRecoveryPending = false;
  updateBadges();
  renderNotifMenu();
  renderAccountRecovery();
  if (recovered.length) {
    window.dispatchEvent(new CustomEvent('am:account-resources-recovered', {
      detail: { resources: recovered }
    }));
  }
  if (recoveryHadFocus) {
    requestAnimationFrame(() => {
      if (failedAccountResources().length) {
        const retry = $('accountResourceRecovery')?.querySelector('button') ||
          $('retryAccountCart') || $('retryAccountWishlist') || $('retryAccountNotifications');
        if (retry) {
          retry.focus({ preventScroll: true });
          return;
        }
      }
      const heading = document.querySelector('main h1');
      if (!heading) return;
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    });
  }
  return failedAccountResources().length === 0;
}

async function loadAuthenticatedState() {
  const bootstrapAuthEpoch = authStateEpoch;
  try {
    localStorage.removeItem('am_user');
    sessionStorage.removeItem('am_user');
  } catch (storageError) {
    console.warn('[AM MARKET] Could not clear legacy account bootstrap state', storageError);
  }
  const session = await StoreAPI.bootstrap();
  if (authStateEpoch !== bootstrapAuthEpoch) return;
  sessionKnown = true;
  if (!session.authenticated) {
    currentUser = null;
    sessionExpiryHandled = false;
    Object.keys(authenticatedResourceState).forEach(resource => {
      authenticatedResourceState[resource] = 'ready';
    });
    return;
  }
  currentUser = { ...session.user, name: session.user.displayName };
  sessionExpiryHandled = false;
  const authContext = captureAuthenticatedRequest();
  currentPreferences = session.user.preferences || null;
  cart = [];
  wishlist = [];
  resetAuthenticatedCommerceSyncState();
  Object.keys(authenticatedResourceState).forEach(resource => {
    authenticatedResourceState[resource] = 'loading';
  });
  accountNotifications = [];
  accountUnreadCount = 0;
  authenticatedRecent = [];
  authenticatedSearches = [];
  savedAddresses = [];
  renderNotifMenu();
  const resources = await Promise.allSettled([
    StoreAPI.cart.get(),
    StoreAPI.wishlist.get(),
    StoreAPI.notifications.list({ limit: 20 }),
    StoreAPI.recent.list({ limit: 8 }),
    StoreAPI.addresses.list(),
    StoreAPI.search.history({ limit: 10 })
  ]);
  const unauthorized = resources.find(result => result.status === 'rejected' && Number(result.reason?.status) === 401);
  if (unauthorized && handleStoreUnauthorized(unauthorized.reason)) return;
  if (!isAuthenticatedRequestCurrent(authContext)) return;
  const valueAt = index => resources[index].status === 'fulfilled' ? resources[index].value : null;
  const cartPayload = valueAt(0);
  const wishPayload = valueAt(1);
  const notificationPayload = valueAt(2);
  const recentPayload = valueAt(3);
  const addressPayload = valueAt(4);
  const searchPayload = valueAt(5);
  try {
    if (resources[0].status !== 'fulfilled') throw resources[0].reason;
    cart = adoptAuthenticatedCart(cartPayload);
    authenticatedResourceState.cart = 'ready';
  } catch (error) {
    authenticatedResourceState.cart = 'error';
    console.error('Authenticated cart bootstrap failed', error);
  }
  try {
    if (resources[1].status !== 'fulfilled') throw resources[1].reason;
    wishlist = adoptAuthenticatedWishlist(wishPayload);
    authenticatedResourceState.wishlist = 'ready';
  } catch (error) {
    authenticatedResourceState.wishlist = 'error';
    console.error('Authenticated wishlist bootstrap failed', error);
  }
  try {
    if (resources[2].status !== 'fulfilled') throw resources[2].reason;
    const state = notificationsFromApi(notificationPayload);
    accountNotifications = state.notifications;
    accountUnreadCount = state.unreadCount;
    authenticatedResourceState.notifications = 'ready';
  } catch (error) {
    authenticatedResourceState.notifications = 'error';
    console.error('Authenticated notifications bootstrap failed', error);
  }
  try {
    if (resources[3].status !== 'fulfilled') throw resources[3].reason;
    authenticatedRecent = recentFromApi(recentPayload);
    authenticatedResourceState.recent = 'ready';
  } catch (error) {
    authenticatedResourceState.recent = 'error';
    console.error('Authenticated recently viewed bootstrap failed', error);
  }
  savedAddresses = addressPayload?.addresses || [];
  try {
    if (resources[5].status !== 'fulfilled') throw resources[5].reason;
    authenticatedSearches = searchesFromApi(searchPayload);
    authenticatedResourceState.search = 'ready';
  } catch (error) {
    authenticatedResourceState.search = 'error';
    console.error('Authenticated search history bootstrap failed', error);
  }
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
    renderAccountRecovery();
    window.dispatchEvent(new CustomEvent('am:store-ready'));
  }
}

(function coreInit() {
  loadState();
  initializeStoreAuthBroadcast();
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
  renderAccountRecovery();
  if ($('categoryList')) renderSidebar(sidebarActiveCat);
});

window.addEventListener('am:session-changed', () => {
  if (currentUser) transitionStoreToSignedOut({ reason: 'session-changed', notify: false });
  else preserveGuestCommerceAfterExternalSessionChange();
});

window.addEventListener('storage', event => {
  if (event.key === null || event.key === LS.cart || event.key === LS.wish) {
    refreshGuestCommerceFromStorage();
  }
});

function syncVisibleWishlistControls() {
  document.querySelectorAll('[data-wish]').forEach(button => {
    const saved = wishlist.includes(String(button.dataset.wish));
    const name = button.closest('.product-card')?.querySelector('.product-title')?.textContent?.trim() || t('product_crumb');
    button.classList.toggle('active', saved);
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', t(saved ? 'remove_named_wish' : 'add_named_wish', { name }));
    const icon = button.querySelector('i');
    if (icon) icon.className = `fa-${saved ? 'solid' : 'regular'} fa-heart`;
  });
}

window.addEventListener('am:account-resources-recovered', event => {
  if (!event.detail?.resources?.includes('wishlist')) return;
  syncVisibleWishlistControls();
  if (document.body.dataset.page === 'wishlist' && typeof window.renderWishlist === 'function') {
    window.renderWishlist({ restoreFocus: true });
  }
});
