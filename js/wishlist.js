/**
 * AM MARKET — wishlist.js (wishlist.html)
 * Wishlist grid, read from localStorage; product data fetched per id.
 */

let wishlistRenderSequence = 0;

async function renderWishlist(focusContext = null) {
  const renderSequence = ++wishlistRenderSequence;
  $('wishLabel').textContent = `(${wishlist.length})`;
  const box = $('wishItems');

  if (wishlist.length === 0) {
    box.innerHTML = `<div class="col-12 text-center py-5"><i class="fa-regular fa-heart fa-3x text-muted mb-3"></i><h2 class="h5">${t('wish_empty')}</h2><a class="btn btn-orange mt-2 state-action" href="categories.html">${t('browse_products')}</a></div>`;
    if (focusContext?.restoreFocus) requestAnimationFrame(() => $('wishlistHeading')?.focus({ preventScroll: true }));
    return;
  }

  const requestedIds = [...wishlist];
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = skeletonCards(Math.min(8, requestedIds.length));
  const results = await Promise.allSettled(requestedIds.map(async id => productCache[id] || fetchProduct(id)));
  if (renderSequence !== wishlistRenderSequence) return;
  const items = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failedIds = results.flatMap((r, index) => r.status === 'rejected' ? [requestedIds[index]] : []);
  const failedState = failedIds.length ? `<div class="col-12"><div class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2" role="status"><span>${t('wishlist_load_failed', { n: failedIds.length })}</span><span class="d-flex flex-wrap gap-2"><button class="btn btn-sm btn-outline-dark state-action" id="retryWishlist">${t('retry')}</button><button class="btn btn-sm btn-outline-danger state-action" id="removeFailedWishlist">${t('remove_failed_saved')}</button></span></div></div>` : '';
  box.innerHTML = items.map(cardHTML).join('') + failedState;
  box.removeAttribute('aria-busy');
  bindCards(box, renderWishlist);
  if (focusContext?.restoreFocus) {
    requestAnimationFrame(() => {
      const nextControl = box.querySelector('[data-wish], .product-title, a[href], button');
      (nextControl || $('wishlistHeading'))?.focus({ preventScroll: true });
    });
  }
  $('retryWishlist')?.addEventListener('click', renderWishlist);
  $('removeFailedWishlist')?.addEventListener('click', () => {
    const failedSet = new Set(failedIds.map(String));
    const removedIds = wishlist.filter(id => failedSet.has(String(id)));
    wishlist = wishlist.filter(id => !failedSet.has(String(id)));
    saveWish();
    renderWishlist({ restoreFocus: true });
    toast(t('removed_wish'), t('undo'), () => {
      wishlist = [...new Set([...wishlist, ...removedIds])];
      saveWish();
      renderWishlist({ restoreFocus: true });
      toast(t('added_wish'));
    });
  });
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(renderWishlist));

window.addEventListener('am:langchange', renderWishlist);
