/**
 * AM MARKET — wishlist.js (wishlist.html)
 * Wishlist grid, read from localStorage; product data fetched per id.
 */

async function renderWishlist() {
  $('wishLabel').textContent = `(${wishlist.length})`;
  const box = $('wishItems');

  if (wishlist.length === 0) {
    box.innerHTML = `<div class="col-12 text-center py-5"><i class="fa-regular fa-heart fa-3x text-muted mb-3"></i><h5>${t('wish_empty')}</h5><a class="btn btn-orange mt-2" href="categories.html">${t('browse_products')}</a></div>`;
    return;
  }

  box.innerHTML = `<div class="col-12 text-center py-4 text-muted">${t('loading')}</div>`;
  const items = [];
  for (const id of wishlist) {
    let p = productCache[id];
    if (!p) { try { p = await fetchProduct(id); } catch { continue; } }
    items.push(p);
  }
  box.innerHTML = items.map(cardHTML).join('') || `<div class="col-12 text-center py-4 text-muted">${t('no_items')}</div>`;
  bindCards(box, renderWishlist);
}

document.addEventListener('DOMContentLoaded', renderWishlist);

window.addEventListener('am:langchange', renderWishlist);
