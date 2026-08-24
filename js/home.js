/**
 * AM MARKET — home.js (index.html)
 * Hero carousel, categories grid, recently viewed, first products page.
 * Header/footer/badges/cart state come from core.js.
 */

let homeProducts = [];
let recommendedProducts = [];
let homeAccountRequestSequence = 0;

function homeStateHtml(messageKey, { error = false, retryId = '' } = {}) {
  const role = error ? 'alert' : 'status';
  const tone = error ? 'text-danger' : 'text-muted';
  return `<div class="col-12 text-center py-4">
    <p class="${tone} mb-2" role="${role}">${escapeHtml(t(messageKey))}</p>
    ${retryId ? `<button type="button" class="btn btn-outline-orange btn-sm state-action" id="${escapeHtml(retryId)}">${escapeHtml(t('retry'))}</button>` : ''}
  </div>`;
}

function bindHomeRetry(id, handler) {
  $(id)?.addEventListener('click', handler);
}

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
    <a class="cat-card${c.id === RENTREE_CAT_ID ? ' cat-highlight' : ''}" href="categories.html?cat=${encodeURIComponent(String(c.id))}">
      <div class="icon">${getCatIcon(c)}</div>
      <span>${escapeHtml(catName(c.name))}</span>
    </a>
  `).join('');
}

async function loadHomeCategories({ restoreFocus = false } = {}) {
  const grid = $('homeCategories');
  if (!grid) return;
  grid.setAttribute('aria-busy', 'true');
  try {
    await ensureCategories();
    renderHomeCategories();
    renderSidebar(null);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        const heading = grid.previousElementSibling?.querySelector('h2');
        if (!heading) return;
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      });
    }
  } catch (error) {
    console.error('Home category load failed', error);
    grid.innerHTML = `<div class="text-center py-4" style="grid-column:1/-1" role="alert">
      <p class="text-danger mb-2">${escapeHtml(t('api_error'))}</p>
      <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryHomeCategories">${escapeHtml(t('retry'))}</button>
    </div>`;
    const retry = $('retryHomeCategories');
    retry?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      loadHomeCategories({ restoreFocus: true });
    });
    if (restoreFocus) requestAnimationFrame(() => retry?.focus({ preventScroll: true }));
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

// ---------- Seasonal products (real catalogue, no fake promos) ----------
async function renderSeasonProducts() {
  const box = $('seasonProducts');
  if (!box) return;
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = skeletonCards(4);
  try {
    let list = [];
    let requestSucceeded = false;
    try {
      const data = await fetchProducts(1, RENTREE_CAT_ID);
      list = data.results || [];
      requestSucceeded = true;
    } catch { /* the search fallback below can still populate the section */ }
    if (list.length < 4) {
      try {
        const extra = await fetchProducts(1, null, 'stylo');
        const more = (extra.results || []).filter(p => !list.find(x => String(x.id) === String(p.id)));
        list = list.concat(more);
        requestSucceeded = true;
      } catch { /* retain any products returned by the primary request */ }
    }
    list = list.slice(0, 4);
    if (!list.length) {
      if (!requestSucceeded) throw new Error('Seasonal product requests failed');
      box.innerHTML = homeStateHtml('season_products_empty', { retryId: 'retrySeasonProducts' });
      bindHomeRetry('retrySeasonProducts', renderSeasonProducts);
      return;
    }
    box.innerHTML = list.map(cardHTML).join('');
    bindCards(box);
  } catch (error) {
    console.error(error);
    box.innerHTML = homeStateHtml('season_products_error', { error: true, retryId: 'retrySeasonProducts' });
    bindHomeRetry('retrySeasonProducts', renderSeasonProducts);
  } finally {
    box.removeAttribute('aria-busy');
  }
}

// ---------- Products ----------
async function renderHomeProducts() {
  const box = $('homeProducts');
  if (!box) return;
  box.setAttribute('aria-busy', 'true');
  try {
    if (!homeProducts.length) {
      box.innerHTML = skeletonCards(8);
      const data = await fetchProducts(1);
      homeProducts = data.results || [];
    }
    if (!homeProducts.length) {
      box.innerHTML = homeStateHtml('home_products_empty', { retryId: 'retryHomeProducts' });
      bindHomeRetry('retryHomeProducts', renderHomeProducts);
      return;
    }
    box.innerHTML = homeProducts.slice(0, 12).map(cardHTML).join('');
    bindCards(box, renderHomeProducts);
  } catch (e) {
    console.error(e);
    box.innerHTML = homeStateHtml('failed_load', { error: true, retryId: 'retryHomeProducts' });
    bindHomeRetry('retryHomeProducts', renderHomeProducts);
  } finally {
    box.removeAttribute('aria-busy');
  }
}

// ---------- Recently viewed ----------
function renderRecent({ restoreFocus = false } = {}) {
  const section = $('recentSection');
  const box = $('recentProducts');
  if (!section || !box) return;
  if (getUser() && getAuthenticatedResourceState('recent') === 'error') {
    section.style.display = 'block';
    box.innerHTML = `<div class="col-12 text-center py-4" role="alert">
      <p class="text-danger mb-2">${escapeHtml(accountRecoveryMessage(['recent']))}</p>
      <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryAccountRecent">${escapeHtml(t('retry'))}</button>
    </div>`;
    $('retryAccountRecent')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      await retryAuthenticatedResources();
      renderRecent({ restoreFocus: true });
    });
    if (restoreFocus) requestAnimationFrame(() => $('retryAccountRecent')?.focus({ preventScroll: true }));
    return;
  }
  const list = getRecent();
  if (list.length === 0) {
    section.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  section.style.display = 'block';
  list.forEach(p => { productCache[p.id] = p; }); // snapshots → add-to-cart has price/name
  box.innerHTML = list.slice(0, 4).map(cardHTML).join('');
  bindCards(box);
  if (restoreFocus) {
    requestAnimationFrame(() => {
      const heading = section.querySelector('h2');
      if (!heading) return;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    });
  }
}

async function renderRecommendations() {
  const requestSequence = ++homeAccountRequestSequence;
  const section = $('recommendSection');
  const box = $('recommendProducts');
  const heading = $('recommendHeading');
  if (!section || !box || !heading) return;
  heading.textContent = t('recommendations_heading');
  if (!getUser() || currentPreferences?.personalizationEnabled === false) {
    section.style.display = 'none';
    box.innerHTML = '';
    box.removeAttribute('aria-busy');
    return;
  }
  section.style.display = 'block';
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = skeletonCards(4);
  const authContext = captureAuthenticatedRequest();
  try {
    const payload = await StoreAPI.recommendations.list({ limit: 4 });
    if (requestSequence !== homeAccountRequestSequence || !isAuthenticatedRequestCurrent(authContext)) return;
    recommendedProducts = payload.products || [];
    if (!recommendedProducts.length) {
      box.innerHTML = homeStateHtml('recommendations_empty', { retryId: 'retryRecommendations' });
      bindHomeRetry('retryRecommendations', renderRecommendations);
      return;
    }
    recommendedProducts.forEach(product => { productCache[product.id] = product; });
    box.innerHTML = recommendedProducts.map(cardHTML).join('');
    bindCards(box, renderRecommendations);
    section.style.display = 'block';
  } catch (error) {
    if (handleStoreUnauthorized(error)) return;
    if (requestSequence !== homeAccountRequestSequence || !isAuthenticatedRequestCurrent(authContext)) return;
    console.error(error);
    box.innerHTML = homeStateHtml('recommendations_error', { error: true, retryId: 'retryRecommendations' });
    bindHomeRetry('retryRecommendations', renderRecommendations);
  } finally {
    if (requestSequence === homeAccountRequestSequence) box.removeAttribute('aria-busy');
  }
}

// ---------- Init ----------
async function initHome() {
  initHeroCarousel();
  const homeBox = $('homeProducts');
  const seasonBox = $('seasonProducts');
  if (homeBox) homeBox.innerHTML = skeletonCards(8);
  if (seasonBox) seasonBox.innerHTML = skeletonCards(4);

  renderRecent();
  await Promise.all([
    loadHomeCategories(),
    renderSeasonProducts(),
    renderHomeProducts(),
    renderRecommendations()
  ]);
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(initHome));

window.addEventListener('am:langchange', () => {
  refreshHeroControls();
  if (categories.length) renderHomeCategories();
  else loadHomeCategories();
  renderRecent();
  renderRecommendations();
  renderSeasonProducts();
  renderHomeProducts();
});

window.addEventListener('am:account-resources-recovered', event => {
  if (event.detail?.resources?.includes('recent')) renderRecent({ restoreFocus: true });
});

window.addEventListener('am:session-expired', () => {
  homeAccountRequestSequence += 1;
  recommendedProducts = [];
  const privateSectionHadFocus = $('recentSection')?.contains(document.activeElement) ||
    $('recommendSection')?.contains(document.activeElement);
  renderRecent();
  renderRecommendations();
  if (privateSectionHadFocus) {
    requestAnimationFrame(() => {
      const heading = document.querySelector('main h1');
      if (!heading) return;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    });
  }
});
