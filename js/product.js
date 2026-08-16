/**
 * AM MARKET — product.js (product.html)
 * Product detail page. Reads the product id from the URL:
 *   product.html?id=123
 */

const productId = new URLSearchParams(location.search).get('id');
if (!productId) location.replace('index.html');

async function renderDetail(id) {
  const box = $('detailContent');
  const relatedBox = $('relatedSection');
  box.innerHTML = `<div class="col-12 text-center py-5 text-muted">${t('loading')}</div>`;
  if (relatedBox) relatedBox.style.display = 'none';

  try {
    const p = await fetchProduct(id);
    addRecent(p);
    $('detailCrumb').textContent = p.name;
    document.title = 'AM MARKET — ' + p.name;
    const inWish = wishlist.includes(String(p.id));
    const available = p.is_available !== false;

    box.innerHTML = `
      <div class="col-md-5">
        <div class="detail-img">
          <img src="${p.image_url || ''}" alt="${escapeHtml(p.name)}"
               onerror="this.onerror=null;this.src='img/placeholder.svg'">
        </div>
      </div>
      <div class="col-md-7">
        <div class="bg-white p-4 p-lg-4 rounded-3 shadow-sm h-100">
          ${p.brand_name ? `<div class="text-orange fw-semibold small mb-1">${escapeHtml(p.brand_name)}</div>` : ''}
          <h3 class="fw-bold mb-2">${escapeHtml(p.name)}</h3>

          <div class="d-flex flex-wrap gap-2 mb-3">
            ${p.category_name ? `<span class="badge bg-body-tertiary border">${escapeHtml(catName(p.category_name))}</span>` : ''}
            ${p.weight_volume ? `<span class="badge bg-body-tertiary border">${escapeHtml(p.weight_volume)}</span>` : ''}
            <span class="badge ${available ? 'bg-success' : 'bg-secondary'}">${available ? t('in_stock') : t('out_stock')}</span>
          </div>

          <div class="d-flex align-items-baseline gap-2 mb-3 flex-wrap">
            <span class="fs-2 fw-bold text-orange">${formatPrice(p.price)}</span>
            ${(parseFloat(p.original_price) > parseFloat(p.price)) ? `<span class="fs-5 text-muted text-decoration-line-through">${formatPrice(p.original_price)}</span>` : ''}
            ${(parseInt(p.discount_percent) > 0) ? `<span class="badge bg-danger fs-6">${t('off_badge', { n: p.discount_percent })}</span>` : ''}
          </div>

          <p class="text-muted mb-4">${escapeHtml(p.description) || t('no_desc')}</p>

          <div class="d-flex align-items-center gap-3 mb-4">
            <span class="fw-semibold">${t('quantity')}</span>
            <div class="qty-box">
              <button type="button" id="dMinus" aria-label="-">−</button>
              <input type="number" id="dQty" value="1" min="1" aria-label="Quantity">
              <button type="button" id="dPlus" aria-label="+">+</button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-orange btn-lg px-4" id="dAdd" ${!available ? 'disabled' : ''}>
              <i class="fa-solid fa-cart-shopping me-2"></i> ${t('add_to_cart')}
            </button>
            <button class="btn btn-outline-orange btn-lg" id="dBuy" ${!available ? 'disabled' : ''}>${t('buy_now')}</button>
          </div>

          <button class="btn btn-link text-decoration-none p-0 ${inWish ? 'text-danger' : 'text-muted'}" id="dWish">
            <i class="fa-${inWish ? 'solid' : 'regular'} fa-heart me-1"></i>
            ${inWish ? t('remove_wish') : t('add_wish')}
          </button>

          <hr class="my-4">
          <div class="row g-2 small text-muted">
            <div class="col-sm-4"><i class="fa-solid fa-truck text-orange me-1"></i> ${t('free_del_over')}</div>
            <div class="col-sm-4"><i class="fa-solid fa-rotate-left text-orange me-1"></i> ${t('easy_returns')}</div>
            <div class="col-sm-4"><i class="fa-solid fa-shield-halved text-orange me-1"></i> ${t('secure_payment')}</div>
          </div>
        </div>
      </div>`;

    const qty = $('dQty');
    $('dMinus').onclick = () => { qty.value = Math.max(1, +qty.value - 1); };
    $('dPlus').onclick = () => { qty.value = +qty.value + 1; };
    $('dAdd').onclick = () => addToCart(p.id, +qty.value || 1, p);
    $('dBuy').onclick = () => { addToCart(p.id, +qty.value || 1, p); location.href = 'checkout.html'; };
    $('dWish').onclick = () => { toggleWish(p.id); renderDetail(p.id); };

    loadRelated(p);
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center text-danger py-5">${t('product_not_found')}</div>`;
  }
}

// Related products: same category from the API, padded with generic picks
async function loadRelated(product) {
  const section = $('relatedSection');
  const box = $('relatedProducts');
  if (!section || !box) return;

  try {
    let list = [];
    if (product.category) {
      const data = await fetchProducts(1, product.category, '');
      list = (data.results || []).filter(p => String(p.id) !== String(product.id));
    }
    if (list.length < 4) {
      const data = await fetchProducts(1);
      const extra = (data.results || []).filter(p =>
        String(p.id) !== String(product.id) && !list.find(x => String(x.id) === String(p.id)));
      list = list.concat(extra);
    }
    list = list.slice(0, 4);

    if (list.length === 0) {
      section.style.display = 'none';
      return;
    }

    box.innerHTML = list.map(cardHTML).join('');
    bindCards(box);
    section.style.display = 'block';
  } catch {
    section.style.display = 'none';
  }
}

if (productId) document.addEventListener('DOMContentLoaded', () => renderDetail(productId));

window.addEventListener('am:langchange', () => {
  if (productId) renderDetail(productId);
});
