/**
 * AM MARKET — all-categories.js
 * Full category grid (links to categories.html?cat=).
 */

const RENTREE_CAT = 1363; // Fournitures Bureau

async function renderAllCategories() {
  const grid = $('allCatGrid');
  if (!grid) return;
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = Array.from({ length: 10 }, () => `<div class="all-cat-card is-skeleton" aria-hidden="true"><span class="skeleton-block cat-icon"></span><span class="skeleton-block skeleton-line"></span><span class="skeleton-block skeleton-line short"></span></div>`).join('');
  try {
    await ensureCategories();
    const sorted = [...categories].sort((a, b) => {
      if (a.id === RENTREE_CAT) return -1;
      if (b.id === RENTREE_CAT) return 1;
      return (a.name || '').localeCompare(b.name || '', getLang() === 'fr' ? 'fr' : 'en');
    });
    if (!sorted.length) {
      grid.innerHTML = `<div class="text-center text-muted py-5" style="grid-column:1/-1">${t('no_categories')}</div>`;
      return;
    }
    grid.innerHTML = sorted.map(c => `
      <a class="all-cat-card${c.id === RENTREE_CAT ? ' cat-highlight' : ''}" href="categories.html?cat=${c.id}">
        <div class="cat-icon">${getCatIcon(c)}</div>
        <div class="cat-name">${escapeHtml(catName(c.name))}</div>
        <div class="cat-count">${c.product_count || 0}</div>
      </a>
    `).join('');
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div class="text-center py-5" style="grid-column:1/-1"><p class="text-danger mb-2">${t('api_error')}</p><button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryCategories">${t('retry')}</button></div>`;
    $('retryCategories')?.addEventListener('click', renderAllCategories);
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

document.addEventListener('DOMContentLoaded', renderAllCategories);
window.addEventListener('am:langchange', renderAllCategories);
