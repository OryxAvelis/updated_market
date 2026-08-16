/**
 * AM MARKET — categories.js (categories.html)
 * Catalog with filters, sorting and pagination. Page state lives in the URL:
 *   categories.html?cat=<id>&q=<search>&page=<n>
 * Links (pagination, suggestions, empty states) are standard <a href>s;
 * clicks are intercepted for fetch-based updates so browsing stays smooth.
 */

const params = new URLSearchParams(location.search);
let currentCat = params.get('cat') ? +params.get('cat') : null;
let searchQ = (params.get('q') || '').trim();
let currentPage = Math.max(1, +params.get('page') || 1);

let totalPages = 1;
let totalCount = 0;
let pageProducts = [];   // current page products from API
let sortBy = 'default';
let maxPrice = 1000;
let onlyAvailable = true;
let onlyPromo = false;
let selectedBrand = null;

// ---------- URL helpers ----------
function shopURL({ page = currentPage, cat = currentCat, q = searchQ } = {}) {
  const sp = new URLSearchParams();
  if (cat) sp.set('cat', cat);
  if (q) sp.set('q', q);
  if (page > 1) sp.set('page', page);
  const s = sp.toString();
  return 'categories.html' + (s ? '?' + s : '');
}
function syncURL() { history.replaceState(null, '', shopURL()); }

// ---------- Client-side filters ----------
function applyClientFilters(list) {
  let result = [...list];

  result = result.filter(p => parseFloat(p.price) <= maxPrice);

  if (onlyAvailable) {
    result = result.filter(p => p.is_available !== false);
  }

  if (onlyPromo) {
    result = result.filter(p => p.is_promo || (parseInt(p.discount_percent) > 0));
  }

  if (selectedBrand) {
    result = result.filter(p => p.brand_name === selectedBrand);
  }

  if (sortBy === 'price-asc') result.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  else if (sortBy === 'price-desc') result.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  else if (sortBy === 'name') result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return result;
}

// ---------- Filter panel ----------
function renderFilterPanel(list) {
  const catBox = $('filterCategories');
  if (catBox) {
    catBox.innerHTML = `
      <div class="form-check">
        <input class="form-check-input filter-cat" type="radio" name="fcat" id="fcat-all" value="" ${!currentCat ? 'checked' : ''}>
        <label class="form-check-label small" for="fcat-all">${t('all_categories')}</label>
      </div>
      ${categories.map(c => `
        <div class="form-check">
          <input class="form-check-input filter-cat" type="radio" name="fcat" id="fcat-${c.id}" value="${c.id}" ${currentCat === c.id ? 'checked' : ''}>
          <label class="form-check-label small" for="fcat-${c.id}">${escapeHtml(catName(c.name))}</label>
        </div>
      `).join('')}`;

    catBox.querySelectorAll('.filter-cat').forEach(r => {
      r.onchange = () => {
        currentCat = r.value ? +r.value : null;
        currentPage = 1;
        selectedBrand = null;
        syncURL();
        renderSidebar(currentCat);
        updateShopTitle();
        loadShopPage(1);
      };
    });
  }

  const brandBox = $('filterBrands');
  if (brandBox) {
    const brands = [...new Set(list.map(p => p.brand_name).filter(Boolean))].sort();
    brandBox.innerHTML = brands.length === 0
      ? `<span class="small text-muted">${t('no_brands')}</span>`
      : `<div class="form-check">
          <input class="form-check-input filter-brand" type="radio" name="fbrand" id="fb-all" value="" ${!selectedBrand ? 'checked' : ''}>
          <label class="form-check-label small" for="fb-all">${t('all_brands')}</label>
        </div>` + brands.slice(0, 12).map(b => `
        <div class="form-check">
          <input class="form-check-input filter-brand" type="radio" name="fbrand" id="fb-${b.replace(/\s/g,'')}" value="${escapeHtml(b)}" ${selectedBrand === b ? 'checked' : ''}>
          <label class="form-check-label small" for="fb-${b.replace(/\s/g,'')}">${escapeHtml(b)}</label>
        </div>
      `).join('');

    brandBox.querySelectorAll('.filter-brand').forEach(r => {
      r.onchange = () => {
        selectedBrand = r.value || null;
        renderPageProducts();
      };
    });
  }
}

// ---------- Product grid ----------
function renderPageProducts(suggestion = null) {
  const box = $('shopProducts');
  const list = applyClientFilters(pageProducts);
  const countEl = $('resultCount');
  if (countEl) {
    countEl.textContent = totalCount
      ? t('shown_total', { n: Math.min(list.length, 12), total: totalCount })
      : t('n_products', { n: list.length });
  }

  if (list.length === 0) {
    box.innerHTML = `
      <div class="col-12">
        <div class="empty-search text-center py-5">
          <div class="empty-icon mb-3">🔍</div>
          <h5 class="fw-bold">${t('no_products')}</h5>
          <p class="text-muted mb-3">${t('no_products_sub', { q: escapeHtml(searchQ || '…') })}</p>
          <div class="d-flex flex-wrap justify-content-center gap-2">
            <button class="btn btn-outline-orange btn-sm" id="emptyClear">${t('clear_search')}</button>
            <a class="btn btn-orange btn-sm" href="categories.html" id="emptyBrowse">${t('browse_all')}</a>
          </div>
          <div class="mt-4 small text-muted">${t('try')}:
            <a class="btn btn-link btn-sm p-0 suggest-btn" href="categories.html?q=reese">reese</a> ·
            <a class="btn btn-link btn-sm p-0 suggest-btn" href="categories.html?q=nutella">nutella</a> ·
            <a class="btn btn-link btn-sm p-0 suggest-btn" href="categories.html?q=coca">coca</a> ·
            <a class="btn btn-link btn-sm p-0 suggest-btn" href="categories.html?q=lait">lait</a>
          </div>
        </div>
      </div>`;
    $('emptyClear')?.addEventListener('click', () => {
      searchQ = '';
      currentPage = 1;
      const input = $('searchInput');
      if (input) input.value = '';
      syncURL();
      loadShopPage(1);
    });
    return;
  }

  let html = '';
  if (suggestion) {
    html += `<div class="col-12"><div class="alert alert-light border small mb-2">
      ${t('suggest_msg', { q: escapeHtml(searchQ), s: escapeHtml(suggestion) })}
      <a class="btn btn-link btn-sm p-0 ms-2" href="categories.html?q=${encodeURIComponent(suggestion)}" id="useSuggestion">${t('search_only', { s: escapeHtml(suggestion) })}</a>
    </div></div>`;
  }

  html += list.slice(0, 12).map(cardHTML).join('');
  box.innerHTML = html;
  bindCards(box, () => renderPageProducts(suggestion));
}

// ---------- Pagination ----------
function renderPagination() {
  const nav = $('paginationNav');
  const ul = $('pagination');
  if (!nav || !ul) return;

  if (totalPages <= 1) {
    nav.style.display = 'none';
    return;
  }
  nav.style.display = 'block';

  // Google-style: show window of pages around current
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4);

  let html = '';
  html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
    <a class="page-link" href="${shopURL({ page: Math.max(1, currentPage - 1) })}" data-page="${currentPage - 1}">‹</a></li>`;

  if (start > 1) {
    html += `<li class="page-item"><a class="page-link" href="${shopURL({ page: 1 })}" data-page="1">1</a></li>`;
    if (start > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
  }

  for (let i = start; i <= end; i++) {
    html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
      <a class="page-link" href="${shopURL({ page: i })}" data-page="${i}">${i}</a></li>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
    html += `<li class="page-item"><a class="page-link" href="${shopURL({ page: totalPages })}" data-page="${totalPages}">${totalPages}</a></li>`;
  }

  html += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
    <a class="page-link" href="${shopURL({ page: Math.min(totalPages, currentPage + 1) })}" data-page="${currentPage + 1}">›</a></li>`;

  ul.innerHTML = html;
  ul.querySelectorAll('a[data-page]').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      const p = +a.dataset.page;
      if (p >= 1 && p <= totalPages && p !== currentPage) loadShopPage(p);
    };
  });
}

// ---------- Title / breadcrumb ----------
function updateShopTitle() {
  const cat = categories.find(c => c.id === currentCat);
  let title = cat ? catName(cat.name) : t('all_categories');
  if (searchQ) title = t('search_title', { q: searchQ });
  $('shopTitle').textContent = title;
  $('shopCrumb').textContent = title;
  document.title = 'AM MARKET — ' + title;
}

// ---------- Data loading ----------
async function loadShopPage(page = 1) {
  const box = $('shopProducts');
  currentPage = page;
  syncURL();
  box.innerHTML = `<div class="col-12 text-center py-5 text-muted"><div class="spinner-border spinner-border-sm text-warning" role="status"></div><div class="mt-2 small">${t('loading')}</div></div>`;

  try {
    let data = await fetchProducts(currentPage, currentCat, searchQ);
    pageProducts = data.results || [];
    totalCount = data.count || 0;

    // Smart search: if full query returns nothing, retry with first word
    let suggestion = null;
    if (searchQ && totalCount === 0) {
      const firstWord = searchQ.split(/\s+/)[0].replace(/['’]/g, '');
      if (firstWord && firstWord.length >= 3 && firstWord.toLowerCase() !== searchQ.toLowerCase()) {
        const fallback = await fetchProducts(1, currentCat, firstWord);
        if ((fallback.count || 0) > 0) {
          suggestion = firstWord;
          pageProducts = fallback.results || [];
          totalCount = fallback.count || pageProducts.length;
          currentPage = 1;
        }
      }
    }

    totalPages = Math.max(1, Math.ceil(totalCount / 12));

    renderFilterPanel(pageProducts);
    renderPageProducts(suggestion);
    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center text-danger py-4">${t('failed_load')}</div>`;
    const nav = $('paginationNav');
    if (nav) nav.style.display = 'none';
  }
}

// ---------- Init ----------
async function initCategories() {
  const input = $('searchInput');
  if (input && searchQ) input.value = searchQ;

  try {
    await ensureCategories();
  } catch { /* sidebar/filters simply stay empty */ }
  renderSidebar(currentCat);
  updateShopTitle();

  $('sortSelect')?.addEventListener('change', e => {
    sortBy = e.target.value;
    renderPageProducts();
  });

  $('priceRange')?.addEventListener('input', e => {
    maxPrice = +e.target.value;
    $('priceLabel').textContent = maxPrice + ' DH';
    renderPageProducts();
  });

  $('filterAvailable')?.addEventListener('change', e => {
    onlyAvailable = e.target.checked;
    renderPageProducts();
  });

  $('filterPromo')?.addEventListener('change', e => {
    onlyPromo = e.target.checked;
    renderPageProducts();
  });

  $('clearFilters')?.addEventListener('click', () => {
    maxPrice = 1000;
    onlyAvailable = true;
    onlyPromo = false;
    selectedBrand = null;
    searchQ = '';
    currentCat = null;
    currentPage = 1;
    const input = $('searchInput');
    if (input) input.value = '';
    const range = $('priceRange');
    if (range) range.value = 1000;
    const lbl = $('priceLabel');
    if (lbl) lbl.textContent = '1000 DH';
    const fa = $('filterAvailable');
    if (fa) fa.checked = true;
    const fp = $('filterPromo');
    if (fp) fp.checked = false;
    syncURL();
    renderSidebar(null);
    updateShopTitle();
    loadShopPage(1);
  });

  await loadShopPage(currentPage);
}

document.addEventListener('DOMContentLoaded', initCategories);

window.addEventListener('am:langchange', () => {
  updateShopTitle();
  renderSidebar(currentCat);
  renderFilterPanel(pageProducts);
  renderPageProducts();
});
