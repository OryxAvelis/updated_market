/**
 * AM MARKET — home.js (index.html)
 * Hero carousel, categories grid, recently viewed, first products page.
 * Header/footer/badges/cart state come from core.js.
 */

let homeProducts = [];

// ---------- Hero carousel ----------
let heroTimer = null;
function initHeroCarousel() {
  const slides = [...document.querySelectorAll('.hero-slide')];
  const dotsBox = $('heroDots');
  const pauseBtn = $('heroPause');
  if (!slides.length || !dotsBox) return;
  dotsBox.innerHTML = slides.map((_, i) =>
    `<button class="hero-dot${i === 0 ? ' active' : ''}" data-i="${i}" aria-label="Slide ${i + 1}"></button>`).join('');
  let cur = 0;
  let userPaused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let interactionPaused = false;
  const go = i => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === cur));
    dotsBox.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('active', k === cur));
  };
  const updatePauseButton = () => {
    if (!pauseBtn) return;
    const paused = userPaused || interactionPaused;
    pauseBtn.innerHTML = `<i class="fa-solid fa-${paused ? 'play' : 'pause'}"></i>`;
    pauseBtn.setAttribute('aria-label', t(paused ? 'play_carousel' : 'pause_carousel'));
    pauseBtn.title = t(paused ? 'play_carousel' : 'pause_carousel');
  };
  const syncTimer = () => {
    clearInterval(heroTimer);
    heroTimer = null;
    if (!userPaused && !interactionPaused && !document.hidden) {
      heroTimer = setInterval(() => go(cur + 1), 6000);
    }
    updatePauseButton();
  };
  dotsBox.querySelectorAll('.hero-dot').forEach(d => d.onclick = () => { go(+d.dataset.i); syncTimer(); });
  pauseBtn?.addEventListener('click', () => { userPaused = !userPaused; syncTimer(); });
  const banner = document.querySelector('.hero-banner');
  banner?.addEventListener('mouseenter', () => { interactionPaused = true; syncTimer(); });
  banner?.addEventListener('mouseleave', () => { interactionPaused = false; syncTimer(); });
  banner?.addEventListener('focusin', e => {
    if (e.target !== pauseBtn) { interactionPaused = true; syncTimer(); }
  });
  banner?.addEventListener('focusout', e => {
    if (!banner.contains(e.relatedTarget)) { interactionPaused = false; syncTimer(); }
  });
  document.addEventListener('visibilitychange', syncTimer);
  syncTimer();
}

// ---------- Categories grid (Fournitures Bureau first for rentrée) ----------
const RENTREE_CAT_ID = 1363; // Fournitures Bureau
function renderHomeCategories() {
  const grid = $('homeCategories');
  if (!grid) return;
  const sorted = [...categories].sort((a, b) => {
    if (a.id === RENTREE_CAT_ID) return -1;
    if (b.id === RENTREE_CAT_ID) return 1;
    return 0;
  });
  grid.innerHTML = sorted.slice(0, 12).map(c => `
    <a class="cat-card${c.id === RENTREE_CAT_ID ? ' cat-highlight' : ''}" href="categories.html?cat=${c.id}">
      <div class="icon">${getCatIcon(c)}</div>
      <span>${escapeHtml(catName(c.name))}</span>
    </a>
  `).join('');
}

// ---------- Seasonal products (real catalogue, no fake promos) ----------
async function renderSeasonProducts() {
  const box = $('seasonProducts');
  if (!box) return;
  try {
    let list = [];
    try {
      const data = await fetchProducts(1, RENTREE_CAT_ID);
      list = data.results || [];
    } catch { /* ignore */ }
    if (list.length < 4) {
      const extra = await fetchProducts(1, null, 'stylo');
      const more = (extra.results || []).filter(p => !list.find(x => String(x.id) === String(p.id)));
      list = list.concat(more);
    }
    list = list.slice(0, 4);
    if (!list.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = list.map(cardHTML).join('');
    bindCards(box);
  } catch {
    box.innerHTML = '';
  }
}

// ---------- Products ----------
async function renderHomeProducts() {
  const box = $('homeProducts');
  try {
    if (!homeProducts.length) {
      const data = await fetchProducts(1);
      homeProducts = data.results || [];
    }
    box.innerHTML = homeProducts.slice(0, 12).map(cardHTML).join('');
    bindCards(box, renderHomeProducts);
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center text-danger py-4">${t('failed_load')}</div>`;
  }
}

// ---------- Recently viewed ----------
function renderRecent() {
  const section = $('recentSection');
  const box = $('recentProducts');
  if (!section || !box) return;
  const list = getRecent();
  if (list.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  list.forEach(p => { productCache[p.id] = p; }); // snapshots → add-to-cart has price/name
  box.innerHTML = list.slice(0, 4).map(cardHTML).join('');
  bindCards(box);
}

// ---------- Init ----------
async function initHome() {
  initHeroCarousel();

  try {
    await ensureCategories();
    renderHomeCategories();
    renderSidebar(null);
  } catch (e) {
    console.error(e);
    const fileHint = location.protocol === 'file:'
      ? '<br><small class="text-muted">file:// detected — if this persists, a browser extension/setting is blocking the request. Try an Incognito window or http://localhost.</small>'
      : '';
    $('homeProducts').innerHTML =
      `<div class="col-12 text-center text-danger py-5">${t('api_error')}${fileHint}</div>`;
    return;
  }

  renderRecent();
  await Promise.all([renderSeasonProducts(), renderHomeProducts()]);
}

document.addEventListener('DOMContentLoaded', initHome);

window.addEventListener('am:langchange', () => {
  renderHomeCategories();
  renderRecent();
  renderSeasonProducts();
  renderHomeProducts();
});
