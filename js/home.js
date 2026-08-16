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
  if (!slides.length || !dotsBox) return;
  dotsBox.innerHTML = slides.map((_, i) =>
    `<button class="hero-dot${i === 0 ? ' active' : ''}" data-i="${i}" aria-label="Slide ${i + 1}"></button>`).join('');
  let cur = 0;
  const go = i => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === cur));
    dotsBox.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('active', k === cur));
  };
  const restart = () => { clearInterval(heroTimer); heroTimer = setInterval(() => go(cur + 1), 5000); };
  dotsBox.querySelectorAll('.hero-dot').forEach(d => d.onclick = () => { go(+d.dataset.i); restart(); });
  restart();
}

// ---------- Categories grid ----------
function renderHomeCategories() {
  const grid = $('homeCategories');
  if (!grid) return;
  grid.innerHTML = categories.slice(0, 12).map(c => `
    <a class="cat-card" href="categories.html?cat=${c.id}">
      <div class="icon">${getCatIcon(c)}</div>
      <span>${escapeHtml(catName(c.name))}</span>
    </a>
  `).join('');
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
  await renderHomeProducts();
}

document.addEventListener('DOMContentLoaded', initHome);

window.addEventListener('am:langchange', () => {
  renderHomeCategories();
  renderRecent();
  renderHomeProducts();
});
