/** AM MARKET — authenticated order history, tracking, cancellation and returns. */

const ORDER_STEPS = ['confirmed', 'preparing', 'shipping', 'delivered'];
const ORDERS_PAGE_SIZE = 30;
const REORDER_ATTEMPT_STORAGE_PREFIX = 'am_orders_reorder_attempts_v1:';
const REORDER_ATTEMPT_STORAGE_VERSION = 1;
const REORDER_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
let loadedOrders = [];
let loadedOrderEntries = [];
let nextOrdersCursor = null;
let ordersLoadMoreError = '';
let ordersInitialLoadComplete = false;
let ordersRequestPending = false;
let ordersPrivacyEpoch = 0;
let ordersUnauthorizedTransitioning = false;
const submittedReturns = new Map();
const returnDraftAttempts = new Map();
const reorderAttempts = new Map();
const pendingReorders = new Set();
const pendingReturns = new Set();
const pendingCancellations = new Set();
let reorderAttemptStorageBlocked = null;
const orderCopy = (en, fr) => getLang() === 'fr' ? fr : en;

const ORDER_STATUS_COPY = Object.freeze({
  confirmed: ['Confirmed', 'Confirmée'],
  preparing: ['Preparing', 'En préparation'],
  shipping: ['On the way', 'En livraison'],
  delivered: ['Delivered', 'Livrée'],
  cancelled: ['Cancelled', 'Annulée']
});

const TRACKING_MESSAGE_COPY = Object.freeze({
  order_confirmed: ['Your order has been confirmed.', 'Votre commande a été confirmée.'],
  order_preparing: ['Your order is being prepared.', 'Votre commande est en cours de préparation.'],
  order_shipping: ['Your order is on the way.', 'Votre commande est en cours de livraison.'],
  order_delivered: ['Your order has been delivered.', 'Votre commande a été livrée.'],
  order_cancelled: ['The order was cancelled.', 'La commande a été annulée.']
});

const ORDER_ERROR_COPY = Object.freeze({
  ORDER_NOT_FOUND: ['That order could not be found.', 'Cette commande est introuvable.'],
  ORDER_CANNOT_BE_CANCELLED: ['This order can no longer be cancelled.', 'Cette commande ne peut plus être annulée.'],
  RETURN_WINDOW_CLOSED: ['The seven-day return window has closed.', 'Le délai de retour de sept jours est terminé.'],
  RETURN_ITEMS_INVALID: ['One or more selected return items are no longer valid.', 'Un ou plusieurs articles sélectionnés pour le retour ne sont plus valides.'],
  RETURN_QUANTITY_INVALID: ['A return quantity is higher than the quantity available.', 'Une quantité de retour dépasse la quantité disponible.'],
  PRODUCT_NOT_FOUND: ['One of these products is no longer available.', 'Un de ces produits n’est plus disponible.'],
  CATALOG_UNAVAILABLE: ['Product availability cannot be checked right now. Please try again.', 'Impossible de vérifier la disponibilité des produits pour le moment. Réessayez.'],
  CATALOG_RESPONSE_INVALID: ['Product availability cannot be checked right now. Please try again.', 'Impossible de vérifier la disponibilité des produits pour le moment. Réessayez.'],
  REQUEST_TIMEOUT: ['The request took too long. Please try again.', 'La demande a pris trop de temps. Réessayez.'],
  NETWORK_ERROR: ['The server could not be reached. Check your connection and try again.', 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.'],
  REQUEST_ABORTED: ['The request was cancelled. Please try again.', 'La demande a été annulée. Réessayez.'],
  AUTH_REQUIRED: ['Sign in again to continue.', 'Reconnectez-vous pour continuer.'],
  UNAUTHENTICATED: ['Sign in again to continue.', 'Reconnectez-vous pour continuer.'],
  HTTP_401: ['Sign in again to continue.', 'Reconnectez-vous pour continuer.'],
  HTTP_429: ['Too many requests. Wait a moment and try again.', 'Trop de demandes. Patientez un instant puis réessayez.'],
  CRYPTO_UNAVAILABLE: ['This browser cannot create a secure request. Please update your browser and try again.', 'Ce navigateur ne peut pas créer une demande sécurisée. Mettez-le à jour puis réessayez.'],
  REORDER_PERSISTENCE_UNAVAILABLE: ['A safe reorder retry could not be prepared. Enable site storage and try again.', 'Impossible de préparer une nouvelle commande réessayable en toute sécurité. Activez le stockage du site et réessayez.'],
  REORDER_ATTEMPT_UNRECOVERABLE: ['A previous reorder could not be verified. Review your cart before trying again.', 'Une précédente nouvelle commande n’a pas pu être vérifiée. Consultez votre panier avant de réessayer.'],
  REORDER_ATTEMPT_EXPIRED: ['A previous reorder attempt expired and cannot be safely repeated. Review your cart before continuing.', 'Une précédente tentative de nouvelle commande a expiré et ne peut pas être répétée en toute sécurité. Consultez votre panier avant de continuer.'],
  REORDER_LOCK_UNAVAILABLE: ['This browser cannot safely coordinate reorders across tabs. Close other store tabs or use an updated browser.', 'Ce navigateur ne peut pas coordonner les nouvelles commandes entre les onglets en toute sécurité. Fermez les autres onglets du magasin ou utilisez un navigateur à jour.'],
  REORDER_ALREADY_IN_PROGRESS: ['A reorder is already in progress in another tab. Wait for it to finish, then review your cart.', 'Une nouvelle commande est déjà en cours dans un autre onglet. Attendez sa fin, puis consultez votre panier.'],
  IDEMPOTENCY_KEY_EXPIRED: ['This reorder attempt expired and cannot be safely repeated. Review your cart before continuing.', 'Cette tentative de nouvelle commande a expiré et ne peut pas être répétée en toute sécurité. Consultez votre panier avant de continuer.'],
  IDEMPOTENCY_KEY_INVALID: ['A previous reorder could not be verified. Review your cart before trying again.', 'Une précédente nouvelle commande n’a pas pu être vérifiée. Consultez votre panier avant de réessayer.'],
  IDEMPOTENCY_KEY_REUSED: ['A previous reorder could not be verified. Review your cart before trying again.', 'Une précédente nouvelle commande n’a pas pu être vérifiée. Consultez votre panier avant de réessayer.']
});

function orderErrorMessage(error, fallback) {
  console.error('[AM MARKET orders]', error);
  const copy = ORDER_ERROR_COPY[String(error?.code || '').toUpperCase()];
  if (copy) return getLang() === 'fr' ? copy[1] : copy[0];
  return fallback || orderCopy('Something went wrong. Please try again.', 'Un problème est survenu. Réessayez.');
}

function isOrdersUnauthorized(error) {
  return Number(error?.status) === 401;
}

function clearPrivateOrderState() {
  ordersPrivacyEpoch += 1;
  loadedOrders = [];
  loadedOrderEntries = [];
  nextOrdersCursor = null;
  ordersLoadMoreError = '';
  ordersInitialLoadComplete = false;
  ordersRequestPending = false;
  submittedReturns.clear();
  returnDraftAttempts.clear();
  reorderAttempts.clear();
  pendingReorders.clear();
  pendingReturns.clear();
  pendingCancellations.clear();
}

function renderOrdersGuestRecovery(focus = false) {
  const box = $('ordersList');
  if (!box) return;
  const returnTarget = `orders.html${location.search || ''}`;
  box.removeAttribute('aria-busy');
  box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-lock fa-3x text-muted mb-3" aria-hidden="true"></i><h2 class="h5">${orderCopy('Your session expired', 'Votre session a expiré')}</h2><p class="text-muted">${orderCopy('Sign in again to view your private order history across devices. You can keep shopping without an account.', 'Reconnectez-vous pour consulter votre historique privé sur tous vos appareils. Vous pouvez continuer vos achats sans compte.')}</p><div class="d-flex flex-wrap justify-content-center gap-2"><a class="btn btn-orange" data-orders-signin href="login.html?next=${encodeURIComponent(returnTarget)}">${orderCopy('Sign in', 'Se connecter')}</a><a class="btn btn-outline-orange" href="categories.html">${orderCopy('Continue shopping', 'Continuer vos achats')}</a></div></div>`;
  if (focus) requestAnimationFrame(() => box.querySelector('[data-orders-signin]')?.focus({ preventScroll: true }));
}

function handleOrdersUnauthorized(error, invokeShared = true) {
  if (invokeShared && !isOrdersUnauthorized(error)) return false;
  if (ordersUnauthorizedTransitioning) return true;
  ordersUnauthorizedTransitioning = true;
  try {
    // Remove page-owned private data before the shared transition updates the
    // global session. That transition emits am:session-expired synchronously;
    // the guard prevents its listener from repeating this local cleanup.
    clearPrivateOrderState();
    try {
      renderOrdersGuestRecovery(true);
    } catch (renderError) {
      console.error('[AM MARKET orders] Session-expiry recovery could not be rendered', renderError);
    }
    if (invokeShared && typeof handleStoreUnauthorized === 'function') {
      try {
        handleStoreUnauthorized(error);
      } catch (transitionError) {
        console.error('[AM MARKET orders] Shared session-expiry transition failed', transitionError);
      }
    }
  } finally {
    ordersUnauthorizedTransitioning = false;
  }
  return true;
}

function ordersSessionChanged(epoch) {
  return epoch !== ordersPrivacyEpoch;
}

function cartQuantities(payload) {
  return new Map((payload?.cart?.items || []).map(item => [String(item.productId), Number(item.quantity) || 0]));
}

function applyAuthoritativeCart(payload) {
  cart = cartFromApi(payload);
  updateBadges();
}

function isMissingReorderProduct(error) {
  return Number(error?.status) === 404 || String(error?.code || '').toUpperCase() === 'PRODUCT_NOT_FOUND';
}

function reorderStockLimit(product) {
  const quantityAvailable = product?.quantity_available ?? product?.quantityAvailable;
  const candidates = [product?.stock_quantity, product?.stockQuantity];
  if (typeof quantityAvailable !== 'boolean') candidates.push(quantityAvailable);
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const quantity = Number(candidate);
    if (Number.isSafeInteger(quantity) && quantity >= 0) return quantity;
  }
  // The cart API treats a normalized null stock value as unknown/unbounded and
  // performs the authoritative availability check again during the write.
  return null;
}

function reorderProductAllowsTarget(product, target) {
  if (!product || product.is_available === false || product.isAvailable === false ||
      product.quantity_available === false || product.quantityAvailable === false) return false;
  const stockLimit = reorderStockLimit(product);
  return stockLimit == null || target <= stockLimit;
}

function reorderAttemptError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function canonicalReorderPayload(payload) {
  if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 100) {
    throw reorderAttemptError('REORDER_ATTEMPT_UNRECOVERABLE');
  }
  const seen = new Set();
  const items = payload.items.map(item => {
    const productId = String(item?.productId || '').trim();
    const quantity = Number(item?.quantity);
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99 || seen.has(productId)) {
      throw reorderAttemptError('REORDER_ATTEMPT_UNRECOVERABLE');
    }
    seen.add(productId);
    return { productId, quantity };
  }).sort((left, right) => left.productId.localeCompare(right.productId));
  return { items };
}

function reorderPayloadSignature(payload) {
  return JSON.stringify(canonicalReorderPayload(payload));
}

function reorderAttemptStorageKey() {
  const userId = String(getUser()?.id || '').trim();
  return userId ? `${REORDER_ATTEMPT_STORAGE_PREFIX}${encodeURIComponent(userId)}` : null;
}

function reorderKeyCreatedAt(idempotencyKey) {
  const match = /^am1\.([0-9a-z]+)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(String(idempotencyKey || ''));
  if (!match) return null;
  const createdAt = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(createdAt) && createdAt >= 0 ? createdAt : null;
}

function normalizePersistedReorderAttempt(value, now = Date.now()) {
  const orderId = String(value?.orderId || '').trim();
  if (!orderId || orderId.length > 128) throw reorderAttemptError('REORDER_ATTEMPT_UNRECOVERABLE');
  const blockedReason = ['REORDER_ATTEMPT_UNRECOVERABLE', 'REORDER_ATTEMPT_EXPIRED'].includes(value?.blockedReason)
    ? value.blockedReason
    : null;
  if (blockedReason && !value?.idempotencyKey) {
    return { orderId, blockedReason: value.blockedReason, needsReplay: true };
  }
  try {
    const payload = canonicalReorderPayload(value.payload);
    const signature = reorderPayloadSignature(payload);
    const idempotencyKey = String(value.idempotencyKey || '');
    const createdAt = reorderKeyCreatedAt(idempotencyKey);
    const expiresAt = createdAt == null ? null : createdAt + REORDER_ATTEMPT_TTL_MS;
    if (createdAt == null || value.signature !== signature || value.createdAt !== createdAt || value.expiresAt !== expiresAt ||
        !Number.isSafeInteger(value.added) || value.added < 1 || !Number.isSafeInteger(value.skipped) || value.skipped < 0) {
      throw reorderAttemptError('REORDER_ATTEMPT_UNRECOVERABLE');
    }
    return {
      orderId,
      idempotencyKey,
      signature,
      payload,
      added: value.added,
      skipped: value.skipped,
      createdAt,
      expiresAt,
      needsReplay: true,
      ...(blockedReason || now > expiresAt ? { blockedReason: blockedReason || 'REORDER_ATTEMPT_EXPIRED' } : {})
    };
  } catch {
    return { orderId, blockedReason: 'REORDER_ATTEMPT_UNRECOVERABLE', needsReplay: true };
  }
}

function hydrateReorderAttempts(now = Date.now()) {
  reorderAttempts.clear();
  reorderAttemptStorageBlocked = null;
  const key = reorderAttemptStorageKey();
  if (!key) return;
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    reorderAttemptStorageBlocked = 'REORDER_PERSISTENCE_UNAVAILABLE';
    return;
  }
  if (!raw) return;
  try {
    const stored = JSON.parse(raw);
    const userId = String(getUser()?.id || '').trim();
    if (stored?.version !== REORDER_ATTEMPT_STORAGE_VERSION || stored?.userId !== userId ||
        !Array.isArray(stored.attempts) || stored.attempts.length > 100) {
      throw reorderAttemptError('REORDER_ATTEMPT_UNRECOVERABLE');
    }
    stored.attempts.forEach(value => {
      const attempt = normalizePersistedReorderAttempt(value, now);
      if (reorderAttempts.has(attempt.orderId)) throw reorderAttemptError('REORDER_ATTEMPT_UNRECOVERABLE');
      reorderAttempts.set(attempt.orderId, attempt);
    });
  } catch (error) {
    console.error('[AM MARKET orders] Persisted reorder recovery is invalid', error);
    reorderAttempts.clear();
    reorderAttemptStorageBlocked = 'REORDER_ATTEMPT_UNRECOVERABLE';
  }
}

function persistReorderAttempts() {
  const key = reorderAttemptStorageKey();
  if (!key) throw reorderAttemptError('REORDER_PERSISTENCE_UNAVAILABLE');
  const userId = String(getUser()?.id || '').trim();
  try {
    if (!reorderAttempts.size) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      version: REORDER_ATTEMPT_STORAGE_VERSION,
      userId,
      attempts: [...reorderAttempts.values()].map(attempt => attempt.idempotencyKey
        ? {
            orderId: attempt.orderId,
            idempotencyKey: attempt.idempotencyKey,
            signature: attempt.signature,
            payload: attempt.payload,
            added: attempt.added,
            skipped: attempt.skipped,
            createdAt: attempt.createdAt,
            expiresAt: attempt.expiresAt,
            ...(attempt.blockedReason ? { blockedReason: attempt.blockedReason } : {})
          }
        : { orderId: attempt.orderId, blockedReason: attempt.blockedReason || 'REORDER_ATTEMPT_UNRECOVERABLE' })
    }));
  } catch (error) {
    console.error('[AM MARKET orders] Reorder recovery could not be persisted', error);
    throw reorderAttemptError('REORDER_PERSISTENCE_UNAVAILABLE');
  }
}

async function withReorderOperationLock(work) {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') throw reorderAttemptError('REORDER_LOCK_UNAVAILABLE');
  const userId = String(getUser()?.id || '').trim();
  if (!userId) throw reorderAttemptError('AUTH_REQUIRED');
  return locks.request(`am-market-reorder:${userId}`, { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) throw reorderAttemptError('REORDER_ALREADY_IN_PROGRESS');
    return work();
  });
}

function createStoreIdempotencyKey() {
  if (typeof StoreAPI.createIdempotencyKey !== 'function') {
    throw Object.assign(new Error('A secure idempotency-key generator is unavailable.'), { code: 'CRYPTO_UNAVAILABLE' });
  }
  return StoreAPI.createIdempotencyKey();
}

async function reorderAttemptFor(orderId, payload, counts) {
  hydrateReorderAttempts();
  if (reorderAttemptStorageBlocked) throw reorderAttemptError(reorderAttemptStorageBlocked);
  const existing = reorderAttempts.get(orderId);
  if (existing?.blockedReason) throw reorderAttemptError(existing.blockedReason);
  if (existing) return existing;

  const canonicalPayload = canonicalReorderPayload(payload);
  const idempotencyKey = createStoreIdempotencyKey();
  const createdAt = reorderKeyCreatedAt(idempotencyKey);
  if (createdAt == null) throw reorderAttemptError('CRYPTO_UNAVAILABLE');
  const attempt = {
    orderId,
    idempotencyKey,
    signature: reorderPayloadSignature(canonicalPayload),
    payload: canonicalPayload,
    added: counts.added,
    skipped: counts.skipped,
    createdAt,
    expiresAt: createdAt + REORDER_ATTEMPT_TTL_MS,
    needsReplay: true
  };
  reorderAttempts.set(orderId, attempt);
  try {
    persistReorderAttempts();
  } catch (error) {
    reorderAttempts.delete(orderId);
    throw error;
  }
  return attempt;
}

async function retainReorderAttempt(orderId, attempt) {
  hydrateReorderAttempts();
  if (reorderAttemptStorageBlocked) return;
  if (!reorderAttempts.has(orderId)) {
    reorderAttempts.set(orderId, attempt);
    persistReorderAttempts();
  }
}

async function blockReorderAttempt(orderId, attempt, blockedReason) {
  hydrateReorderAttempts();
  if (reorderAttemptStorageBlocked) return;
  const stored = reorderAttempts.get(orderId);
  if (!stored || stored.idempotencyKey === attempt.idempotencyKey) {
    reorderAttempts.set(orderId, { ...attempt, blockedReason, needsReplay: true });
    persistReorderAttempts();
  }
}

async function clearReorderAttempt(orderId, idempotencyKey) {
  hydrateReorderAttempts();
  if (reorderAttemptStorageBlocked) return false;
  const stored = reorderAttempts.get(orderId);
  if (stored && stored.idempotencyKey !== idempotencyKey) return false;
  reorderAttempts.delete(orderId);
  persistReorderAttempts();
  return true;
}

function reorderRecoveryBlock(orderId) {
  if (reorderAttemptStorageBlocked) return reorderAttemptStorageBlocked;
  return reorderAttempts.get(orderId)?.blockedReason || null;
}

async function discardBlockedReorderRecovery(orderId, button) {
  const globalBlock = Boolean(reorderAttemptStorageBlocked);
  const confirmation = globalBlock
    ? orderCopy(
        'Discard all unreadable saved reorder recovery data? Review your cart first; this cannot verify whether an earlier request succeeded.',
        'Supprimer toutes les données de récupération de nouvelle commande illisibles ? Vérifiez d’abord votre panier ; il est impossible de confirmer si une demande antérieure a réussi.'
      )
    : orderCopy(
        'Discard this saved reorder recovery? Review your cart first; this cannot verify whether the earlier request succeeded.',
        'Supprimer cette récupération de nouvelle commande enregistrée ? Vérifiez d’abord votre panier ; il est impossible de confirmer si la demande antérieure a réussi.'
      );
  if (!window.confirm(confirmation)) return;

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    await withReorderOperationLock(() => {
      hydrateReorderAttempts();
      const key = reorderAttemptStorageKey();
      if (!key) throw reorderAttemptError('REORDER_PERSISTENCE_UNAVAILABLE');
      if (reorderAttemptStorageBlocked) {
        try {
          localStorage.removeItem(key);
        } catch (error) {
          throw reorderAttemptError('REORDER_PERSISTENCE_UNAVAILABLE', error?.message);
        }
        reorderAttempts.clear();
        reorderAttemptStorageBlocked = null;
        return;
      }
      const attempt = reorderAttempts.get(orderId);
      if (attempt && !attempt.blockedReason) throw reorderAttemptError('REORDER_ALREADY_IN_PROGRESS');
      reorderAttempts.delete(orderId);
      persistReorderAttempts();
    });
    toast(orderCopy(
      'Saved reorder recovery discarded. You can start a new reorder after reviewing your cart.',
      'La récupération enregistrée a été supprimée. Vous pouvez recommencer après avoir vérifié votre panier.'
    ));
    renderCurrentOrders({ viewState: captureOrderViewState($('ordersList')), focusOrderId: orderId });
  } catch (error) {
    toast(orderErrorMessage(error, orderCopy(
      'The saved reorder recovery could not be discarded.',
      'Impossible de supprimer la récupération enregistrée.'
    )));
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function returnProgressFor(orderId) {
  return submittedReturns.get(orderId) || { ids: [], quantities: new Map() };
}

function remainingReturnQuantity(order, item) {
  const authoritativeReturned = Math.max(0, Number(item.returnedQuantity) || 0);
  const optimisticReturnedFloor = returnProgressFor(order.id).quantities.get(item.id) || 0;
  const returned = Math.max(authoritativeReturned, optimisticReturnedFloor);
  return Math.max(0, Number(item.quantity || 0) - returned);
}

function recordSubmittedReturn(order, returnId, items) {
  const current = returnProgressFor(order.id);
  const quantities = new Map(current.quantities);
  items.forEach(item => {
    const source = order.items.find(orderItem => orderItem.id === item.orderItemId);
    if (!source) return;
    const authoritativeReturned = Math.max(0, Number(source.returnedQuantity) || 0);
    const priorReturnedFloor = Math.max(authoritativeReturned, quantities.get(source.id) || 0);
    quantities.set(source.id, priorReturnedFloor + item.quantity);
  });
  submittedReturns.set(order.id, { ids: [...current.ids, returnId], quantities });
}

function returnPayloadSignature(payload) {
  const items = payload.items
    .map(item => ({ orderItemId: item.orderItemId, quantity: item.quantity }))
    .sort((left, right) => String(left.orderItemId).localeCompare(String(right.orderItemId)));
  return JSON.stringify({
    reason: payload.reason,
    details: payload.details,
    items
  });
}

function returnAttemptFor(orderId, payload) {
  const signature = returnPayloadSignature(payload);
  let attempt = returnDraftAttempts.get(orderId);
  // Once a key has crossed the network it belongs to that exact request body.
  // Editing a failed draft therefore starts a distinct idempotent operation;
  // unchanged retries retain the key even when the first response was lost.
  if (attempt?.submittedSignature && attempt.submittedSignature !== signature) attempt = null;
  if (!attempt) {
    attempt = { idempotencyKey: createStoreIdempotencyKey(), submittedSignature: null };
    returnDraftAttempts.set(orderId, attempt);
  }
  attempt.submittedSignature = signature;
  return attempt;
}

function orderLocale() { return getLang() === 'fr' ? 'fr-FR' : 'en-GB'; }

function statusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  const copy = ORDER_STATUS_COPY[normalized];
  if (copy) return getLang() === 'fr' ? copy[1] : copy[0];
  return normalized.replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

function formatOrderDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(orderLocale(), includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function orderDateTimeValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function trackingMessage(event) {
  const copy = TRACKING_MESSAGE_COPY[String(event.code || '').toLowerCase()];
  if (!copy) return event.message || '';
  const knownEnglish = copy[0].toLowerCase();
  const message = String(event.message || '').trim();
  return !message || message.toLowerCase() === knownEnglish
    ? (getLang() === 'fr' ? copy[1] : copy[0])
    : message;
}

function trackingEventHTML(event) {
  const eventStatus = event.status || String(event.code || '').replace(/^order_/, '');
  const dateTime = orderDateTimeValue(event.occurredAt);
  return `<li><strong>${escapeHtml(statusLabel(eventStatus))}</strong> — ${escapeHtml(trackingMessage(event))} <time${dateTime ? ` datetime="${escapeHtml(dateTime)}"` : ''}>${escapeHtml(formatOrderDate(event.occurredAt, true))}</time></li>`;
}

function statusIndex(status) { return ORDER_STEPS.indexOf(String(status || '').toLowerCase()); }

function timelineHTML(order) {
  if (order.status === 'cancelled') {
    return `<div class="order-timeline is-cancelled" role="status"><span class="ot-dot"><i class="fa-solid fa-xmark" aria-hidden="true"></i></span><span class="ot-label">${orderCopy('Cancelled', 'Annulée')}</span></div>`;
  }
  const index = Math.max(0, statusIndex(order.status));
  return `<div class="order-timeline" role="list" aria-label="${escapeHtml(t('order_progress'))}">
    ${ORDER_STEPS.map((step, i) => `<div class="ot-step ${i <= index ? 'done' : ''} ${i === index ? 'current' : ''}" role="listitem" ${i === index ? 'aria-current="step"' : ''}>
      <span class="ot-dot">${i < index ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : i + 1}</span><span class="ot-label">${t(`status_${step}`)}</span>
    </div>${i < ORDER_STEPS.length - 1 ? `<div class="ot-line ${i < index ? 'done' : ''}" aria-hidden="true"></div>` : ''}`).join('')}
  </div>`;
}

async function reorder(orderId, button) {
  if (pendingReorders.has(orderId)) return;
  try {
    return await withReorderOperationLock(() => reorderUnderLock(orderId, button));
  } catch (error) {
    toast(orderErrorMessage(error, orderCopy('The items could not be added. Please try again.', 'Impossible d’ajouter les articles. Réessayez.')));
  }
}

async function reorderUnderLock(orderId, button) {
  if (pendingReorders.has(orderId)) return;
  const order = loadedOrders.find(item => item.id === orderId);
  if (!order) return;
  hydrateReorderAttempts();
  const originalContent = button.innerHTML;
  const privacyEpoch = ordersPrivacyEpoch;
  let redirecting = false;
  let unauthorized = false;
  let mergeStarted = false;
  let attempt = reorderAttempts.get(orderId) || null;
  pendingReorders.add(orderId);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = t('checking_items');
  try {
    if (reorderAttemptStorageBlocked) throw reorderAttemptError(reorderAttemptStorageBlocked);
    if (attempt?.blockedReason) throw reorderAttemptError(attempt.blockedReason);
    // An ambiguous prior response must be reconciled with the exact same body
    // and key. Re-running stock classification after the server may already
    // have committed would risk turning a replay into a different operation.
    if (!attempt?.needsReplay) {
      // Resolve the complete catalog preflight before touching the cart.
      // Missing products are per-line skips; transient/invalid catalog errors
      // abort while the atomic merge is still untouched.
      const productResults = await Promise.allSettled(order.items.map(item => fetchProduct(item.productId)));
      if (ordersSessionChanged(privacyEpoch)) return;
      const unauthorizedProduct = productResults.find(result => result.status === 'rejected' && isOrdersUnauthorized(result.reason));
      if (unauthorizedProduct) throw unauthorizedProduct.reason;
      const transientFailure = productResults.find(result => result.status === 'rejected' && !isMissingReorderProduct(result.reason));
      if (transientFailure) throw transientFailure.reason;
      const stagedItems = order.items.map((item, index) => ({
        item,
        product: productResults[index].status === 'fulfilled' ? productResults[index].value : null
      }));
      const authoritativeBefore = await StoreAPI.cart.get();
      if (ordersSessionChanged(privacyEpoch)) return;
      applyAuthoritativeCart(authoritativeBefore);
      const projectedQuantities = cartQuantities(authoritativeBefore);
      const quantitiesToAdd = new Map();
      let added = 0;
      let skipped = 0;
      stagedItems.forEach(({ item, product }) => {
        const quantity = Number(item.quantity);
        if (!product || !Number.isSafeInteger(quantity) || quantity <= 0) {
          skipped += 1;
          return;
        }
        const productId = String(product.id);
        const current = projectedQuantities.get(productId) || 0;
        const target = current + quantity;
        if (target > 99 || !reorderProductAllowsTarget(product, target)) {
          skipped += 1;
          return;
        }
        projectedQuantities.set(productId, target);
        quantitiesToAdd.set(productId, (quantitiesToAdd.get(productId) || 0) + quantity);
        added += 1;
      });

      if (!added) {
        reorderAttempts.delete(orderId);
        toast(t('reorder_none'));
        button.disabled = false;
        return;
      }

      const payload = {
        items: [...quantitiesToAdd].map(([productId, quantity]) => ({ productId, quantity }))
      };
      attempt = await reorderAttemptFor(orderId, payload, { added, skipped });
    }

    mergeStarted = true;
    const authoritativeAfter = await StoreAPI.cart.mergeGuest(attempt.payload, {
      idempotencyKey: attempt.idempotencyKey
    });
    if (ordersSessionChanged(privacyEpoch)) return;
    applyAuthoritativeCart(authoritativeAfter);
    await clearReorderAttempt(orderId, attempt.idempotencyKey);
    if (authoritativeAfter?.replayed === true) {
      toast(orderCopy(
        'This reorder was already processed. Review your current cart before continuing.',
        'Cette demande de nouvelle commande a déjà été traitée. Vérifiez votre panier actuel avant de continuer.'
      ));
      button.disabled = false;
      return;
    }
    toast(attempt.skipped
      ? t('reorder_partial', { added: attempt.added, skipped: attempt.skipped })
      : t('reorder_ok'));
    redirecting = true;
    setTimeout(() => { location.href = 'cart.html'; }, 500);
  } catch (error) {
    if (handleOrdersUnauthorized(error)) {
      unauthorized = true;
      return;
    }
    if (mergeStarted && attempt) {
      const code = String(error?.code || '').toUpperCase();
      try {
        if (code === 'IDEMPOTENCY_KEY_EXPIRED') {
          await blockReorderAttempt(orderId, attempt, 'REORDER_ATTEMPT_EXPIRED');
        } else if (['IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_IDEMPOTENCY_KEY'].includes(code)) {
          await blockReorderAttempt(orderId, attempt, 'REORDER_ATTEMPT_UNRECOVERABLE');
        } else {
          await retainReorderAttempt(orderId, attempt);
        }
      } catch (persistenceError) {
        console.error('[AM MARKET orders] Reorder recovery state could not be retained', persistenceError);
      }
    }
    toast(orderErrorMessage(error, orderCopy('The items could not be added. Please try again.', 'Impossible d’ajouter les articles. Réessayez.')));
    button.disabled = false;
  } finally {
    if (!redirecting) {
      pendingReorders.delete(orderId);
      button.innerHTML = originalContent;
      button.removeAttribute('aria-busy');
      if (!unauthorized && !ordersSessionChanged(privacyEpoch) && !button.isConnected) renderCurrentOrders({ viewState: captureOrderViewState($('ordersList')) });
    }
  }
}

async function cancelOrder(orderId, button) {
  if (pendingCancellations.has(orderId)) return;
  if (!window.confirm(orderCopy('Cancel this order?', 'Annuler cette commande ?'))) return;
  const originalContent = button.innerHTML;
  const privacyEpoch = ordersPrivacyEpoch;
  pendingCancellations.add(orderId);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = orderCopy('Cancelling…', 'Annulation…');
  try {
    const payload = await StoreAPI.orders.cancel(orderId, { reason: 'changed_mind' });
    if (ordersSessionChanged(privacyEpoch)) return;
    const entry = loadedOrderEntries.find(item => item.summary.id === orderId);
    if (entry && payload.order) {
      entry.order = payload.order;
      entry.summary = { ...entry.summary, ...payload.order };
      entry.error = null;
      syncLoadedOrders();
    }
    toast(orderCopy('Order cancelled.', 'Commande annulée.'));
    renderCurrentOrders({ viewState: captureOrderViewState($('ordersList')), focusOrderId: orderId });
  } catch (error) {
    if (handleOrdersUnauthorized(error)) return;
    try {
      const reconciled = await StoreAPI.orders.get(orderId);
      if (ordersSessionChanged(privacyEpoch)) return;
      if (reconciled.order?.status === 'cancelled') {
        const entry = loadedOrderEntries.find(item => item.summary.id === orderId);
        if (entry) {
          entry.order = reconciled.order;
          entry.summary = { ...entry.summary, ...reconciled.order };
          entry.error = null;
          syncLoadedOrders();
        }
        toast(orderCopy('Order cancelled.', 'Commande annulée.'));
        renderCurrentOrders({ viewState: captureOrderViewState($('ordersList')), focusOrderId: orderId });
        return;
      }
    } catch (reconcileError) {
      if (handleOrdersUnauthorized(reconcileError)) return;
      if (ordersSessionChanged(privacyEpoch)) return;
      console.error('[AM MARKET orders] Could not reconcile order after cancellation failure', reconcileError);
    }
    toast(orderErrorMessage(error, orderCopy('The order could not be cancelled. Please try again.', 'Impossible d’annuler la commande. Réessayez.')));
    button.disabled = false;
  } finally {
    pendingCancellations.delete(orderId);
    if (button.isConnected) {
      button.innerHTML = originalContent;
      button.removeAttribute('aria-busy');
    }
    if (!ordersSessionChanged(privacyEpoch) && !button.isConnected && loadedOrderEntries.some(entry => entry.summary.id === orderId && entry.order?.status !== 'cancelled')) {
      renderCurrentOrders({ viewState: captureOrderViewState($('ordersList')) });
    }
  }
}

async function submitReturn(order, form) {
  let invalidQuantity = false;
  const items = order.items.map(item => {
    const input = form.querySelector(`[data-return-item="${CSS.escape(item.id)}"]`);
    const quantity = Number(input?.value || 0);
    if (quantity > remainingReturnQuantity(order, item)) invalidQuantity = true;
    return quantity > 0 ? { orderItemId: item.id, quantity } : null;
  }).filter(Boolean);
  if (!items.length) { toast(orderCopy('Choose at least one item.', 'Choisissez au moins un article.')); return; }
  if (invalidQuantity) { toast(orderCopy('A return quantity is higher than the remaining eligible quantity.', 'Une quantité de retour dépasse la quantité restante éligible.')); return; }
  if (pendingReturns.has(order.id)) return;
  const payload = {
    reason: form.elements.reason.value,
    details: form.elements.details.value.trim() || null,
    items
  };
  let returnAttempt;
  try {
    returnAttempt = returnAttemptFor(order.id, payload);
  } catch (error) {
    toast(orderErrorMessage(error, orderCopy('A secure return request could not be created. Please try again.', 'Impossible de créer une demande de retour sécurisée. Réessayez.')));
    return;
  }
  const privacyEpoch = ordersPrivacyEpoch;
  pendingReturns.add(order.id);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  try {
    const result = await StoreAPI.orders.requestReturn(order.id, payload, {
      idempotencyKey: returnAttempt.idempotencyKey
    });
    if (ordersSessionChanged(privacyEpoch)) return;
    const returnId = typeof result?.return?.id === 'string' ? result.return.id.trim() : '';
    if (!returnId) {
      throw Object.assign(new Error('The return response did not include a valid return ID.'), { code: 'INVALID_RESPONSE' });
    }
    recordSubmittedReturn(order, returnId, items);
    // A resolved response confirms this logical return. A later return for any
    // remaining quantities must start with a fresh key.
    returnDraftAttempts.delete(order.id);
    try {
      const refreshed = await StoreAPI.orders.get(order.id);
      if (ordersSessionChanged(privacyEpoch)) return;
      const entry = loadedOrderEntries.find(item => item.summary.id === order.id);
      if (entry && refreshed.order) {
        entry.order = refreshed.order;
        entry.summary = { ...entry.summary, ...refreshed.order };
        entry.error = null;
        syncLoadedOrders();
        order = refreshed.order;
      }
    } catch (refreshError) {
      if (handleOrdersUnauthorized(refreshError)) return;
      // The return was already accepted. Keep the local remaining-quantity
      // reconciliation and log a detail-refresh problem without misreporting
      // the successful return as failed.
      console.error('[AM MARKET orders] Could not refresh order after successful return', refreshError);
    }
    pendingReturns.delete(order.id);
    toast(orderCopy(`Return ${returnId} requested.`, `Retour ${returnId} demandé.`));
    const box = $('ordersList');
    const viewState = captureOrderViewState(box);
    viewState.drafts.delete(order.id);
    viewState.expanded.delete(`${order.id}:return`);
    renderCurrentOrders({ viewState });
    const success = findOrderCard(box, order.id)?.querySelector('[data-return-success]');
    if (success) {
      success.focus({ preventScroll: true });
      success.scrollIntoView({ behavior: motionBehavior(), block: 'nearest' });
    }
  } catch (error) {
    pendingReturns.delete(order.id);
    if (handleOrdersUnauthorized(error)) return;
    toast(orderErrorMessage(error, orderCopy('The return request could not be sent. Please try again.', 'Impossible d’envoyer la demande de retour. Réessayez.')));
    const box = $('ordersList');
    const viewState = captureOrderViewState(box);
    renderCurrentOrders({ viewState });
    requestAnimationFrame(() => findOrderCard(box, order.id)?.querySelector('[data-return-form] button[type="submit"]')?.focus({ preventScroll: true }));
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  }
}

function returnPanel(order) {
  if (order.returnEligible !== true) return '';
  const progress = returnProgressFor(order.id);
  const latestReturnId = progress.ids.at(-1);
  const remainingItems = order.items.map(item => ({ item, remaining: remainingReturnQuantity(order, item) })).filter(entry => entry.remaining > 0);
  const confirmation = latestReturnId
    ? `<div class="alert alert-success mt-3 mb-0" role="status" tabindex="-1" data-return-success="${escapeHtml(order.id)}"><i class="fa-solid fa-circle-check me-2" aria-hidden="true"></i><strong>${orderCopy('Return requested', 'Retour demandé')}</strong><span class="d-block small mt-1">${escapeHtml(remainingItems.length
      ? orderCopy(`Request ${latestReturnId} was received. You can still request a return for the remaining eligible quantities below.`, `La demande ${latestReturnId} a été reçue. Vous pouvez encore demander le retour des quantités restantes éligibles ci-dessous.`)
      : orderCopy(`Request ${latestReturnId} was received. We’ll notify you about updates.`, `La demande ${latestReturnId} a été reçue. Nous vous informerons des mises à jour.`))}</span></div>`
    : '';
  if (!remainingItems.length) return confirmation;
  const pending = pendingReturns.has(order.id);
  const disabled = pending ? ' disabled' : '';
  return `${confirmation}<details class="order-details return-request"><summary aria-label="${escapeHtml(orderCopy(`Request a return for order ${order.orderNumber}`, `Demander un retour pour la commande ${order.orderNumber}`))}">${latestReturnId ? orderCopy('Return remaining items', 'Retourner les articles restants') : orderCopy('Request a return', 'Demander un retour')}</summary>
    <form data-return-form="${escapeHtml(order.id)}" class="mt-3"${pending ? ' aria-busy="true"' : ''}>
      <label class="form-label">${orderCopy('Reason', 'Motif')}<select class="form-select" name="reason" required aria-label="${escapeHtml(orderCopy(`Return reason for order ${order.orderNumber}`, `Motif du retour pour la commande ${order.orderNumber}`))}"${disabled}>
        <option value="damaged">${orderCopy('Damaged', 'Endommagé')}</option><option value="wrong_item">${orderCopy('Wrong item', 'Mauvais article')}</option>
        <option value="not_as_described">${orderCopy('Not as described', 'Non conforme')}</option><option value="quality">${orderCopy('Quality issue', 'Problème de qualité')}</option><option value="other">${orderCopy('Other', 'Autre')}</option>
      </select></label>
      ${remainingItems.map(({ item, remaining }) => `<label class="d-flex justify-content-between align-items-center gap-3 mb-2"><span>${escapeHtml(item.name)} <span class="small text-muted">${escapeHtml(orderCopy(`(${remaining} remaining)`, `(${remaining} restant(s))`))}</span></span>
        <input class="form-control" style="max-width:5rem" type="number" min="0" max="${remaining}" value="0" data-return-item="${escapeHtml(item.id)}" aria-label="${escapeHtml(orderCopy(`Return quantity for ${item.name} in order ${order.orderNumber}; ${remaining} remaining`, `Quantité à retourner pour ${item.name} dans la commande ${order.orderNumber} ; ${remaining} restant(s)`))}"${disabled}></label>`).join('')}
      <label class="form-label w-100">${orderCopy('Details (optional)', 'Détails (facultatif)')}<textarea class="form-control" name="details" maxlength="1000" aria-label="${escapeHtml(orderCopy(`Optional return details for order ${order.orderNumber}`, `Détails facultatifs du retour pour la commande ${order.orderNumber}`))}"${disabled}></textarea></label>
      <button class="btn btn-orange" type="submit" aria-label="${escapeHtml(orderCopy(`Submit return for order ${order.orderNumber}`, `Envoyer la demande de retour pour la commande ${order.orderNumber}`))}"${disabled}>${pending ? orderCopy('Sending return…', 'Envoi du retour…') : orderCopy('Submit return', 'Envoyer la demande')}</button>
    </form></details>`;
}

function orderCard(order) {
  const date = formatOrderDate(order.placedAt);
  const canCancel = ['confirmed', 'preparing'].includes(order.status);
  const reordering = pendingReorders.has(order.id);
  const cancelling = pendingCancellations.has(order.id);
  const recoveryBlock = reorderRecoveryBlock(order.id);
  const globalRecoveryBlock = Boolean(reorderAttemptStorageBlocked);
  const orderNumber = escapeHtml(order.orderNumber);
  const titleId = `order-title-${escapeHtml(order.id)}`;
  const normalizedStatus = String(order.status || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `<article class="order-card" data-order-id="${escapeHtml(order.id)}" aria-labelledby="${titleId}"><div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
    <div><h2 class="h6 mb-0" id="${titleId}">${orderNumber}</h2><div class="small text-muted">${escapeHtml(date)}</div></div><span class="order-status status-${normalizedStatus}">${escapeHtml(statusLabel(order.status))}</span></div>
    ${timelineHTML(order)}<div class="small text-muted mb-2 mt-2">${order.items.map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(', ')}</div>
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2"><strong>${formatPrice(order.total)}</strong><div class="d-flex gap-2 flex-wrap">
      <button type="button" class="btn-reorder" data-reorder="${escapeHtml(order.id)}" aria-label="${escapeHtml(orderCopy(`Reorder order ${order.orderNumber}`, `Commander à nouveau la commande ${order.orderNumber}`))}"${reordering ? ' disabled aria-busy="true"' : ''}>${reordering ? escapeHtml(t('checking_items')) : `<i class="fa-solid fa-rotate-right me-1" aria-hidden="true"></i>${t('reorder')}`}</button>
      ${canCancel ? `<button type="button" class="btn btn-sm btn-outline-danger" data-cancel="${escapeHtml(order.id)}" aria-label="${escapeHtml(orderCopy(`Cancel order ${order.orderNumber}`, `Annuler la commande ${order.orderNumber}`))}"${cancelling ? ' disabled aria-busy="true"' : ''}>${cancelling ? orderCopy('Cancelling…', 'Annulation…') : orderCopy('Cancel', 'Annuler')}</button>` : ''}</div></div>
    ${recoveryBlock ? `<div class="alert alert-warning mt-3 mb-0" role="alert"><p class="mb-2">${escapeHtml(orderErrorMessage({ code: recoveryBlock }))}</p><div class="d-flex gap-2 flex-wrap"><a class="btn btn-sm btn-outline-secondary" href="cart.html">${escapeHtml(orderCopy('Review cart', 'Vérifier le panier'))}</a><button type="button" class="btn btn-sm btn-outline-danger" data-reorder-recovery-clear="${escapeHtml(order.id)}">${escapeHtml(orderCopy(globalRecoveryBlock ? 'Discard all saved recovery' : 'Discard saved recovery', globalRecoveryBlock ? 'Supprimer toute la récupération' : 'Supprimer la récupération'))}</button></div></div>` : ''}
    <details class="order-details"><summary aria-label="${escapeHtml(orderCopy(`Details for order ${order.orderNumber}`, `Détails de la commande ${order.orderNumber}`))}">${t('order_details')}</summary><div class="order-details-grid">
      <div><strong>${t('delivery_contact')}</strong><span>${escapeHtml([order.address.recipientName, order.address.phone, order.address.email].filter(Boolean).join(' · '))}</span><span>${escapeHtml([order.address.addressLine1, order.address.district, order.address.city].filter(Boolean).join(', '))}</span></div>
      <div class="order-totals"><span>${t('subtotal')} <strong>${formatPrice(order.subtotal)}</strong></span><span>${t('delivery')} <strong>${formatPrice(order.deliveryFee)}</strong></span><span>${t('total')} <strong>${formatPrice(order.total)}</strong></span></div></div>
      ${(order.tracking || []).length ? `<ol class="small mt-3">${order.tracking.map(trackingEventHTML).join('')}</ol>` : ''}</details>
    ${returnPanel(order)}</article>`;
}

function failedOrderCard(entry) {
  const order = entry.summary;
  const orderNumber = escapeHtml(order.orderNumber);
  const titleId = `order-title-${escapeHtml(order.id)}`;
  const normalizedStatus = String(order.status || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `<article class="order-card" data-order-id="${escapeHtml(order.id)}" aria-labelledby="${titleId}"><div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
    <div><h2 class="h6 mb-0" id="${titleId}">${orderNumber}</h2><div class="small text-muted">${escapeHtml(formatOrderDate(order.placedAt))}</div></div><span class="order-status status-${normalizedStatus}">${escapeHtml(statusLabel(order.status))}</span></div>
    ${timelineHTML(order)}
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3"><strong>${formatPrice(order.total)}</strong></div>
    <div class="alert alert-warning mt-3 mb-0" role="alert"><p class="mb-2"><i class="fa-solid fa-triangle-exclamation me-2" aria-hidden="true"></i>${t('order_details_unavailable')}</p><button type="button" class="btn btn-sm btn-outline-orange" data-order-detail-retry="${escapeHtml(order.id)}" aria-label="${escapeHtml(orderCopy(`Retry details for order ${order.orderNumber}`, `Réessayer les détails de la commande ${order.orderNumber}`))}">${orderCopy('Retry details', 'Réessayer les détails')}</button></div>
  </article>`;
}

function syncLoadedOrders() {
  loadedOrders = loadedOrderEntries.filter(entry => entry.order).map(entry => entry.order);
}

function findOrderCard(box, orderId) {
  return [...(box?.querySelectorAll('[data-order-id]') || [])].find(card => card.dataset.orderId === orderId) || null;
}

function captureOrderViewState(box) {
  const state = { expanded: new Set(), drafts: new Map(), focus: null };
  if (!box) return state;
  box.querySelectorAll('[data-order-id]').forEach(card => {
    const orderId = card.dataset.orderId;
    card.querySelectorAll(':scope > details').forEach(details => {
      if (details.open) state.expanded.add(`${orderId}:${details.classList.contains('return-request') ? 'return' : 'details'}`);
    });
    const form = card.querySelector('[data-return-form]');
    if (form) {
      state.drafts.set(orderId, {
        reason: form.elements.namedItem('reason')?.value || 'damaged',
        details: form.elements.namedItem('details')?.value || '',
        quantities: new Map([...form.querySelectorAll('[data-return-item]')].map(input => [input.dataset.returnItem, input.value]))
      });
    }
  });

  const active = document.activeElement;
  const activeCard = active?.closest?.('[data-order-id]');
  if (!activeCard || !box.contains(active)) return state;
  const orderId = activeCard.dataset.orderId;
  if (active.matches('summary')) {
    state.focus = { orderId, type: active.closest('.return-request') ? 'return-summary' : 'details-summary' };
  } else if (active.matches('[data-return-item]')) {
    state.focus = { orderId, type: 'return-item', itemId: active.dataset.returnItem };
  } else if (active.matches('[name="reason"], [name="details"]')) {
    state.focus = { orderId, type: `return-${active.name}` };
  } else if (active.matches('[data-reorder]')) state.focus = { orderId, type: 'reorder' };
  else if (active.matches('[data-cancel]')) state.focus = { orderId, type: 'cancel' };
  else if (active.matches('[data-order-detail-retry]')) state.focus = { orderId, type: 'detail-retry' };
  return state;
}

function restoreOrderViewState(box, state, restoreFocus = true) {
  if (!state) return;
  loadedOrderEntries.forEach(entry => {
    const orderId = entry.summary.id;
    const card = findOrderCard(box, orderId);
    if (!card) return;
    const detailPanel = card.querySelector(':scope > .order-details:not(.return-request)');
    const returnRequest = card.querySelector(':scope > .return-request');
    if (detailPanel) detailPanel.open = state.expanded.has(`${orderId}:details`);
    if (returnRequest?.tagName === 'DETAILS') returnRequest.open = state.expanded.has(`${orderId}:return`);
    const draft = state.drafts.get(orderId);
    const form = card.querySelector('[data-return-form]');
    if (draft && form) {
      const reason = form.elements.namedItem('reason');
      const details = form.elements.namedItem('details');
      if (reason) reason.value = draft.reason;
      if (details) details.value = draft.details;
      form.querySelectorAll('[data-return-item]').forEach(input => {
        if (draft.quantities.has(input.dataset.returnItem)) input.value = draft.quantities.get(input.dataset.returnItem);
      });
    }
  });

  if (!restoreFocus || !state.focus) return;
  const card = findOrderCard(box, state.focus.orderId);
  if (!card) return;
  const selectors = {
    'details-summary': ':scope > .order-details:not(.return-request) > summary',
    'return-summary': ':scope > .return-request > summary',
    'return-reason': '[data-return-form] [name="reason"]',
    'return-details': '[data-return-form] [name="details"]',
    reorder: '[data-reorder]',
    cancel: '[data-cancel]',
    'detail-retry': '[data-order-detail-retry]'
  };
  const target = state.focus.type === 'return-item'
    ? [...card.querySelectorAll('[data-return-item]')].find(input => input.dataset.returnItem === state.focus.itemId)
    : card.querySelector(selectors[state.focus.type] || '');
  requestAnimationFrame(() => target?.focus({ preventScroll: true }));
}

function focusOrderCard(box, orderId, openDetails = false) {
  const target = findOrderCard(box, orderId);
  if (!target) return;
  target.classList.add('order-card-highlight');
  const details = target.querySelector(':scope > .order-details:not(.return-request)');
  const summary = details?.querySelector(':scope > summary');
  if (openDetails && details) details.open = true;
  const focusTarget = openDetails && summary ? summary : target;
  if (focusTarget === target) target.setAttribute('tabindex', '-1');
  requestAnimationFrame(() => {
    focusTarget.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: motionBehavior(), block: 'center' });
  });
}

function bindOrderActions(box) {
  box.querySelectorAll('[data-reorder]').forEach(button => button.addEventListener('click', () => reorder(button.dataset.reorder, button)));
  box.querySelectorAll('[data-reorder-recovery-clear]').forEach(button => button.addEventListener('click', () => discardBlockedReorderRecovery(button.dataset.reorderRecoveryClear, button)));
  box.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => cancelOrder(button.dataset.cancel, button)));
  box.querySelectorAll('[data-return-form]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    const order = loadedOrders.find(item => item.id === form.dataset.returnForm);
    if (order) submitReturn(order, form);
  }));
  box.querySelectorAll('[data-order-detail-retry]').forEach(button => button.addEventListener('click', () => retryOrderDetail(button.dataset.orderDetailRetry, button)));
  box.querySelector('[data-orders-more]')?.addEventListener('click', event => loadOlderOrders(event.currentTarget));
  box.querySelector('[data-orders-more-retry]')?.addEventListener('click', event => loadOlderOrders(event.currentTarget));
}

function renderCurrentOrders(options = {}) {
  const box = $('ordersList');
  if (!box) return;
  if (!getUser()) {
    const returnTarget = `orders.html${location.search || ''}`;
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-lock fa-3x text-muted mb-3" aria-hidden="true"></i><h2 class="h5">${orderCopy('Sign in to view your orders', 'Connectez-vous pour voir vos commandes')}</h2><p class="text-muted">${orderCopy('An account keeps your private order history available across devices. Shopping and guest checkout remain available without signing in.', 'Un compte conserve votre historique privé sur tous vos appareils. Les achats et la commande invité restent disponibles sans connexion.')}</p><div class="d-flex flex-wrap justify-content-center gap-2"><a class="btn btn-orange" href="login.html?next=${encodeURIComponent(returnTarget)}">${orderCopy('Sign in', 'Se connecter')}</a><a class="btn btn-outline-orange" href="categories.html">${orderCopy('Continue shopping', 'Continuer vos achats')}</a></div></div>`;
    return;
  }
  const query = new URLSearchParams(location.search);
  const placedId = query.get('placed');
  const deepLinkedId = query.get('order');
  if (!loadedOrderEntries.length) {
    const missingLinkedOrder = deepLinkedId
      ? `<div class="alert alert-warning" role="status"><i class="fa-solid fa-triangle-exclamation me-2" aria-hidden="true"></i>${orderCopy('The linked order could not be found in your order history.', 'La commande liée est introuvable dans votre historique.')}</div>`
      : '';
    box.innerHTML = missingLinkedOrder + `<div class="text-center py-5"><i class="fa-solid fa-box-open fa-3x text-muted mb-3" aria-hidden="true"></i><h2 class="h5">${t('no_orders')}</h2><a class="btn btn-orange mt-2 state-action" href="categories.html">${t('start_shopping')}</a></div>`;
    return;
  }

  const hasOrder = orderId => loadedOrderEntries.some(entry => entry.summary.id === orderId);
  const confirmation = placedId && hasOrder(placedId)
    ? `<div class="order-confirmation" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><div><strong>${orderCopy('Order confirmed', 'Commande confirmée')}</strong><span>${orderCopy('Your order was priced and created securely by the server.', 'Votre commande a été calculée et créée de manière sécurisée par le serveur.')}</span></div></div>`
    : '';
  const linkedOrderNotice = deepLinkedId && !hasOrder(deepLinkedId)
    ? (nextOrdersCursor
      ? `<div class="alert alert-info" role="status"><i class="fa-solid fa-circle-info me-2" aria-hidden="true"></i>${orderCopy('The linked order is older than the orders shown. Load older orders to find it.', 'La commande liée est plus ancienne que les commandes affichées. Chargez les commandes précédentes pour la trouver.')}</div>`
      : `<div class="alert alert-warning" role="status"><i class="fa-solid fa-triangle-exclamation me-2" aria-hidden="true"></i>${orderCopy('The linked order could not be found in your order history.', 'La commande liée est introuvable dans votre historique.')}</div>`)
    : '';
  const historyControls = ordersLoadMoreError ? '' : (nextOrdersCursor
    ? `<div class="text-center py-3" data-orders-history><p class="small text-muted mb-2">${escapeHtml(orderCopy(`Showing the ${loadedOrderEntries.length} newest orders.`, `Affichage des ${loadedOrderEntries.length} commandes les plus récentes.`))}</p><button type="button" class="btn btn-outline-orange" data-orders-more>${orderCopy('Load older orders', 'Charger les commandes précédentes')}</button></div>`
    : (loadedOrderEntries.length >= ORDERS_PAGE_SIZE
      ? `<p class="small text-muted text-center py-3 mb-0" role="status">${escapeHtml(orderCopy(`All ${loadedOrderEntries.length} loaded orders are shown.`, `Les ${loadedOrderEntries.length} commandes chargées sont toutes affichées.`))}</p>`
      : ''));
  const loadMoreError = ordersLoadMoreError
    ? `<div class="alert alert-danger text-center mt-3" role="alert"><p class="mb-2">${orderCopy('Older orders could not be loaded. Your current order history is still available.', 'Impossible de charger les commandes précédentes. Votre historique actuel reste disponible.')}</p><button type="button" class="btn btn-sm btn-outline-danger" data-orders-more-retry>${orderCopy('Try loading again', 'Réessayer le chargement')}</button></div>`
    : '';

  box.innerHTML = confirmation + linkedOrderNotice + loadedOrderEntries.map(entry => entry.order ? orderCard(entry.order) : failedOrderCard(entry)).join('') + loadMoreError + historyControls;
  bindOrderActions(box);
  restoreOrderViewState(box, options.viewState, !options.focusOrderId);
  const focusedId = options.focusOrderId || (options.initialFocus ? (deepLinkedId || placedId) : null);
  if (focusedId) focusOrderCard(box, focusedId, Boolean(deepLinkedId && focusedId === deepLinkedId));
}

async function fetchOrderPage(before = null) {
  const result = await StoreAPI.orders.list({ limit: ORDERS_PAGE_SIZE, ...(before ? { before } : {}) });
  const summaries = result.orders || [];
  const details = await Promise.allSettled(summaries.map(summary => StoreAPI.orders.get(summary.id)));
  const unauthorizedDetail = details.find(detail => detail.status === 'rejected' && isOrdersUnauthorized(detail.reason));
  if (unauthorizedDetail) throw unauthorizedDetail.reason;
  details.forEach((detail, index) => {
    if (detail.status === 'rejected') console.error(`[AM MARKET orders] Details failed for ${summaries[index].id}`, detail.reason);
  });
  return {
    entries: summaries.map((summary, index) => details[index].status === 'fulfilled'
      ? { summary, order: details[index].value.order, error: null }
      : { summary, order: null, error: details[index].reason }),
    nextCursor: result.nextCursor || null
  };
}

async function retryOrderDetail(orderId, button) {
  const entry = loadedOrderEntries.find(item => item.summary.id === orderId);
  if (!entry) return;
  const box = $('ordersList');
  const privacyEpoch = ordersPrivacyEpoch;
  const viewState = captureOrderViewState(box);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const payload = await StoreAPI.orders.get(orderId);
    if (ordersSessionChanged(privacyEpoch)) return;
    entry.order = payload.order;
    entry.summary = { ...entry.summary, ...payload.order };
    entry.error = null;
    syncLoadedOrders();
    renderCurrentOrders({ viewState, focusOrderId: orderId });
  } catch (error) {
    if (handleOrdersUnauthorized(error)) return;
    entry.error = error;
    toast(orderErrorMessage(error, t('order_details_unavailable')));
    renderCurrentOrders({ viewState });
    requestAnimationFrame(() => findOrderCard(box, orderId)?.querySelector('[data-order-detail-retry]')?.focus({ preventScroll: true }));
  }
}

async function loadOlderOrders(button) {
  if (!nextOrdersCursor || ordersRequestPending) return;
  const box = $('ordersList');
  const viewState = captureOrderViewState(box);
  const privacyEpoch = ordersPrivacyEpoch;
  const cursor = nextOrdersCursor;
  ordersRequestPending = true;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const page = await fetchOrderPage(cursor);
    if (ordersSessionChanged(privacyEpoch)) return;
    const knownIds = new Set(loadedOrderEntries.map(entry => entry.summary.id));
    loadedOrderEntries.push(...page.entries.filter(entry => !knownIds.has(entry.summary.id)));
    nextOrdersCursor = page.nextCursor && page.nextCursor !== cursor ? page.nextCursor : null;
    ordersLoadMoreError = '';
    syncLoadedOrders();
    const deepLinkedId = new URLSearchParams(location.search).get('order');
    renderCurrentOrders({
      viewState,
      focusOrderId: deepLinkedId && page.entries.some(entry => entry.summary.id === deepLinkedId) ? deepLinkedId : null
    });
  } catch (error) {
    if (handleOrdersUnauthorized(error)) return;
    orderErrorMessage(error);
    ordersLoadMoreError = 'failed';
    renderCurrentOrders({ viewState });
    requestAnimationFrame(() => box.querySelector('[data-orders-more-retry]')?.focus({ preventScroll: true }));
  } finally {
    ordersRequestPending = false;
  }
}

async function renderOrders(options = {}) {
  const box = $('ordersList');
  if (!box) return;
  if (!getUser()) {
    clearPrivateOrderState();
    renderCurrentOrders();
    return;
  }
  if (ordersRequestPending) return;
  const privacyEpoch = ordersPrivacyEpoch;
  ordersRequestPending = true;
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = `<div class="text-center py-5" role="status"><i class="fa-solid fa-spinner fa-spin fa-2x text-muted mb-3" aria-hidden="true"></i><p class="mb-0" data-orders-loading>${orderCopy('Loading your orders…', 'Chargement de vos commandes…')}</p></div>`;
  try {
    const page = await fetchOrderPage();
    if (ordersSessionChanged(privacyEpoch)) return;
    loadedOrderEntries = page.entries;
    nextOrdersCursor = page.nextCursor;
    ordersLoadMoreError = '';
    ordersInitialLoadComplete = true;
    syncLoadedOrders();
    renderCurrentOrders({ ...options, initialFocus: true });
  } catch (error) {
    if (handleOrdersUnauthorized(error)) return;
    ordersInitialLoadComplete = false;
    const safeMessage = orderErrorMessage(error, orderCopy('Your orders could not be loaded. Check your connection and try again.', 'Impossible de charger vos commandes. Vérifiez votre connexion et réessayez.'));
    box.innerHTML = `<div class="alert alert-danger text-center" role="alert"><p class="mb-3">${escapeHtml(safeMessage)}</p><button type="button" class="btn btn-outline-danger" data-orders-retry>${orderCopy('Try again', 'Réessayer')}</button></div>`;
    box.querySelector('[data-orders-retry]')?.addEventListener('click', () => renderOrders(options));
  } finally {
    ordersRequestPending = false;
    box.removeAttribute('aria-busy');
  }
}

function rerenderOrdersForLanguage() {
  const box = $('ordersList');
  if (!box) return;
  if (ordersRequestPending) {
    const loading = box.querySelector('[data-orders-loading]');
    if (loading) loading.textContent = orderCopy('Loading your orders…', 'Chargement de vos commandes…');
    return;
  }
  if (getUser() && ordersInitialLoadComplete) {
    renderCurrentOrders({ viewState: captureOrderViewState(box) });
    return;
  }
  renderOrders();
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(() => {
  hydrateReorderAttempts();
  return renderOrders();
}));
window.addEventListener('am:langchange', rerenderOrdersForLanguage);
window.addEventListener('am:session-expired', event => handleOrdersUnauthorized(event.detail?.error || null, false));
window.addEventListener('storage', event => {
  if (event.key === reorderAttemptStorageKey()) hydrateReorderAttempts();
});
