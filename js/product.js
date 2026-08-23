/**
 * AM MARKET — product.js (product.html)
 * Product detail page. Reads the product id from the URL:
 *   product.html?id=123
 */

const productId = new URLSearchParams(location.search).get('id');
if (!productId) location.replace('index.html');
let productQuantity = 1;

function extractPackSize(product) {
  const explicit = product.package_size || product.pack_size || product.size || product.weight || product.volume;
  if (explicit) return String(explicit);
  const match = String(product.name || '').match(/\b\d+(?:[.,]\d+)?\s?(?:kg|g|mg|l|cl|ml)\b/i);
  return match ? match[0] : '';
}

function productSpecsHTML(product) {
  const specs = [
    [t('spec_brand'), product.brand_name],
    [t('spec_category'), product.category_name ? catName(product.category_name) : ''],
    [t('spec_pack'), extractPackSize(product)],
    [t('spec_reference'), product.sku || product.barcode || product.ean]
  ].filter(([, value]) => value != null && String(value).trim());
  if (!specs.length) return '';
  return `<div class="detail-specs" aria-label="${escapeHtml(t('product_details'))}">
    <h2>${t('product_details')}</h2>
    <dl>${specs.map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}
    </dl>
  </div>`;
}

let stickyAtcObserver = null;

async function renderDetail(id) {
  const box = $('detailContent');
  const relatedBox = $('relatedSection');
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = `<div class="col-lg-5" aria-hidden="true"><div class="detail-img skeleton-block"></div></div>
    <div class="col-lg-7" aria-hidden="true"><div class="detail-panel">
      <div class="skeleton-block skeleton-line short"></div>
      <div class="skeleton-block skeleton-line title" style="height:24px;margin-top:14px"></div>
      <div class="skeleton-block skeleton-line price" style="height:30px"></div>
      <div class="skeleton-block skeleton-line" style="width:100%;margin-top:22px"></div>
      <div class="skeleton-block skeleton-line" style="width:72%"></div>
    </div></div>`;
  if (relatedBox) relatedBox.style.display = 'none';

  try {
    const p = await fetchProduct(id);
    addRecent(p);
    $('detailCrumb').textContent = p.name;
    document.title = 'AM MARKET — ' + p.name;
    const inWish = wishlist.includes(String(p.id));
    const available = p.is_available !== false;

    const hasOld = parseFloat(p.original_price) > parseFloat(p.price);
    const disc = parseInt(p.discount_percent) || 0;

    box.innerHTML = `
      <div class="col-lg-5">
        <div class="detail-img">
          <img src="${p.image_url || ''}" alt="${escapeHtml(p.name)}"
               onerror="this.onerror=null;this.src='img/placeholder.svg'">
        </div>
      </div>
      <div class="col-lg-7">
        <div class="detail-panel">
          ${p.brand_name ? `<div class="detail-brand">${escapeHtml(p.brand_name)}</div>` : ''}
          <h1 class="detail-title">${escapeHtml(p.name)}</h1>

          <div class="detail-meta">
            ${p.category_name ? `<span class="detail-chip">${escapeHtml(catName(p.category_name))}</span>` : ''}
            <span class="detail-chip ${available ? 'in-stock' : 'out-stock'}">${available ? t('in_stock') : t('out_stock')}</span>
          </div>

          <div class="detail-price-row">
            <span class="detail-price">${formatPrice(p.price)}</span>
            ${hasOld ? `<span class="detail-old">${formatPrice(p.original_price)}</span>` : ''}
            ${disc > 0 ? `<span class="detail-disc">-${disc}%</span>` : ''}
          </div>

          <p class="detail-desc ${p.description ? '' : 'detail-desc-empty'}">${escapeHtml(p.description) || t('no_desc')}</p>

          ${productSpecsHTML(p)}

          <div class="detail-qty">
            <span class="detail-qty-label">${t('quantity')}</span>
            <div class="qty-box detail-qty-box">
              <button type="button" id="dMinus" aria-label="${escapeHtml(t('decrease_named', { name: p.name }))}">−</button>
              <input type="number" id="dQty" value="${productQuantity}" min="1" max="99" inputmode="numeric" aria-label="${escapeHtml(t('quantity_named', { name: p.name }))}">
              <button type="button" id="dPlus" aria-label="${escapeHtml(t('increase_named', { name: p.name }))}">+</button>
            </div>
          </div>

          <div class="detail-actions">
            <button class="detail-btn-primary" id="dAdd" ${!available ? 'disabled' : ''}>
              <i class="fa-solid fa-cart-shopping"></i> ${t('add_to_cart')}
            </button>
            <button class="detail-btn-secondary" id="dBuy" ${!available ? 'disabled' : ''}>${t('buy_now')}</button>
            <button class="detail-wish ${inWish ? 'active' : ''}" id="dWish" type="button" aria-pressed="${inWish}">
              <i class="fa-${inWish ? 'solid' : 'regular'} fa-heart"></i>
              <span>${inWish ? t('remove_wish') : t('add_wish')}</span>
            </button>
          </div>

          <div class="detail-trust">
            <div class="detail-trust-item"><i class="fa-solid fa-truck-fast"></i><span>${t('free_del_over')}</span></div>
            <div class="detail-trust-item"><i class="fa-solid fa-rotate-left"></i><span>${t('easy_returns')}</span></div>
            <div class="detail-trust-item"><i class="fa-solid fa-shield-halved"></i><span>${t('secure_payment')}</span></div>
          </div>
        </div>
      </div>`;

    const qty = $('dQty');
    const normalizeQty = () => {
      const value = Math.floor(Number(qty.value) || 1);
      productQuantity = Math.max(1, Math.min(99, value));
      qty.value = productQuantity;
      return +qty.value;
    };
    qty.addEventListener('input', () => {
      const value = Math.floor(Number(qty.value));
      if (Number.isFinite(value) && value >= 1 && value <= 99) productQuantity = value;
    });
    qty.addEventListener('change', normalizeQty);
    qty.addEventListener('blur', normalizeQty);
    $('dMinus').onclick = () => { qty.value = Math.max(1, normalizeQty() - 1); };
    $('dPlus').onclick = () => { qty.value = Math.min(99, normalizeQty() + 1); };
    const doAdd = () => addToCart(p.id, normalizeQty(), p);
    $('dAdd').onclick = doAdd;
    $('dBuy').onclick = () => { doAdd(); location.href = 'checkout.html'; };
    $('dWish').onclick = async () => {
      const id = String(p.id);
      const wasSaved = wishlist.includes(id);
      toggleWish(id);
      await renderDetail(id);
      $('dWish')?.focus({ preventScroll: true });
      if (wasSaved) {
        toast(t('removed_wish'), t('undo'), async () => {
          if (!wishlist.includes(id)) wishlist.push(id);
          saveWish();
          await renderDetail(id);
          $('dWish')?.focus({ preventScroll: true });
          toast(t('added_wish'));
        });
      }
    };

    // Sticky mobile add-to-cart bar
    let bar = document.getElementById('stickyAtc');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'stickyAtc';
      bar.className = 'sticky-atc';
      bar.innerHTML = `
        <div class="sticky-atc-inner">
          <span class="sticky-atc-price" id="stickyPrice"></span>
          <button type="button" class="sticky-atc-btn" id="stickyAdd">
            <i class="fa-solid fa-cart-shopping"></i>
            <span data-i18n="add_to_cart">${t('add_to_cart')}</span>
          </button>
        </div>`;
      document.body.appendChild(bar);
    }
    $('stickyPrice').textContent = formatPrice(p.price);
    const stickyBtn = $('stickyAdd');
    stickyBtn.disabled = !available;
    stickyBtn.onclick = doAdd;
    stickyAtcObserver?.disconnect();
    bar.classList.remove('is-visible');
    stickyAtcObserver = new IntersectionObserver(([entry]) => {
      const primaryActionHasPassed = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      bar.classList.toggle('is-visible', primaryActionHasPassed);
    }, { threshold: 0.1 });
    stickyAtcObserver.observe($('dAdd'));

    loadRelated(p);
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center py-5">
      <p class="text-danger mb-3">${t('product_not_found')}</p>
      <div class="d-flex justify-content-center gap-2">
        <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryProduct">${t('retry')}</button>
        <a class="btn btn-orange btn-sm" href="categories.html">${t('browse_products')}</a>
      </div>
    </div>`;
    $('retryProduct')?.addEventListener('click', () => renderDetail(id));
  } finally {
    box.removeAttribute('aria-busy');
  }
}

// Related products stay within the same category. Fewer relevant items are
// better than padding the section with unrelated catalogue products.
async function loadRelated(product) {
  const section = $('relatedSection');
  const box = $('relatedProducts');
  if (!section || !box) return;

  try {
    const categoryId = typeof product.category === 'object'
      ? product.category.id
      : (product.category || product.category_id);
    if (!categoryId) { section.style.display = 'none'; return; }
    const data = await fetchProducts(1, categoryId, '');
    let list = (data.results || []).filter(p => String(p.id) !== String(product.id));
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
