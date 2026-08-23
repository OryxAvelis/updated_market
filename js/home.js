/**
 * AM MARKET — home.js (index.html)
 * Hero carousel, categories grid, recently viewed, first products page.
 * Header/footer/badges/cart state come from core.js.
 */

let homeProducts = [];
let recommendedProducts = [];

// ---------- Hero carousel ----------
let heroTimer = null;
let refreshHeroControls = () => {};
function initHeroCarousel() {
  const slides = [...document.querySelectorAll('.hero-slide')];
  const dotsBox = $('heroDots');
  const pauseBtn = $('heroPause');
  if (!slides.length || !dotsBox) return;
  dotsBox.innerHTML = slides.map((_, i) =>
    `<button class="hero-dot${i === 0 ? ' active' : ''}" data-i="${i}" aria-label="${escapeHtml(t('slide_label', { n: i + 1 }))}"></button>`).join('');
  let cur = 0;
  let userPaused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let interactionPaused = false;
  const go = i => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === cur));
    dotsBox.querySelectorAll('.hero-dot').forEach((d, k) => {
      const active = k === cur;
      d.classList.toggle('active', active);
      d.setAttribute('aria-pressed', String(active));
      if (active) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
      slides[k].setAttribute('aria-hidden', String(!active));
    });
  };
  const updatePauseButton = () => {
    if (!pauseBtn) return;
    const paused = userPaused || interactionPaused;
    pauseBtn.innerHTML = `<i class="fa-solid fa-${paused ? 'play' : 'pause'}"></i>`;
    pauseBtn.setAttribute('aria-label', t(paused ? 'play_carousel' : 'pause_carousel'));
    pauseBtn.title = t(paused ? 'play_carousel' : 'pause_carousel');
  };
  refreshHeroControls = () => {
    dotsBox.querySelectorAll('.hero-dot').forEach((dot, index) => {
      dot.setAttribute('aria-label', t('slide_label', { n: index + 1 }));
    });
    slides.forEach((slide, index) => {
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-label', t('slide_position', { n: index + 1, total: slides.length }));
    });
    go(cur);
    updatePauseButton();
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
  banner?.addEventListener('focusin', () => { interactionPaused = true; syncTimer(); });
  banner?.addEventListener('focusout', e => {
    if (!banner.contains(e.relatedTarget)) { interactionPaused = false; syncTimer(); }
  });
  document.addEventListener('visibilitychange', syncTimer);
  refreshHeroControls();
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
  box.setAttribute('aria-busy', 'true');
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
      box.removeAttribute('aria-busy');
      return;
    }
    box.innerHTML = list.map(cardHTML).join('');
    bindCards(box);
  } catch {
    box.innerHTML = '';
  } finally {
    box.removeAttribute('aria-busy');
  }
}

// ---------- Products ----------
async function renderHomeProducts() {
  const box = $('homeProducts');
  box.setAttribute('aria-busy', 'true');
  try {
    if (!homeProducts.length) {
      const data = await fetchProducts(1);
      homeProducts = data.results || [];
    }
    box.innerHTML = homeProducts.slice(0, 12).map(cardHTML).join('');
    bindCards(box, renderHomeProducts);
  } catch (e) {
    box.innerHTML = `<div class="col-12 text-center py-4">
      <p class="text-danger mb-2">${t('failed_load')}</p>
      <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryHomeProducts">${t('retry')}</button>
    </div>`;
    $('retryHomeProducts')?.addEventListener('click', renderHomeProducts);
  } finally {
    box.removeAttribute('aria-busy');
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

async function renderRecommendations() {
  const section = $('recommendSection');
  const box = $('recommendProducts');
  const heading = $('recommendHeading');
  if (!section || !box || !heading) return;
  heading.textContent = getLang() === 'fr' ? 'Recommandés pour vous' : 'Recommended for you';
  if (!getUser() || currentPreferences?.personalizationEnabled === false) {
    section.style.display = 'none';
    return;
  }
  box.setAttribute('aria-busy', 'true');
  try {
    const payload = await StoreAPI.recommendations.list({ limit: 4 });
    recommendedProducts = payload.products || [];
    if (!recommendedProducts.length) {
      section.style.display = 'none';
      return;
    }
    recommendedProducts.forEach(product => { productCache[product.id] = product; });
    box.innerHTML = recommendedProducts.map(cardHTML).join('');
    bindCards(box, renderRecommendations);
    section.style.display = 'block';
  } catch (error) {
    console.error(error);
    section.style.display = 'none';
  } finally {
    box.removeAttribute('aria-busy');
  }
}

// ---------- Init ----------
async function initHome() {
  initHeroCarousel();
  const homeBox = $('homeProducts');
  const seasonBox = $('seasonProducts');
  if (homeBox) homeBox.innerHTML = skeletonCards(8);
  if (seasonBox) seasonBox.innerHTML = skeletonCards(4);

  try {
    await ensureCategories();
    renderHomeCategories();
    renderSidebar(null);
  } catch (e) {
    console.error(e);
    $('homeProducts').innerHTML =
      `<div class="col-12 text-center py-5">
        <p class="text-danger mb-2">${t('api_error')}</p>
        <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryHomeLoad">${t('retry')}</button>
      </div>`;
    if (seasonBox) seasonBox.innerHTML = '';
    $('retryHomeLoad')?.addEventListener('click', () => location.reload());
    return;
  }

  renderRecent();
  await Promise.all([renderSeasonProducts(), renderHomeProducts(), renderRecommendations()]);
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(initHome));

window.addEventListener('am:langchange', () => {
  refreshHeroControls();
  renderHomeCategories();
  renderRecent();
  renderRecommendations();
  renderSeasonProducts();
  renderHomeProducts();
});
