/**
 * AM MARKET — all-categories.js (all-categories.html)
 * Renders all categories in a full-page grid.
 */

async function initAllCategories() {
  const grid = document.getElementById('allCategoriesGrid');
  const countEl = document.getElementById('catCount');

  try {
    await ensureCategories();

    if (countEl) {
      countEl.textContent = categories.length + ' catégories disponibles';
    }

    grid.innerHTML = `<div class="all-cat-grid">
      ${categories.map(c => `
        <a class="all-cat-card" href="categories.html?cat=${c.id}">
          <div class="cat-icon">${getCatIcon(c)}</div>
          <div class="cat-name">${escapeHtml(catName(c.name))}</div>
          <span class="cat-count">${c.product_count || 0} produits</span>
        </a>
      `).join('')}
    </div>`;
  } catch (e) {
    grid.innerHTML = `<div class="col-12 text-center text-danger py-5">${t('failed_load')}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', initAllCategories);

window.addEventListener('am:langchange', () => {
  initAllCategories();
});
