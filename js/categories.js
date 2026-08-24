/**
 * AM MARKET — categories.js (categories.html)
 * Catalog with filters, sorting and pagination. Page state lives in the URL:
 *   categories.html?cat=<id>&q=<search>&page=<n>&sort=<mode>
 *     &brand=<name>&max-price=<amount>
 * Links (pagination, suggestions, empty states) are standard <a href>s;
 * clicks are intercepted for fetch-based updates so browsing stays smooth.
 */

const ORDERING = {
  'price-asc': 'price',
  'price-desc': '-price',
  'name': 'name'
};
const CATALOG_PAGE_SIZE = 20;

function readShopState() {
  const searchParams = new URLSearchParams(location.search);
  const cat = Number(searchParams.get('cat'));
  const page = Number(searchParams.get('page'));
  const rawMaxPrice = Number(searchParams.get('max-price'));
  const requestedSort = searchParams.get('sort') || 'default';

  return {
    cat: Number.isInteger(cat) && cat > 0 ? cat : null,
    q: (searchParams.get('q') || '').trim(),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    sort: Object.prototype.hasOwnProperty.call(ORDERING, requestedSort) ? requestedSort : 'default',
    brand: (searchParams.get('brand') || '').trim() || null,
    maxPrice: searchParams.has('max-price') && Number.isFinite(rawMaxPrice) && rawMaxPrice >= 0
      ? Math.round(rawMaxPrice)
      : 1000,
    priceFilterActive: searchParams.has('max-price') && Number.isFinite(rawMaxPrice) && rawMaxPrice >= 0
  };
}

const initialState = readShopState();
let currentCat = initialState.cat;
let searchQ = initialState.q;
let currentPage = initialState.page;

let totalPages = 1;
let totalCount = 0;
let effectivePageSize = CATALOG_PAGE_SIZE;
let pageProducts = [];   // current page products from API
let sortBy = initialState.sort;
let maxPrice = initialState.maxPrice;
let priceFilterActive = initialState.priceFilterActive;
let selectedBrand = initialState.brand;
let brandSearchQuery = '';
let shopRequestSequence = 0;
let categoryOptionsFailed = false;
let brandOptionsFailed = false;
const priceCeilingCache = new Map();

// ---------- URL helpers ----------
function shopURL(overrides = {}) {
  const state = {
    page: currentPage,
    cat: currentCat,
    q: searchQ,
    sort: sortBy,
    brand: selectedBrand,
    maxPrice,
    priceFilterActive,
    ...overrides
  };
  const sp = new URLSearchParams();
  if (state.cat) sp.set('cat', state.cat);
  if (state.q) sp.set('q', state.q);
  if (state.page > 1) sp.set('page', state.page);
  if (state.sort !== 'default') sp.set('sort', state.sort);
  if (state.brand) sp.set('brand', state.brand);
  if (state.priceFilterActive) sp.set('max-price', String(Math.max(0, Math.round(state.maxPrice))));
  const s = sp.toString();
  return 'categories.html' + (s ? '?' + s : '');
}
// Some browsers restrict History API calls on file:// — if that happens,
// skip the URL sync and keep working (links still carry the right hrefs).
function syncURL(mode = 'replace') {
  try {
    const method = mode === 'push' ? 'pushState' : 'replaceState';
    history[method]({ catalog: true }, '', shopURL());
  } catch { /* file:// restricted */ }
}

function restoreStateFromURL() {
  const state = readShopState();
  currentCat = state.cat;
  searchQ = state.q;
  currentPage = state.page;
  sortBy = state.sort;
  selectedBrand = state.brand;
  brandSearchQuery = selectedBrand || '';
  maxPrice = state.maxPrice;
  priceFilterActive = state.priceFilterActive;

  const input = $('searchInput');
  if (input) input.value = searchQ;
  const sort = $('sortSelect');
  if (sort) sort.value = sortBy;
}

// ---------- Client-side filters ----------
function applyClientFilters(list) {
  let result = [...list];

  if (sortBy === 'price-asc') result.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  else if (sortBy === 'price-desc') result.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  else if (sortBy === 'name') result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return result;
}

function activeFilterCount() {
  return [currentCat, searchQ, selectedBrand, priceFilterActive].filter(Boolean).length;
}

function renderActiveFilters() {
  const box = $('activeFilters');
  if (!box) return;
  const cat = categories.find(c => String(c.id) === String(currentCat));
  const chips = [];
  if (cat) chips.push({ key: 'cat', label: catName(cat.name) });
  if (searchQ) chips.push({ key: 'search', label: `${t('search_filter')}: ${searchQ}` });
  if (selectedBrand) chips.push({ key: 'brand', label: selectedBrand });
  if (priceFilterActive) chips.push({ key: 'price', label: `${t('under_price')} ${maxPrice} DH` });

  box.innerHTML = chips.map(c => `
    <span class="filter-chip">
      ${escapeHtml(c.label)}
      <button type="button" data-clear-filter="${c.key}" aria-label="${escapeHtml(t('remove_filter', { name: c.label }))}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>`).join('');

  const count = activeFilterCount();
  const countEl = $('filterCount');
  if (countEl) {
    countEl.textContent = count;
    countEl.hidden = count === 0;
  }

  const clearButtons = [...box.querySelectorAll('[data-clear-filter]')];
  clearButtons.forEach((btn, buttonIndex) => {
    btn.onclick = () => {
      const key = btn.dataset.clearFilter;
      if (key === 'cat') currentCat = null;
      if (key === 'search') {
        searchQ = '';
        const input = $('searchInput');
        if (input) input.value = '';
      }
      if (key === 'brand') {
        selectedBrand = null;
        brandSearchQuery = '';
      }
      if (key === 'price') {
        priceFilterActive = false;
        maxPrice = +($('priceRange')?.max || 1000);
        $('priceRange').value = maxPrice;
        $('priceMaxInput').value = maxPrice;
      }
      currentPage = 1;
      renderSidebar(currentCat);
      updateShopTitle();
      loadShopPage(1, {
        historyMode: 'push',
        focusTarget: { type: 'active-filter', index: buttonIndex }
      });
    };
  });
}

function setFiltersOpen(open) {
  const column = $('filterColumn');
  const toggle = $('filterToggle');
  if (!column || !toggle) return;
  const isMobile = matchMedia('(max-width: 767.98px)').matches;
  column.classList.toggle('open', open);
  column.setAttribute('aria-hidden', String(!open && isMobile));
  toggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('filters-open', open);
  const panel = $('filtersPanel');
  const blocked = [document.querySelector('main > nav'), $('productColumn'), document.querySelector('.top-header'), document.querySelector('.footer'), document.querySelector('.mobile-tabbar')].filter(Boolean);
  if (open && isMobile) {
    panel?.setAttribute('role', 'dialog');
    panel?.setAttribute('aria-modal', 'true');
    panel?.setAttribute('aria-labelledby', 'filtersTitle');
    blocked.forEach(el => { el.inert = true; });
    $('closeFilters')?.focus();
  } else {
    panel?.removeAttribute('role');
    panel?.removeAttribute('aria-modal');
    panel?.removeAttribute('aria-labelledby');
    blocked.forEach(el => { el.inert = false; });
    if (!open) toggle.focus({ preventScroll: true });
  }
}

function reconcileFilterViewport() {
  const column = $('filterColumn');
  const toggle = $('filterToggle');
  if (!column || !toggle) return;
  const isMobile = matchMedia('(max-width: 767.98px)').matches;
  const panel = $('filtersPanel');
  const blocked = [document.querySelector('main > nav'), $('productColumn'), document.querySelector('.top-header'), document.querySelector('.footer'), document.querySelector('.mobile-tabbar')].filter(Boolean);
  if (!isMobile) {
    column.classList.remove('open');
    column.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('filters-open');
    panel?.removeAttribute('role');
    panel?.removeAttribute('aria-modal');
    panel?.removeAttribute('aria-labelledby');
    blocked.forEach(el => { el.inert = false; });
    return;
  }
  const open = column.classList.contains('open');
  column.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
}

// ---------- Filter panel ----------
function catalogBrandNames() {
  return [...new Set(catalogBrands.map(brand => brand?.name).filter(name => typeof name === 'string' && name.trim()))]
    .map(name => name.trim())
    .sort((a, b) => a.localeCompare(b, getLang() === 'fr' ? 'fr' : 'en', { sensitivity: 'base' }));
}

function canonicalCatalogBrand(value) {
  const requested = typeof value === 'string' ? value.trim() : '';
  if (!requested) return null;
  const folded = requested.toLocaleLowerCase();
  return catalogBrandNames().find(name => name.toLocaleLowerCase() === folded) || null;
}

function validateSelectedBrand() {
  if (!selectedBrand) return false;
  const canonical = canonicalCatalogBrand(selectedBrand);
  const changed = canonical !== selectedBrand;
  selectedBrand = canonical;
  brandSearchQuery = canonical || '';
  return changed;
}

function renderBrandChoices() {
  const choices = $('brandChoices');
  const status = $('brandMatchStatus');
  const input = $('brandFilterSearch');
  if (!choices || !status || !input) return;

  const brands = catalogBrandNames();
  const query = brandSearchQuery.trim().toLocaleLowerCase();
  const matching = brands.filter(name => !query || name.toLocaleLowerCase().includes(query));
  let visible = matching.slice(0, 12);
  if (selectedBrand && matching.includes(selectedBrand) && !visible.includes(selectedBrand)) {
    visible = [selectedBrand, ...visible.filter(name => name !== selectedBrand)].slice(0, 12);
  }

  const allOption = `<div class="form-check">
    <input class="form-check-input filter-brand" type="radio" name="fbrand" id="fb-all" value="" ${!selectedBrand ? 'checked' : ''}>
    <label class="form-check-label small" for="fb-all">${escapeHtml(t('all_brands'))}</label>
  </div>`;
  const brandOptions = visible.map((brand, index) => {
    const inputId = `fb-match-${index}`;
    return `<div class="form-check">
      <input class="form-check-input filter-brand" type="radio" name="fbrand" id="${inputId}" value="${escapeHtml(brand)}" ${selectedBrand === brand ? 'checked' : ''}>
      <label class="form-check-label small" for="${inputId}">${escapeHtml(brand)}</label>
    </div>`;
  }).join('');

  choices.innerHTML = allOption + (brandOptions || `<p class="small text-muted mb-0">${escapeHtml(t('brand_no_matches'))}</p>`);
  status.textContent = matching.length
    ? t('brand_matches', { n: visible.length, total: matching.length })
    : t('brand_no_matches');

  choices.querySelectorAll('.filter-brand').forEach(radio => {
    radio.addEventListener('change', () => {
      const canonical = radio.value ? canonicalCatalogBrand(radio.value) : null;
      if (radio.value && !canonical) return;
      selectedBrand = canonical;
      brandSearchQuery = canonical || '';
      currentPage = 1;
      loadShopPage(1, {
        historyMode: 'push',
        focusTarget: { type: 'brand', brand: selectedBrand }
      });
    });
  });
}

function renderFilterPanel(list) {
  const catBox = $('filterCategories');
  if (catBox) {
    if (categoryOptionsFailed) {
      catBox.innerHTML = `<div class="small text-danger" role="alert">
        <span>${escapeHtml(t('api_error'))}</span>
        <button type="button" class="btn btn-link btn-sm state-action p-0 ms-1" id="retryCategoryOptions">${escapeHtml(t('retry'))}</button>
      </div>`;
      $('retryCategoryOptions')?.addEventListener('click', event => retryCatalogOptions('categories', event.currentTarget));
    } else {
      catBox.innerHTML = `
      <div class="form-check">
        <input class="form-check-input filter-cat" type="radio" name="fcat" id="fcat-all" value="" ${!currentCat ? 'checked' : ''}>
        <label class="form-check-label small" for="fcat-all">${t('all_categories')}</label>
      </div>
      ${categories.map((c, index) => {
        const inputId = `fcat-${index}`;
        return `
        <div class="form-check">
          <input class="form-check-input filter-cat" type="radio" name="fcat" id="${inputId}" value="${escapeHtml(c.id)}" ${String(currentCat) === String(c.id) ? 'checked' : ''}>
          <label class="form-check-label small" for="${inputId}">${escapeHtml(catName(c.name))}</label>
        </div>
      `; }).join('')}`;

      catBox.querySelectorAll('.filter-cat').forEach(r => {
        r.onchange = () => {
          currentCat = r.value ? +r.value : null;
          currentPage = 1;
          selectedBrand = null;
          brandSearchQuery = '';
          renderSidebar(currentCat);
          updateShopTitle();
          loadShopPage(1, {
            historyMode: 'push',
            focusTarget: { type: 'category', category: currentCat }
          });
          if (matchMedia('(max-width: 767.98px)').matches) setFiltersOpen(false);
        };
      });
    }
  }

  const brandBox = $('filterBrands');
  if (brandBox) {
    if (brandOptionsFailed) {
      brandBox.innerHTML = `<div class="small text-danger" role="alert">
        <span>${escapeHtml(t('api_error'))}</span>
        <button type="button" class="btn btn-link btn-sm state-action p-0 ms-1" id="retryBrandOptions">${escapeHtml(t('retry'))}</button>
      </div>`;
      $('retryBrandOptions')?.addEventListener('click', event => retryCatalogOptions('brands', event.currentTarget));
      return;
    }
    const brands = catalogBrandNames();
    brandBox.innerHTML = brands.length === 0
      ? `<span class="small text-muted">${escapeHtml(t('no_brands'))}</span>`
      : `<label class="form-label small mb-1" for="brandFilterSearch">${escapeHtml(t('search_brands'))}</label>
        <input class="form-control form-control-sm mb-1" type="search" id="brandFilterSearch"
          value="${escapeHtml(brandSearchQuery)}" autocomplete="off"
          aria-controls="brandChoices" aria-describedby="brandMatchStatus"
          placeholder="${escapeHtml(t('search_brands'))}">
        <div class="visually-hidden" id="brandMatchStatus" aria-live="polite" aria-atomic="true"></div>
        <div id="brandChoices" role="group" aria-label="${escapeHtml(t('brand_page'))}"></div>`;
    if (!brands.length) return;

    const searchInput = $('brandFilterSearch');
    searchInput?.addEventListener('input', event => {
      brandSearchQuery = event.currentTarget.value;
      renderBrandChoices();
    });
    searchInput?.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        $('brandChoices')?.querySelector('input')?.focus();
      } else if (event.key === 'Escape' && brandSearchQuery) {
        event.preventDefault();
        event.stopPropagation();
        brandSearchQuery = '';
        event.currentTarget.value = '';
        renderBrandChoices();
      }
    });
    renderBrandChoices();
  }
}

async function retryCatalogOptions(type, button) {
  if (button) button.disabled = true;
  try {
    if (type === 'categories') {
      await ensureCategories();
      categoryOptionsFailed = false;
      await renderSidebar(currentCat);
      updateShopTitle();
    } else {
      await ensureBrands();
      brandOptionsFailed = false;
      validateSelectedBrand();
    }
  } catch (error) {
    if (type === 'categories') categoryOptionsFailed = true;
    else brandOptionsFailed = true;
    console.error(`Catalog ${type} recovery failed`, error);
  }
  renderFilterPanel(pageProducts);
  requestAnimationFrame(() => {
    const failed = type === 'categories' ? categoryOptionsFailed : brandOptionsFailed;
    const target = failed
      ? $(type === 'categories' ? 'retryCategoryOptions' : 'retryBrandOptions')
      : document.querySelector(type === 'categories' ? '#filterCategories input' : '#filterBrands input');
    target?.focus({ preventScroll: true });
  });
}

function catalogFilterOptions({ includeMaxPrice = true } = {}) {
  return {
    brand: selectedBrand,
    maxPrice: includeMaxPrice && priceFilterActive ? maxPrice : null
  };
}

async function getCatalogPriceCeiling(query = searchQ) {
  const key = JSON.stringify([currentCat, query, selectedBrand]);
  if (!priceCeilingCache.has(key)) {
    const request = fetchProducts(1, currentCat, query, '-price', CATALOG_PAGE_SIZE, catalogFilterOptions({ includeMaxPrice: false }))
      .then(data => (data.results || []).reduce((highest, product) => Math.max(highest, Number(product.price) || 0), 0))
      .catch(error => {
        priceCeilingCache.delete(key);
        console.error('Catalog price ceiling load failed', error);
        return null;
      });
    priceCeilingCache.set(key, request);
  }
  return priceCeilingCache.get(key);
}

// ---------- Product grid ----------
function renderPageProducts(suggestion = null) {
  const box = $('shopProducts');
  const list = applyClientFilters(pageProducts);
  const countEl = $('resultCount');
  if (countEl) {
    countEl.textContent = totalCount
      ? t('shown_total', { n: list.length, total: totalCount })
      : t('n_products', { n: list.length });
  }

  if (list.length === 0) {
    box.innerHTML = `
      <div class="col-12">
        <div class="empty-search text-center py-5">
          <i class="fa-solid fa-magnifying-glass empty-icon mb-3" aria-hidden="true"></i>
          <h2 class="h5 fw-bold">${t('no_products')}</h2>
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
      loadShopPage(1, { historyMode: 'push' });
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

  html += list.map(cardHTML).join('');
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

  const isFrench = getLang() === 'fr';
  const previousLabel = isFrench ? 'Page précédente' : 'Previous page';
  const nextLabel = isFrench ? 'Page suivante' : 'Next page';
  const pageLabel = page => isFrench
    ? `Page ${page} sur ${totalPages}`
    : `Page ${page} of ${totalPages}`;
  const pageHref = page => escapeHtml(shopURL({ page }));

  let html = '';
  html += currentPage === 1
    ? `<li class="page-item disabled"><span class="page-link" role="link" aria-disabled="true" aria-label="${escapeHtml(previousLabel)}"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></span></li>`
    : `<li class="page-item"><a class="page-link" href="${pageHref(currentPage - 1)}" data-page="${currentPage - 1}" aria-label="${escapeHtml(previousLabel)}"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></a></li>`;

  if (start > 1) {
    html += `<li class="page-item"><a class="page-link" href="${pageHref(1)}" data-page="1" aria-label="${escapeHtml(pageLabel(1))}">1</a></li>`;
    if (start > 2) html += `<li class="page-item disabled" aria-hidden="true"><span class="page-link">…</span></li>`;
  }

  for (let i = start; i <= end; i++) {
    html += i === currentPage
      ? `<li class="page-item active"><span class="page-link" role="link" tabindex="-1" data-page="${i}" aria-current="page" aria-disabled="true" aria-label="${escapeHtml(pageLabel(i))}">${i}</span></li>`
      : `<li class="page-item"><a class="page-link" href="${pageHref(i)}" data-page="${i}" aria-label="${escapeHtml(pageLabel(i))}">${i}</a></li>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += `<li class="page-item disabled" aria-hidden="true"><span class="page-link">…</span></li>`;
    html += `<li class="page-item"><a class="page-link" href="${pageHref(totalPages)}" data-page="${totalPages}" aria-label="${escapeHtml(pageLabel(totalPages))}">${totalPages}</a></li>`;
  }

  html += currentPage === totalPages
    ? `<li class="page-item disabled"><span class="page-link" role="link" aria-disabled="true" aria-label="${escapeHtml(nextLabel)}"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span></li>`
    : `<li class="page-item"><a class="page-link" href="${pageHref(currentPage + 1)}" data-page="${currentPage + 1}" aria-label="${escapeHtml(nextLabel)}"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a></li>`;

  ul.innerHTML = html;
  ul.querySelectorAll('a[data-page]').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      const p = +a.dataset.page;
      if (p >= 1 && p <= totalPages && p !== currentPage) {
        loadShopPage(p, { historyMode: 'push', focusTarget: { type: 'page', page: p } });
      }
    };
  });
}

// ---------- Title / breadcrumb ----------
function updateShopTitle() {
  const cat = categories.find(c => c.id === currentCat);
  let title = cat ? catName(cat.name) : t('products');
  if (searchQ) title = t('search_title', { q: searchQ });
  $('shopTitle').textContent = title;
  $('shopCrumb').textContent = title;
  document.title = 'AM MARKET — ' + title;
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
}

function syncFilterControls() {
  const sort = $('sortSelect');
  if (sort) sort.value = sortBy;
  const range = $('priceRange');
  if (range) range.value = maxPrice;
  const maxInput = $('priceMaxInput');
  if (maxInput) maxInput.value = maxPrice;
}

function focusCatalogElement(element) {
  if (!element) return;
  if (!element.matches('a, button, input, select, textarea, [tabindex]')) element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
}

function restoreCatalogFocus(target) {
  if (!target) return;
  requestAnimationFrame(() => {
    if (target.type === 'page') {
      const current = [...document.querySelectorAll('#pagination [data-page]')]
        .find(element => Number(element.dataset.page) === Number(target.page));
      focusCatalogElement(current || $('paginationNav') || $('shopTitle'));
      return;
    }
    if (target.type === 'active-filter') {
      const buttons = [...document.querySelectorAll('#activeFilters [data-clear-filter]')];
      const next = buttons[Math.min(target.index, Math.max(0, buttons.length - 1))];
      const filterToggle = $('filterToggle');
      const visibleToggle = filterToggle?.getClientRects().length ? filterToggle : null;
      focusCatalogElement(next || visibleToggle || $('shopTitle'));
      return;
    }
    if (target.type === 'brand') {
      const radio = [...document.querySelectorAll('#brandChoices .filter-brand')]
        .find(element => (element.value || null) === (target.brand || null));
      focusCatalogElement(radio || $('brandFilterSearch') || $('shopTitle'));
      return;
    }
    if (target.type === 'category') {
      if (matchMedia('(max-width: 767.98px)').matches && !$('filterColumn')?.classList.contains('open')) {
        focusCatalogElement($('filterToggle') || $('shopTitle'));
        return;
      }
      const radio = [...document.querySelectorAll('#filterCategories .filter-cat')]
        .find(element => (element.value ? Number(element.value) : null) === (target.category || null));
      focusCatalogElement(radio || $('filterToggle') || $('shopTitle'));
    }
  });
}

// ---------- Data loading ----------
async function loadShopPage(page = 1, { historyMode = 'replace', focusTarget = null } = {}) {
  const requestSequence = ++shopRequestSequence;
  const box = $('shopProducts');
  currentPage = page;
  if (historyMode !== 'none') syncURL(historyMode);
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = skeletonCards(8);

  try {
    let [data, priceCeiling] = await Promise.all([
      fetchProducts(currentPage, currentCat, searchQ, ORDERING[sortBy] || '', CATALOG_PAGE_SIZE, catalogFilterOptions()),
      getCatalogPriceCeiling()
    ]);
    if (requestSequence !== shopRequestSequence) return;
    pageProducts = Array.isArray(data.results) ? data.results : [];
    totalCount = safeNonNegativeCount(data.count);
    effectivePageSize = Number.isSafeInteger(Number(data.pageSize)) && Number(data.pageSize) > 0
      ? Number(data.pageSize)
      : CATALOG_PAGE_SIZE;

    // Smart search: if full query returns nothing, retry with first word
    let suggestion = null;
    if (searchQ && totalCount === 0) {
      const firstWord = searchQ.split(/\s+/)[0].replace(/['’]/g, '');
      if (firstWord && firstWord.length >= 3 && firstWord.toLowerCase() !== searchQ.toLowerCase()) {
        const [fallback, fallbackCeiling] = await Promise.all([
          fetchProducts(currentPage, currentCat, firstWord, ORDERING[sortBy] || '', CATALOG_PAGE_SIZE, catalogFilterOptions()),
          getCatalogPriceCeiling(firstWord)
        ]);
        if (requestSequence !== shopRequestSequence) return;
        if (safeNonNegativeCount(fallback.count) > 0) {
          suggestion = firstWord;
          pageProducts = Array.isArray(fallback.results) ? fallback.results : [];
          totalCount = safeNonNegativeCount(fallback.count) || pageProducts.length;
          effectivePageSize = Number.isSafeInteger(Number(fallback.pageSize)) && Number(fallback.pageSize) > 0
            ? Number(fallback.pageSize)
            : CATALOG_PAGE_SIZE;
          priceCeiling = fallbackCeiling;
        }
      }
    }

    totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
    if (currentPage > totalPages) {
      await loadShopPage(totalPages, {
        historyMode: 'replace',
        focusTarget: focusTarget?.type === 'page'
          ? { ...focusTarget, page: totalPages }
          : focusTarget
      });
      return;
    }

    // Keep the price slider above the priciest product on this page. An
    // explicit URL value is also preserved so browser history restores the
    // exact filter the customer chose.
    const topPrice = Number.isFinite(Number(priceCeiling))
      ? Number(priceCeiling)
      : pageProducts.reduce((m, p) => Math.max(m, Math.ceil(parseFloat(p.price) || 0)), 0);
    const range = $('priceRange');
    if (range) {
      const catalogMax = Math.max(10, Math.ceil(topPrice / 10) * 10);
      const newMax = Math.max(catalogMax, priceFilterActive ? maxPrice : 0);
      range.max = newMax;
      const maxInput = $('priceMaxInput');
      if (maxInput) maxInput.max = newMax;
      if (!priceFilterActive) {
        maxPrice = newMax;
      }
    }
    syncFilterControls();

    renderFilterPanel(pageProducts);
    renderPageProducts(suggestion);
    renderActiveFilters();
    renderPagination();
    if (historyMode !== 'none') syncURL('replace');
    window.scrollTo({ top: 0, behavior: motionBehavior() });
    restoreCatalogFocus(focusTarget);
  } catch (e) {
    if (requestSequence !== shopRequestSequence) return;
    if (e?.status === 404 && currentPage > 1) {
      await loadShopPage(1, {
        historyMode: 'replace',
        focusTarget: focusTarget?.type === 'page'
          ? { ...focusTarget, page: 1 }
          : focusTarget
      });
      return;
    }
    box.innerHTML = `<div class="col-12 text-center py-4">
      <p class="text-danger mb-2">${t('failed_load')}</p>
      <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryShop">${t('retry')}</button>
    </div>`;
    $('retryShop')?.addEventListener('click', () => loadShopPage(currentPage));
    if (focusTarget) requestAnimationFrame(() => $('retryShop')?.focus({ preventScroll: true }));
    const nav = $('paginationNav');
    if (nav) nav.style.display = 'none';
  } finally {
    if (requestSequence === shopRequestSequence) box.removeAttribute('aria-busy');
  }
}

// ---------- Init ----------
async function initCategories() {
  restoreStateFromURL();
  syncFilterControls();

  const optionResults = await Promise.allSettled([ensureCategories(), ensureBrands()]);
  categoryOptionsFailed = optionResults[0].status === 'rejected';
  brandOptionsFailed = optionResults[1].status === 'rejected';
  if (categoryOptionsFailed) console.error('Catalog category options load failed', optionResults[0].reason);
  if (brandOptionsFailed) console.error('Catalog brand options load failed', optionResults[1].reason);
  if (!brandOptionsFailed && validateSelectedBrand()) syncURL('replace');
  if (!categoryOptionsFailed) renderSidebar(currentCat);
  renderFilterPanel([]);
  updateShopTitle();
  reconcileFilterViewport();
  matchMedia('(max-width: 767.98px)').addEventListener('change', reconcileFilterViewport);

  $('sortSelect')?.addEventListener('change', e => {
    sortBy = e.target.value;
    currentPage = 1;
    loadShopPage(1, { historyMode: 'push' });
  });

  $('priceRange')?.addEventListener('input', e => {
    maxPrice = +e.target.value;
    priceFilterActive = maxPrice < +e.target.max;
    $('priceMaxInput').value = maxPrice;
    renderActiveFilters();
  });
  $('priceRange')?.addEventListener('change', () => {
    currentPage = 1;
    loadShopPage(1, { historyMode: 'push' });
  });

  $('priceMaxInput')?.addEventListener('change', e => {
    const range = $('priceRange');
    maxPrice = Math.max(0, Math.min(+range.max, +e.target.value || 0));
    priceFilterActive = maxPrice < +range.max;
    e.target.value = maxPrice;
    range.value = maxPrice;
    currentPage = 1;
    loadShopPage(1, { historyMode: 'push' });
  });

  $('filterToggle')?.addEventListener('click', () => setFiltersOpen(true));
  $('closeFilters')?.addEventListener('click', () => setFiltersOpen(false));
  $('filterColumn')?.addEventListener('click', e => {
    if (e.target === $('filterColumn')) setFiltersOpen(false);
  });
  document.addEventListener('keydown', e => {
    const open = $('filterColumn')?.classList.contains('open');
    if (e.key === 'Escape' && open) { setFiltersOpen(false); return; }
    if (e.key !== 'Tab' || !open || !matchMedia('(max-width: 767.98px)').matches) return;
    const focusable = [...$('filtersPanel').querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && !el.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $('clearFilters')?.addEventListener('click', () => {
    const range = $('priceRange');
    maxPrice = +(range?.max || 1000);
    priceFilterActive = false;
    selectedBrand = null;
    brandSearchQuery = '';
    searchQ = '';
    currentCat = null;
    currentPage = 1;
    const input = $('searchInput');
    if (input) input.value = '';
    if (range) range.value = maxPrice;
    const maxInput = $('priceMaxInput');
    if (maxInput) maxInput.value = maxPrice;
    renderSidebar(null);
    updateShopTitle();
    loadShopPage(1, { historyMode: 'push' });
  });

  await loadShopPage(currentPage);
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(initCategories));

window.addEventListener('am:langchange', () => {
  updateShopTitle();
  renderSidebar(currentCat);
  renderFilterPanel(pageProducts);
  renderPageProducts();
  renderActiveFilters();
  renderPagination();
});

window.addEventListener('popstate', () => {
  restoreStateFromURL();
  if (!brandOptionsFailed && validateSelectedBrand()) syncURL('replace');
  renderSidebar(currentCat);
  updateShopTitle();
  loadShopPage(currentPage, { historyMode: 'none' });
});
