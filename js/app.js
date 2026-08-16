/**
 * AM MARKET — Real data from api.mmarket.ma
 * Cart / Wishlist / Orders stored in localStorage
 * No fake ratings or promotions
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

let categories = [];
let products = [];
let cart = [];
let wishlist = [];
let orders = [];
let currentCat = null;
let currentPage = 1;
let totalPages = 1;
let totalCount = 0;
let searchQ = '';
let sortBy = 'default';
let productCache = {};
let maxPrice = 1000;
let onlyAvailable = true;
let onlyPromo = false;
let selectedBrand = null;
let pageProducts = []; // current page products from API
let currentViewName = 'home';
let lastDetailId = null;

// ---------- Storage ----------
function loadLS() {
  try {
    cart = JSON.parse(localStorage.getItem(LS.cart)) || [];
    wishlist = JSON.parse(localStorage.getItem(LS.wish)) || [];
    orders = JSON.parse(localStorage.getItem(LS.orders)) || [];
  } catch { cart = []; wishlist = []; orders = []; }
}
function saveCart() { localStorage.setItem(LS.cart, JSON.stringify(cart)); updateBadges(); }
function saveWish() { localStorage.setItem(LS.wish, JSON.stringify(wishlist)); updateBadges(); }
function saveOrders() { localStorage.setItem(LS.orders, JSON.stringify(orders)); }

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
async function fetchCategories() {
  const res = await fetch(`${API}/categories/`);
  if (!res.ok) throw new Error('Categories failed');
  const data = await res.json();
  // Exclude smoking category
  return (Array.isArray(data) ? data : data.results || [])
    .filter(c => c.id !== EXCLUDE_CAT && c.parent_id == null);
}

async function fetchProducts(page = 1, categoryId = null, search = '') {
  let url = `${API}/products/?include_descendants=true&page=${page}&page_size=12`;
  if (categoryId) url += `&category=${categoryId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Products failed');
  return res.json(); // { count, next, previous, results }
}

async function fetchProduct(id) {
  if (productCache[id]) return productCache[id];
  const res = await fetch(`${API}/products/${id}/`);
  if (!res.ok) throw new Error('Product not found');
  const p = await res.json();
  productCache[id] = p;
  return p;
}

// ---------- Helpers ----------
function formatPrice(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '—' : Math.round(n) + ' DH';
}

function toast(msg) {
  const el = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  new bootstrap.Toast(el, { delay: 2200 }).show();
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}

function updateBadges() {
  const cc = cart.reduce((s, i) => s + i.qty, 0);
  const wc = wishlist.length;
  [['cartCount', cc], ['mCartCount', cc], ['wishCount', wc], ['mWishCount', wc]].forEach(([id, n]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.textContent !== String(n)) {
      el.classList.remove('badge-pop'); void el.offsetWidth; el.classList.add('badge-pop');
    }
    el.textContent = n; el.dataset.n = n;
  });
}

// ---------- Views ----------
function showView(name) {
  currentViewName = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(name + 'View');
  if (v) v.classList.add('active');

  const side = document.getElementById('sidebar');
  if (side) side.style.display = (name === 'home' || name === 'shop') ? '' : 'none';

  if (name === 'home') renderHome();
  if (name === 'shop') renderShop();
  if (name === 'cart') renderCart();
  if (name === 'checkout') renderCheckout();
  if (name === 'orders') renderOrders();
  if (name === 'wishlist') renderWishlist();

  updateTabbar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Sync the mobile bottom toolbar active tab with the current view
function updateTabbar() {
  const map = { home: 'home', shop: 'home', detail: 'home', cart: 'cart', checkout: 'cart', wishlist: 'wishlist', orders: 'account' };
  const active = map[currentViewName] || '';
  document.querySelectorAll('.mobile-tabbar [data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === active);
  });
}

// ---------- Product card ----------
function cardHTML(p) {
  const img = p.image_url || '';
  const inWish = wishlist.includes(String(p.id));
  const disc = parseInt(p.discount_percent) || 0;
  const oldPrice = parseFloat(p.original_price);
  const hasOld = oldPrice > 0 && oldPrice > parseFloat(p.price);

  return `
    <div class="col-6 col-md-4 col-xl-3">
      <div class="product-card">
        ${disc > 0 ? `<span class="badge-disc">-${disc}%</span>` : (p.is_promo ? `<span class="badge-disc badge-promo">Promo 🔥</span>` : '')}
        <div class="product-img" data-id="${p.id}">
          <img src="${img}" alt="${escapeHtml(p.name)}" loading="lazy"
               onerror="this.src='https://via.placeholder.com/300?text=No+Image'">
        </div>
        <div class="product-body">
          <div class="product-title" data-id="${p.id}">${escapeHtml(p.name)}</div>
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

function bindCards(container) {
  container.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('.add-btn') || e.target.closest('.wish-btn')) return;
      openDetail(el.dataset.id);
    };
  });
  container.querySelectorAll('.add-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); addToCart(btn.dataset.id); };
  });
  container.querySelectorAll('[data-wish]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleWish(btn.dataset.wish);
      const active = document.querySelector('.view.active');
      if (active.id === 'homeView') renderHomeProducts();
      else if (active.id === 'shopView') renderShopProducts();
      else if (active.id === 'wishlistView') renderWishlist();
    };
  });
}

// ---------- Home ----------
function renderHome() {
  // Categories
  const grid = document.getElementById('homeCategories');
  grid.innerHTML = categories.slice(0, 12).map(c => `
    <div class="cat-card" data-cat="${c.id}">
      <div class="icon">${getCatIcon(c)}</div>
      <span>${escapeHtml(catName(c.name))}</span>
    </div>
  `).join('');
  grid.querySelectorAll('.cat-card').forEach(el => {
    el.onclick = () => {
      currentCat = +el.dataset.cat;
      currentPage = 1;
      showView('shop');
    };
  });

  renderHomeProducts();
  renderRecent();
  renderSidebar();
}

function renderRecent() {
  const section = document.getElementById('recentSection');
  const box = document.getElementById('recentProducts');
  if (!section || !box) return;
  const list = getRecent();
  if (list.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  box.innerHTML = list.slice(0, 4).map(cardHTML).join('');
  bindCards(box);
}

async function renderHomeProducts() {
  const box = document.getElementById('homeProducts');
  try {
    if (!products.length) {
      const data = await fetchProducts(1);
      products = data.results || [];
    }
    box.innerHTML = products.slice(0, 12).map(cardHTML).join('');
    bindCards(box);
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center text-danger py-4">${t('failed_load')}</div>`;
  }
}

function renderSidebar() {
  const list = document.getElementById('categoryList');
  list.innerHTML = `
    <li class="list-group-item ${!currentCat ? 'active' : ''}" data-cat="">
      🏪 ${t('all_categories')}
    </li>
    ${categories.map(c => `
      <li class="list-group-item ${currentCat === c.id ? 'active' : ''}" data-cat="${c.id}">
        ${getCatIcon(c)} ${escapeHtml(catName(c.name))}
        <small class="text-muted ms-auto">${c.product_count || ''}</small>
      </li>
    `).join('')}`;

  list.querySelectorAll('.list-group-item').forEach(li => {
    li.onclick = () => {
      currentCat = li.dataset.cat ? +li.dataset.cat : null;
      currentPage = 1;
      showView('shop');
    };
  });
}

// ---------- Shop ----------
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

function renderFilterPanel(list) {
  const catBox = document.getElementById('filterCategories');
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
        loadShopPage(1);
      };
    });
  }

  const brandBox = document.getElementById('filterBrands');
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

function renderPageProducts(suggestion = null) {
  const box = document.getElementById('shopProducts');
  const list = applyClientFilters(pageProducts);
  const countEl = document.getElementById('resultCount');
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
            <button class="btn btn-orange btn-sm" data-view="shop" id="emptyBrowse">${t('browse_all')}</button>
          </div>
          <div class="mt-4 small text-muted">${t('try')}: <button class="btn btn-link btn-sm p-0 suggest-btn" data-q="reese">reese</button> ·
            <button class="btn btn-link btn-sm p-0 suggest-btn" data-q="nutella">nutella</button> ·
            <button class="btn btn-link btn-sm p-0 suggest-btn" data-q="coca">coca</button> ·
            <button class="btn btn-link btn-sm p-0 suggest-btn" data-q="lait">lait</button>
          </div>
        </div>
      </div>`;
    document.getElementById('emptyClear')?.addEventListener('click', () => {
      searchQ = '';
      document.getElementById('searchInput').value = '';
      currentPage = 1;
      loadShopPage(1);
    });
    document.getElementById('emptyBrowse')?.addEventListener('click', () => {
      searchQ = '';
      currentCat = null;
      document.getElementById('searchInput').value = '';
      showView('shop');
    });
    box.querySelectorAll('.suggest-btn').forEach(b => {
      b.onclick = () => {
        searchQ = b.dataset.q;
        document.getElementById('searchInput').value = searchQ;
        currentPage = 1;
        loadShopPage(1);
      };
    });
    return;
  }

  let html = '';
  if (suggestion) {
    html += `<div class="col-12"><div class="alert alert-light border small mb-2">
      ${t('suggest_msg', { q: escapeHtml(searchQ), s: escapeHtml(suggestion) })}
      <button class="btn btn-link btn-sm p-0 ms-2" id="useSuggestion">${t('search_only', { s: escapeHtml(suggestion) })}</button>
    </div></div>`;
  }

  html += list.slice(0, 12).map(cardHTML).join('');
  box.innerHTML = html;
  bindCards(box);

  document.getElementById('useSuggestion')?.addEventListener('click', () => {
    searchQ = suggestion;
    document.getElementById('searchInput').value = suggestion;
    currentPage = 1;
    loadShopPage(1);
  });
}

function renderPagination() {
  const nav = document.getElementById('paginationNav');
  const ul = document.getElementById('pagination');
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
    <a class="page-link" href="#" data-page="${currentPage - 1}">‹</a></li>`;

  if (start > 1) {
    html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
    if (start > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
  }

  for (let i = start; i <= end; i++) {
    html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
      <a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
    html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
  }

  html += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
    <a class="page-link" href="#" data-page="${currentPage + 1}">›</a></li>`;

  ul.innerHTML = html;
  ul.querySelectorAll('a[data-page]').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      const p = +a.dataset.page;
      if (p >= 1 && p <= totalPages && p !== currentPage) loadShopPage(p);
    };
  });
}

function updateShopTitle() {
  const cat = categories.find(c => c.id === currentCat);
  let title = cat ? catName(cat.name) : t('all_categories');
  if (searchQ) title = t('search_title', { q: searchQ });
  document.getElementById('shopTitle').textContent = title;
  document.getElementById('shopCrumb').textContent = title;
}

async function renderShop() {
  updateShopTitle();
  renderSidebar();
  await loadShopPage(currentPage || 1);
}

async function loadShopPage(page = 1) {
  const box = document.getElementById('shopProducts');
  currentPage = page;
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
    pageProducts.forEach(p => { productCache[p.id] = p; });
    if (!searchQ && !currentCat) products = pageProducts;

    renderFilterPanel(pageProducts);
    renderPageProducts(suggestion);
    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center text-danger py-4">${t('failed_load')}</div>`;
    const nav = document.getElementById('paginationNav');
    if (nav) nav.style.display = 'none';
  }
}

// ---------- Detail ----------
async function openDetail(id) {
  lastDetailId = id;
  const box = document.getElementById('detailContent');
  const relatedBox = document.getElementById('relatedSection');
  box.innerHTML = `<div class="col-12 text-center py-5 text-muted">${t('loading')}</div>`;
  if (relatedBox) relatedBox.style.display = 'none';
  showView('detail');

  try {
    const p = await fetchProduct(id);
    addRecent(p);
    document.getElementById('detailCrumb').textContent = p.name;
    const inWish = wishlist.includes(String(p.id));
    const available = p.is_available !== false;

    box.innerHTML = `
      <div class="col-md-5">
        <div class="detail-img">
          <img src="${p.image_url || ''}" alt="${escapeHtml(p.name)}"
               onerror="this.src='https://via.placeholder.com/400?text=No+Image'">
        </div>
      </div>
      <div class="col-md-7">
        <div class="bg-white p-4 p-lg-4 rounded-3 shadow-sm h-100">
          ${p.brand_name ? `<div class="text-orange fw-semibold small mb-1">${escapeHtml(p.brand_name)}</div>` : ''}
          <h3 class="fw-bold mb-2">${escapeHtml(p.name)}</h3>

          <div class="d-flex flex-wrap gap-2 mb-3">
            ${p.category_name ? `<span class="badge bg-light text-dark border">${escapeHtml(catName(p.category_name))}</span>` : ''}
            ${p.weight_volume ? `<span class="badge bg-light text-dark border">${escapeHtml(p.weight_volume)}</span>` : ''}
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
              <button type="button" id="dMinus">−</button>
              <input type="number" id="dQty" value="1" min="1">
              <button type="button" id="dPlus">+</button>
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

    const qty = document.getElementById('dQty');
    document.getElementById('dMinus').onclick = () => { qty.value = Math.max(1, +qty.value - 1); };
    document.getElementById('dPlus').onclick = () => { qty.value = +qty.value + 1; };
    document.getElementById('dAdd').onclick = () => addToCart(p.id, +qty.value || 1);
    document.getElementById('dBuy').onclick = () => { addToCart(p.id, +qty.value || 1); showView('checkout'); };
    document.getElementById('dWish').onclick = () => { toggleWish(p.id); openDetail(p.id); };

    // Related products (same category)
    loadRelated(p);
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center text-danger py-5">${t('product_not_found')}</div>`;
  }
}

async function loadRelated(product) {
  const section = document.getElementById('relatedSection');
  const box = document.getElementById('relatedProducts');
  if (!section || !box) return;

  try {
    let list = products.filter(p =>
      p.id !== product.id &&
      (p.category === product.category || p.category_name === product.category_name)
    ).slice(0, 4);

    if (list.length < 4) {
      const extra = products.filter(p => p.id !== product.id && !list.find(x => x.id === p.id)).slice(0, 4 - list.length);
      list = list.concat(extra);
    }

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

// ---------- Cart ----------
function addToCart(id, qty = 1) {
  id = String(id);
  const item = cart.find(i => i.id === id);
  if (item) item.qty += qty;
  else cart.push({ id, qty });
  saveCart();
  toast(t('added_cart'));
}

function updateQty(id, qty) {
  id = String(id);
  if (qty <= 0) cart = cart.filter(i => i.id !== id);
  else {
    const item = cart.find(i => i.id === id);
    if (item) item.qty = qty;
  }
  saveCart();
  renderCart();
}

function removeCart(id) {
  cart = cart.filter(i => i.id !== String(id));
  saveCart();
  renderCart();
  toast(t('removed'));
}

function cartSubtotal() {
  // Need prices from cache or products list
  return cart.reduce((s, i) => {
    const p = productCache[i.id] || products.find(x => String(x.id) === i.id);
    return s + (p ? parseFloat(p.price) * i.qty : 0);
  }, 0);
}

function deliveryFee(sub) {
  return (sub >= 200 || sub === 0) ? 0 : 20;
}

async function renderCart() {
  const box = document.getElementById('cartItems');
  const count = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('cartLabel').textContent = `(${count})`;

  if (cart.length === 0) {
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-cart-shopping fa-3x text-muted mb-3"></i><h5>${t('cart_empty')}</h5><button class="btn btn-orange mt-2" data-view="shop">${t('continue_shopping')}</button></div>`;
    document.getElementById('goCheckout').disabled = true;
    updateSummary(0);
    return;
  }

  // Ensure we have product info
  const items = [];
  for (const c of cart) {
    let p = productCache[c.id] || products.find(x => String(x.id) === c.id);
    if (!p) {
      try { p = await fetchProduct(c.id); } catch { p = { id: c.id, name: 'Product', price: 0, image_url: '' }; }
    }
    items.push({ ...c, product: p });
  }

  box.innerHTML = items.map(({ id, qty, product: p }) => `
    <div class="cart-item">
      <img src="${p.image_url || ''}" alt="" onerror="this.src='https://via.placeholder.com/80'">
      <div class="flex-grow-1">
        <div class="fw-semibold mb-1">${escapeHtml(p.name)}</div>
        <div class="text-muted small mb-2">${t('each', { p: formatPrice(p.price) })}</div>
        <div class="d-flex align-items-center gap-3">
          <div class="qty-box">
            <button type="button" class="q-minus" data-id="${id}">−</button>
            <input type="number" value="${qty}" min="1" class="q-val" data-id="${id}">
            <button type="button" class="q-plus" data-id="${id}">+</button>
          </div>
          <strong>${formatPrice(parseFloat(p.price) * qty)}</strong>
          <button class="btn btn-sm btn-outline-danger ms-auto rmv" data-id="${id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('.q-minus').forEach(b => b.onclick = () => {
    const it = cart.find(i => i.id === b.dataset.id);
    if (it) updateQty(b.dataset.id, it.qty - 1);
  });
  box.querySelectorAll('.q-plus').forEach(b => b.onclick = () => {
    const it = cart.find(i => i.id === b.dataset.id);
    if (it) updateQty(b.dataset.id, it.qty + 1);
  });
  box.querySelectorAll('.q-val').forEach(inp => {
    inp.onchange = () => updateQty(inp.dataset.id, +inp.value || 1);
  });
  box.querySelectorAll('.rmv').forEach(b => b.onclick = () => removeCart(b.dataset.id));

  const sub = cartSubtotal();
  updateSummary(sub);
  document.getElementById('goCheckout').disabled = false;
  document.getElementById('goCheckout').onclick = () => showView('checkout');
}

function updateSummary(sub) {
  const fee = deliveryFee(sub);
  document.getElementById('subTotal').textContent = formatPrice(sub);
  document.getElementById('delivFee').textContent = fee === 0 ? t('free') : formatPrice(fee);
  document.getElementById('grandTotal').textContent = formatPrice(sub + fee);
}

// ---------- Checkout ----------
async function renderCheckout() {
  if (cart.length === 0) { showView('cart'); return; }

  // Ensure prices
  for (const c of cart) {
    if (!productCache[c.id] && !products.find(x => String(x.id) === c.id)) {
      try { await fetchProduct(c.id); } catch {}
    }
  }

  const sub = cartSubtotal();
  const fee = deliveryFee(sub);

  document.getElementById('coItems').innerHTML = cart.map(c => {
    const p = productCache[c.id] || products.find(x => String(x.id) === c.id) || { name: 'Product', price: 0 };
    return `<div class="d-flex justify-content-between small mb-2">
      <span>${escapeHtml(p.name)} × ${c.qty}</span>
      <span>${formatPrice(parseFloat(p.price) * c.qty)}</span>
    </div>`;
  }).join('');

  document.getElementById('coSub').textContent = formatPrice(sub);
  document.getElementById('coFee').textContent = fee === 0 ? t('free') : formatPrice(fee);
  document.getElementById('coTotal').textContent = formatPrice(sub + fee);
}

function placeOrder() {
  const name = document.getElementById('cName').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  const email = document.getElementById('cEmail').value.trim();
  const address = document.getElementById('cAddress').value.trim();
  const city = document.getElementById('cCity').value.trim();
  const payment = document.querySelector('input[name="pay"]:checked')?.value || 'Cash on Delivery';

  if (!name || !phone || !email || !address || !city) {
    toast(t('fill_all'));
    return;
  }

  const items = cart.map(c => {
    const p = productCache[c.id] || products.find(x => String(x.id) === c.id) || { name: 'Product', price: 0 };
    return { id: c.id, name: p.name, price: parseFloat(p.price), qty: c.qty };
  });

  const sub = cartSubtotal();
  const fee = deliveryFee(sub);

  orders.unshift({
    id: 'AM' + Date.now().toString().slice(-6),
    date: new Date().toISOString(),
    buyer: { name, phone, email, address, city },
    payment,
    items,
    subtotal: sub,
    delivery: fee,
    total: sub + fee,
    status: 'Processing'
  });

  saveOrders();
  cart = [];
  saveCart();
  toast(t('order_ok'));
  showView('orders');
}

// ---------- Orders ----------
function renderOrders() {
  const box = document.getElementById('ordersList');
  if (orders.length === 0) {
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-box-open fa-3x text-muted mb-3"></i><h5>${t('no_orders')}</h5><button class="btn btn-orange mt-2" data-view="shop">${t('start_shopping')}</button></div>`;
    return;
  }
  box.innerHTML = orders.map(o => {
    const date = new Date(o.date).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const names = o.items.map(i => `${i.name} × ${i.qty}`).join(', ');
    const status = (I18N[getLang()] || {})['status_' + String(o.status).toLowerCase()] || o.status;
    const payLabel = o.payment === 'Cash on Delivery' ? t('cod') : t('card_label');
    return `<div class="order-card">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
        <div><strong>${t('order_no', { id: o.id })}</strong><div class="small text-muted">${date}</div></div>
        <span class="order-status">${status}</span>
      </div>
      <div class="small text-muted mb-2">${escapeHtml(names)}</div>
      <div class="d-flex justify-content-between"><strong>${formatPrice(o.total)}</strong><span class="small text-muted">${payLabel}</span></div>
    </div>`;
  }).join('');
}

// ---------- Wishlist ----------
function toggleWish(id) {
  id = String(id);
  const idx = wishlist.indexOf(id);
  if (idx >= 0) { wishlist.splice(idx, 1); toast(t('removed_wish')); }
  else { wishlist.push(id); toast(t('added_wish')); }
  saveWish();
}

async function renderWishlist() {
  document.getElementById('wishLabel').textContent = `(${wishlist.length})`;
  const box = document.getElementById('wishItems');

  if (wishlist.length === 0) {
    box.innerHTML = `<div class="col-12 text-center py-5"><i class="fa-regular fa-heart fa-3x text-muted mb-3"></i><h5>${t('wish_empty')}</h5><button class="btn btn-orange mt-2" data-view="shop">${t('browse_products')}</button></div>`;
    return;
  }

  box.innerHTML = `<div class="col-12 text-center py-4 text-muted">${t('loading')}</div>`;
  const items = [];
  for (const id of wishlist) {
    let p = productCache[id] || products.find(x => String(x.id) === id);
    if (!p) { try { p = await fetchProduct(id); } catch { continue; } }
    items.push(p);
  }
  box.innerHTML = items.map(cardHTML).join('') || `<div class="col-12 text-center py-4 text-muted">${t('no_items')}</div>`;
  bindCards(box);
}

// ---------- Init ----------
async function init() {
  loadLS();
  updateBadges();

  // Navigation (delegated so dynamically rendered [data-view] buttons work too)
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-view]');
    if (!el) return;
    e.preventDefault();
    if (el.dataset.view) showView(el.dataset.view);
  });

  // Mobile bottom toolbar
  document.querySelectorAll('.mobile-tabbar [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'search') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => document.getElementById('searchInput').focus({ preventScroll: true }), 350);
      } else if (tab === 'account') {
        if (localStorage.getItem('am_user')) showView('orders');
        else window.location.href = 'login.html';
      } else {
        showView(tab); // home | cart | wishlist
      }
    });
  });

  // Search (uses real API search)
  const doSearch = () => {
    searchQ = document.getElementById('searchInput').value.trim();
    currentCat = null;
    selectedBrand = null;
    currentPage = 1;
    showView('shop');
  };
  document.getElementById('searchBtn').onclick = doSearch;
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  document.getElementById('sortSelect')?.addEventListener('change', e => {
    sortBy = e.target.value;
    renderPageProducts();
  });

  document.getElementById('placeOrder')?.addEventListener('click', placeOrder);

  // Filters
  document.getElementById('priceRange')?.addEventListener('input', e => {
    maxPrice = +e.target.value;
    document.getElementById('priceLabel').textContent = maxPrice + ' DH';
    renderPageProducts();
  });

  document.getElementById('filterAvailable')?.addEventListener('change', e => {
    onlyAvailable = e.target.checked;
    renderPageProducts();
  });

  document.getElementById('filterPromo')?.addEventListener('change', e => {
    onlyPromo = e.target.checked;
    renderPageProducts();
  });

  document.getElementById('clearFilters')?.addEventListener('click', () => {
    maxPrice = 1000;
    onlyAvailable = true;
    onlyPromo = false;
    selectedBrand = null;
    searchQ = '';
    currentCat = null;
    currentPage = 1;
    document.getElementById('searchInput').value = '';
    document.getElementById('priceRange').value = 1000;
    document.getElementById('priceLabel').textContent = '1000 DH';
    document.getElementById('filterAvailable').checked = true;
    document.getElementById('filterPromo').checked = false;
    loadShopPage(1);
  });

  // Load categories + first products
  try {
    categories = await fetchCategories();
    const data = await fetchProducts(1);
    products = data.results || [];
  } catch (e) {
    console.error(e);
    document.getElementById('homeProducts').innerHTML =
      `<div class="col-12 text-center text-danger py-5">${t('api_error')}</div>`;
  }

  // Back to top
  const btt = document.getElementById('backToTop');
  if (btt) {
    window.addEventListener('scroll', () => {
      btt.classList.toggle('show', window.scrollY > 400);
    });
    btt.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  showView('home');
}

// ---------- Language ----------
window.addEventListener('am:langchange', () => {
  if (currentViewName === 'home') renderHome();
  else if (currentViewName === 'shop') {
    updateShopTitle();
    renderSidebar();
    renderFilterPanel(pageProducts);
    renderPageProducts();
  }
  else if (currentViewName === 'detail' && lastDetailId) openDetail(lastDetailId);
  else if (currentViewName === 'cart') renderCart();
  else if (currentViewName === 'checkout') renderCheckout();
  else if (currentViewName === 'orders') renderOrders();
  else if (currentViewName === 'wishlist') renderWishlist();
});

document.addEventListener('DOMContentLoaded', init);
