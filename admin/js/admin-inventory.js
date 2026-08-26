/**
 * Inventory admin page.
 * Catalog availability is read-only; overrides and optional quantities remain localStorage-only.
 */
(() => {
  'use strict';

  Object.assign(I18N.en, {
    title_admin_inventory: 'Inventory — AM MARKET Admin',
    admin_inventory_kicker: 'Live catalog view',
    admin_inventory_title: 'Inventory',
    admin_inventory_intro: 'Review catalog availability and add optional browser-local stock notes.',
    admin_refresh_catalog: 'Refresh catalog',
    admin_inventory_local_note: 'Inventory overrides and optional quantities are stored only in this browser. They do not update api.mmarket.ma or storefront availability.',
    admin_inventory_search_label: 'Search catalog',
    admin_inventory_search_placeholder: 'Product, brand or category',
    admin_inventory_filter_label: 'Stock state',
    admin_inventory_all_states: 'All states',
    admin_inventory_state_in: 'In stock',
    admin_inventory_state_low: 'Low stock',
    admin_inventory_state_out: 'Out of stock',
    admin_inventory_state_not_tracked: 'Not tracked',
    admin_clear_filters: 'Clear filters',
    admin_inventory_loading: 'Loading the live catalog…',
    admin_inventory_loading_progress: 'Loaded {loaded} of {total} catalog batches.',
    admin_inventory_table_caption: 'Live catalog with browser-local inventory controls',
    admin_inventory_col_product: 'Product',
    admin_inventory_col_category: 'Category',
    admin_inventory_col_catalog: 'Catalog',
    admin_inventory_col_local_state: 'Local state',
    admin_inventory_col_quantity: 'Optional quantity',
    admin_inventory_col_updated: 'Local update',
    admin_actions: 'Actions',
    admin_inventory_pagination: 'Inventory pages',
    admin_previous: 'Previous',
    admin_next: 'Next',
    admin_inventory_count: '{shown} matching products of {total}',
    admin_inventory_count_sample: '{shown} matching products in {loaded} loaded catalog products ({total} total)',
    admin_inventory_page: 'Page {page} of {pages}',
    admin_inventory_empty_title: 'No catalog products found',
    admin_inventory_empty_text: 'The read-only catalog returned no products.',
    admin_inventory_filtered_title: 'No matching inventory records',
    admin_inventory_filtered_text: 'Try another search or stock-state filter.',
    admin_inventory_error_title: 'Catalog unavailable',
    admin_inventory_error_text: 'The live read-only catalog could not be loaded. Local overrides were not changed.',
    admin_retry: 'Retry',
    admin_inventory_catalog_state: 'Use catalog: {state}',
    admin_inventory_quantity_label: 'Optional local quantity for {product}',
    admin_inventory_state_label: 'Local stock state for {product}',
    admin_inventory_save_label: 'Store local inventory note for {product}',
    admin_inventory_cancel_label: 'Cancel unsaved changes for {product}',
    admin_inventory_save: 'Save local',
    admin_cancel: 'Cancel',
    admin_inventory_saving: 'Storing…',
    admin_inventory_quantity_hint: 'Blank means not tracked',
    admin_inventory_quantity_invalid: 'Enter a whole number of zero or more, or leave it blank.',
    admin_inventory_never_updated: 'No local override',
    admin_inventory_updated_local: 'Updated locally {date}',
    admin_inventory_stored: 'Inventory note for {product} was stored in this browser only.',
    admin_inventory_cleared: 'The local inventory override for {product} was removed.',
    admin_inventory_unchanged: 'No local inventory changes were needed for {product}.',
    admin_inventory_store_failed: 'The local inventory note could not be stored.',
    admin_inventory_clear_title: 'Use live catalog state?',
    admin_inventory_clear_confirm: 'This removes the local inventory override for {product}. The live catalog state will be shown again.',
    admin_inventory_use_catalog: 'Use catalog state',
    admin_inventory_refreshed: 'The live catalog view was refreshed.',
    admin_inventory_product_missing: 'This product is no longer in the loaded catalog.',
    admin_inventory_catalog_available: 'Available',
    admin_inventory_catalog_unavailable: 'Unavailable',
    admin_inventory_id: 'ID {id}',
    admin_not_available: 'Not available'
  });

  Object.assign(I18N.fr, {
    title_admin_inventory: 'Stock — Administration AM MARKET',
    admin_inventory_kicker: 'Vue du catalogue réel',
    admin_inventory_title: 'Stock',
    admin_inventory_intro: 'Consultez la disponibilité du catalogue et ajoutez des notes de stock locales facultatives.',
    admin_refresh_catalog: 'Actualiser le catalogue',
    admin_inventory_local_note: 'Les états et quantités facultatives sont stockés uniquement dans ce navigateur. Ils ne modifient ni api.mmarket.ma ni la disponibilité de la boutique.',
    admin_inventory_search_label: 'Rechercher dans le catalogue',
    admin_inventory_search_placeholder: 'Produit, marque ou catégorie',
    admin_inventory_filter_label: 'État du stock',
    admin_inventory_all_states: 'Tous les états',
    admin_inventory_state_in: 'En stock',
    admin_inventory_state_low: 'Stock faible',
    admin_inventory_state_out: 'Rupture de stock',
    admin_inventory_state_not_tracked: 'Non suivi',
    admin_clear_filters: 'Effacer les filtres',
    admin_inventory_loading: 'Chargement du catalogue réel…',
    admin_inventory_loading_progress: '{loaded} lot(s) du catalogue sur {total} chargé(s).',
    admin_inventory_table_caption: 'Catalogue réel avec contrôles de stock locaux au navigateur',
    admin_inventory_col_product: 'Produit',
    admin_inventory_col_category: 'Catégorie',
    admin_inventory_col_catalog: 'Catalogue',
    admin_inventory_col_local_state: 'État local',
    admin_inventory_col_quantity: 'Quantité facultative',
    admin_inventory_col_updated: 'Mise à jour locale',
    admin_actions: 'Actions',
    admin_inventory_pagination: 'Pages du stock',
    admin_previous: 'Précédent',
    admin_next: 'Suivant',
    admin_inventory_count: '{shown} produit(s) correspondant(s) sur {total}',
    admin_inventory_count_sample: '{shown} produit(s) correspondant(s) parmi {loaded} produits chargés ({total} au catalogue)',
    admin_inventory_page: 'Page {page} sur {pages}',
    admin_inventory_empty_title: 'Aucun produit dans le catalogue',
    admin_inventory_empty_text: 'Le catalogue en lecture seule n’a retourné aucun produit.',
    admin_inventory_filtered_title: 'Aucune fiche de stock correspondante',
    admin_inventory_filtered_text: 'Essayez une autre recherche ou un autre filtre d’état.',
    admin_inventory_error_title: 'Catalogue indisponible',
    admin_inventory_error_text: 'Le catalogue réel en lecture seule n’a pas pu être chargé. Les états locaux n’ont pas été modifiés.',
    admin_retry: 'Réessayer',
    admin_inventory_catalog_state: 'Utiliser le catalogue : {state}',
    admin_inventory_quantity_label: 'Quantité locale facultative pour {product}',
    admin_inventory_state_label: 'État de stock local pour {product}',
    admin_inventory_save_label: 'Stocker la note de stock locale pour {product}',
    admin_inventory_cancel_label: 'Annuler les modifications non enregistrées pour {product}',
    admin_inventory_save: 'Stocker localement',
    admin_cancel: 'Annuler',
    admin_inventory_saving: 'Stockage…',
    admin_inventory_quantity_hint: 'Vide signifie non suivi',
    admin_inventory_quantity_invalid: 'Saisissez un nombre entier positif ou nul, ou laissez le champ vide.',
    admin_inventory_never_updated: 'Aucun état local',
    admin_inventory_updated_local: 'Mis à jour localement le {date}',
    admin_inventory_stored: 'La note de stock pour {product} a été stockée uniquement dans ce navigateur.',
    admin_inventory_cleared: 'L’état de stock local de {product} a été supprimé.',
    admin_inventory_unchanged: 'Aucune modification locale du stock n’était nécessaire pour {product}.',
    admin_inventory_store_failed: 'La note de stock locale n’a pas pu être stockée.',
    admin_inventory_clear_title: 'Utiliser l’état du catalogue réel ?',
    admin_inventory_clear_confirm: 'Cette action supprime l’état local de {product}. L’état du catalogue réel sera de nouveau affiché.',
    admin_inventory_use_catalog: 'Utiliser le catalogue',
    admin_inventory_refreshed: 'La vue du catalogue réel a été actualisée.',
    admin_inventory_product_missing: 'Ce produit ne figure plus dans le catalogue chargé.',
    admin_inventory_catalog_available: 'Disponible',
    admin_inventory_catalog_unavailable: 'Indisponible',
    admin_inventory_id: 'ID {id}',
    admin_not_available: 'Non disponible'
  });

  const PAGE_SIZE = 12;
  const API_PAGE_SIZE = 100;
  const MAX_API_PAGES = 30;
  const LOCAL_STATES = ['in', 'low', 'out', 'not-tracked'];
  let storageKey = 'am_admin_inventory_v1';

  let catalogProducts = [];
  let catalogTotalCount = 0;
  let catalogComplete = false;
  let categoryNames = new Map();
  let overrides = {};
  let currentPage = 1;
  let loadSequence = 0;
  let initialized = false;

  const byId = id => document.getElementById(id);
  const esc = value => AdminCore.escape(value == null ? '' : String(value));
  const clean = value => value == null ? '' : String(value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();

  function readOverrides() {
    const value = AdminCore.read(storageKey, {});
    overrides = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function mergeProductOverlay(products) {
    const value = AdminCore.read(AdminCore.storageKeys.products, {});
    const source = value && typeof value === 'object' ? value : {};
    const created = Array.isArray(source.created) ? source.created.filter(item => item && item.id != null) : [];
    const patches = source.patches && typeof source.patches === 'object' && !Array.isArray(source.patches) ? source.patches : {};
    const hidden = new Set((Array.isArray(source.hiddenIds) ? source.hiddenIds : []).map(String));
    const seen = new Set();
    const merged = [];

    products.forEach(product => {
      if (!product || product.id == null) return;
      const id = String(product.id);
      if (hidden.has(id)) return;
      const patch = patches[id];
      merged.push(patch && typeof patch === 'object' ? { ...product, ...patch, id: product.id } : product);
      seen.add(id);
    });

    Object.entries(patches).forEach(([id, patch]) => {
      if (hidden.has(String(id)) || seen.has(String(id)) || !patch || typeof patch !== 'object' || !clean(patch.name)) return;
      merged.push({ ...patch, id });
      seen.add(String(id));
    });

    created.forEach(product => {
      const id = String(product.id);
      if (hidden.has(id) || seen.has(id)) return;
      merged.push({ ...product, id });
      seen.add(id);
    });

    return {
      products: merged,
      totalDelta: created.filter(product => !hidden.has(String(product.id))).length
        - [...hidden].filter(id => !id.startsWith('local-product-')).length
    };
  }

  function baseState(product) {
    return product?.is_available === false ? 'out' : 'in';
  }

  function validOverride(productId) {
    const value = overrides[String(productId)];
    return value && typeof value === 'object' && LOCAL_STATES.includes(value.state) ? value : null;
  }

  function effectiveState(product) {
    return validOverride(product?.id)?.state || baseState(product);
  }

  function stateLabel(state) {
    const key = {
      in: 'admin_inventory_state_in',
      low: 'admin_inventory_state_low',
      out: 'admin_inventory_state_out',
      'not-tracked': 'admin_inventory_state_not_tracked'
    }[state];
    return t(key || 'admin_inventory_state_not_tracked');
  }

  function categoryId(product) {
    const value = product?.category_id ?? product?.category?.id ?? product?.category;
    return value == null || typeof value === 'object' ? '' : String(value);
  }

  function categoryName(product) {
    return clean(product?.category_name)
      || clean(product?.category?.name)
      || categoryNames.get(categoryId(product))
      || t('admin_not_available');
  }

  function productSearchText(product) {
    return normalized([
      product?.name,
      product?.brand_name,
      product?.sku,
      product?.barcode,
      product?.id,
      categoryName(product)
    ].filter(Boolean).join(' '));
  }

  function filteredProducts() {
    const query = normalized(byId('adminInventorySearch')?.value);
    const filter = byId('adminInventoryFilter')?.value || 'all';
    return catalogProducts
      .filter(product => !query || productSearchText(product).includes(query))
      .filter(product => filter === 'all' || effectiveState(product) === filter);
  }

  function showLoading(progress = '') {
    const state = byId('adminInventoryState');
    byId('adminInventoryTableWrap').hidden = true;
    byId('adminInventoryPagination').hidden = true;
    state.hidden = false;
    AdminCore.state(state, {
      type: 'loading',
      title: t('admin_inventory_loading'),
      body: progress
    });
  }

  function showState(kind, titleKey, textKey, retry = false) {
    const state = byId('adminInventoryState');
    byId('adminInventoryTableWrap').hidden = true;
    byId('adminInventoryPagination').hidden = true;
    state.hidden = false;
    AdminCore.state(state, {
      type: kind,
      title: t(titleKey),
      body: t(textKey),
      actionLabel: retry ? t('admin_retry') : '',
      onAction: retry ? loadCatalog : null
    });
  }

  function quantityValue(override) {
    if (!override || override.quantity == null || override.quantity === '') return '';
    const raw = String(override.quantity);
    return /^\d+$/.test(raw) ? raw : '';
  }

  function inventoryRow(product, index) {
    const id = String(product.id);
    const override = validOverride(id);
    const catalogState = baseState(product);
    const selectedState = override?.state || 'catalog';
    const quantity = quantityValue(override);
    const stateControlId = `adminInventoryState-${index}`;
    const quantityControlId = `adminInventoryQuantity-${index}`;
    const formId = `adminInventoryForm-${index}`;
    const productName = clean(product.name) || t('admin_not_available');
    const stateDisabled = selectedState === 'catalog' || selectedState === 'not-tracked';
    const localUpdate = override?.updatedAt
      ? t('admin_inventory_updated_local', { date: AdminCore.formatDate(override.updatedAt) })
      : t('admin_inventory_never_updated');

    return `<tr data-product-row="${esc(id)}">
      <td data-label="${esc(t('admin_inventory_col_product'))}">
        <div class="admin-inventory-product">
          <img class="admin-inventory-product-image" src="${esc(product.image_url || '../img/placeholder.svg')}" alt="" width="48" height="48" loading="lazy">
          <div><span class="admin-inventory-product-name">${esc(productName)}</span><span class="admin-inventory-product-meta">${esc(product.brand_name || t('admin_inventory_id', { id }))}</span></div>
        </div>
      </td>
      <td data-label="${esc(t('admin_inventory_col_category'))}">${esc(categoryName(product))}</td>
      <td data-label="${esc(t('admin_inventory_col_catalog'))}">
        <span class="admin-inventory-state-badge" data-state="${catalogState}">${esc(t(catalogState === 'out' ? 'admin_inventory_catalog_unavailable' : 'admin_inventory_catalog_available'))}</span>
      </td>
      <td data-label="${esc(t('admin_inventory_col_local_state'))}" class="admin-inventory-edit">
        <label class="visually-hidden" for="${stateControlId}">${esc(t('admin_inventory_state_label', { product: productName }))}</label>
        <select id="${stateControlId}" class="admin-select admin-inventory-state-select" name="state" form="${formId}" data-product-id="${esc(id)}">
          <option value="catalog" ${selectedState === 'catalog' ? 'selected' : ''}>${esc(t('admin_inventory_catalog_state', { state: stateLabel(catalogState) }))}</option>
          ${LOCAL_STATES.map(state => `<option value="${state}" ${selectedState === state ? 'selected' : ''}>${esc(stateLabel(state))}</option>`).join('')}
        </select>
      </td>
      <td data-label="${esc(t('admin_inventory_col_quantity'))}" class="admin-inventory-quantity">
        <label class="visually-hidden" for="${quantityControlId}">${esc(t('admin_inventory_quantity_label', { product: productName }))}</label>
        <input id="${quantityControlId}" class="admin-input admin-inventory-quantity-input" name="quantity" form="${formId}" type="number" min="0" step="1" inputmode="numeric" value="${esc(quantity)}" ${stateDisabled ? 'disabled' : ''}>
        <small>${esc(t('admin_inventory_quantity_hint'))}</small>
        <p class="admin-inventory-error" data-inventory-error="${esc(id)}" role="alert"></p>
      </td>
      <td data-label="${esc(t('admin_inventory_col_updated'))}" class="admin-inventory-updated"><small>${esc(localUpdate)}</small></td>
      <td data-label="${esc(t('admin_actions'))}">
        <form id="${formId}" class="admin-inventory-row-form" data-product-id="${esc(id)}"></form>
        <div class="admin-inventory-actions">
          <button class="admin-button admin-button--primary" type="submit" form="${formId}" data-inventory-save="${esc(id)}" aria-label="${esc(t('admin_inventory_save_label', { product: productName }))}">${esc(t('admin_inventory_save'))}</button>
          <button class="admin-button admin-button--secondary" type="button" data-inventory-cancel="${esc(id)}" aria-label="${esc(t('admin_inventory_cancel_label', { product: productName }))}">${esc(t('admin_cancel'))}</button>
        </div>
      </td>
    </tr>`;
  }

  function renderInventory() {
    const filtered = filteredProducts();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageProducts = filtered.slice(start, start + PAGE_SIZE);

    byId('adminInventoryCount').textContent = t(catalogComplete ? 'admin_inventory_count' : 'admin_inventory_count_sample', {
      shown: filtered.length,
      loaded: catalogProducts.length,
      total: catalogComplete ? catalogProducts.length : catalogTotalCount
    });

    if (!catalogProducts.length) {
      showState('empty', 'admin_inventory_empty_title', 'admin_inventory_empty_text');
      return;
    }
    if (!filtered.length) {
      showState('empty', 'admin_inventory_filtered_title', 'admin_inventory_filtered_text');
      return;
    }

    const tableBody = byId('adminInventoryBody');
    tableBody.innerHTML = pageProducts.map(inventoryRow).join('');
    tableBody.querySelectorAll('.admin-inventory-product-image').forEach(image => {
      image.addEventListener('error', () => { image.src = '../img/placeholder.svg'; }, { once: true });
    });
    byId('adminInventoryState').hidden = true;
    byId('adminInventoryTableWrap').hidden = false;

    const pagination = byId('adminInventoryPagination');
    pagination.hidden = false;
    byId('adminInventoryPageLabel').textContent = t('admin_inventory_page', { page: currentPage, pages: totalPages });
    byId('adminInventoryPrev').disabled = currentPage <= 1;
    byId('adminInventoryNext').disabled = currentPage >= totalPages;
  }

  function buildCategoryMap() {
    const flattened = AdminCore.flattenCategories(Array.isArray(categories) ? categories : []);
    categoryNames = new Map(flattened
      .filter(category => category?.id != null)
      .map(category => [String(category.id), clean(category.name || category.title)]));
  }

  async function loadCatalog(event) {
    const sequence = ++loadSequence;
    const refreshButton = byId('adminInventoryRefresh');
    const isRefresh = Boolean(event);
    AdminCore.setBusy(refreshButton, true, t('admin_inventory_loading'));
    showLoading();

    try {
      const categoriesTask = ensureCategories()
        .then(buildCategoryMap)
        .catch(() => { categoryNames = new Map(); });
      const first = await fetchProducts(1, null, '', '', API_PAGE_SIZE);
      if (sequence !== loadSequence) return;
      if (!first || !Array.isArray(first.results)) throw new TypeError('Invalid catalog response');

      const totalCount = Math.max(first.results.length, Number(first.count) || 0);
      const effectivePageSize = Math.max(1, first.results.length);
      const availableBatches = Math.max(1, Math.ceil(totalCount / effectivePageSize));
      const totalBatches = Math.min(availableBatches, MAX_API_PAGES);
      const batches = new Array(totalBatches);
      batches[0] = first.results;
      let nextBatch = 2;
      let loadedBatches = 1;

      const worker = async () => {
        while (nextBatch <= totalBatches) {
          const page = nextBatch;
          nextBatch += 1;
          const response = await fetchProducts(page, null, '', '', API_PAGE_SIZE);
          if (!response || !Array.isArray(response.results)) throw new TypeError('Invalid catalog response');
          batches[page - 1] = response.results;
          loadedBatches += 1;
          if (sequence === loadSequence) {
            showLoading(t('admin_inventory_loading_progress', { loaded: loadedBatches, total: totalBatches }));
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, Math.max(0, totalBatches - 1)) }, worker));
      await categoriesTask;
      if (sequence !== loadSequence) return;

      const unique = new Map();
      batches.flat().forEach(product => {
        if (product?.id != null) unique.set(String(product.id), product);
      });
      const mergedCatalog = mergeProductOverlay([...unique.values()]);
      catalogProducts = mergedCatalog.products.sort((a, b) => clean(a.name).localeCompare(clean(b.name), getLang?.() === 'fr' ? 'fr' : 'en'));
      catalogTotalCount = Math.max(0, totalCount + mergedCatalog.totalDelta);
      catalogComplete = catalogProducts.length >= catalogTotalCount;
      currentPage = 1;
      renderInventory();
      if (isRefresh) AdminCore.toast(t('admin_inventory_refreshed'), 'success');
    } catch {
      if (sequence !== loadSequence) return;
      catalogProducts = [];
      catalogTotalCount = 0;
      catalogComplete = false;
      byId('adminInventoryCount').textContent = '';
      showState('error', 'admin_inventory_error_title', 'admin_inventory_error_text', true);
    } finally {
      if (sequence === loadSequence) AdminCore.setBusy(refreshButton, false);
    }
  }

  function productById(productId) {
    return catalogProducts.find(product => String(product.id) === String(productId));
  }

  function syncQuantityControl(select) {
    const row = select.closest('tr');
    const quantity = row?.querySelector('.admin-inventory-quantity-input');
    if (!quantity) return;
    const disabled = select.value === 'catalog' || select.value === 'not-tracked';
    quantity.disabled = disabled;
    if (disabled) quantity.value = '';
    row.querySelector('.admin-inventory-error').textContent = '';
  }

  async function saveInventoryRow(form) {
    const productId = String(form.dataset.productId || '');
    const product = productById(productId);
    const row = form.closest('tr');
    const select = row?.querySelector('.admin-inventory-state-select');
    const quantityInput = row?.querySelector('.admin-inventory-quantity-input');
    const error = row?.querySelector('.admin-inventory-error');
    const saveButton = row?.querySelector('[data-inventory-save]');
    if (!product || !select || !quantityInput || !error || !saveButton) {
      AdminCore.toast(t('admin_inventory_product_missing'), 'error');
      return;
    }

    const chosenState = select.value;
    const quantity = chosenState === 'catalog' || chosenState === 'not-tracked' ? '' : clean(quantityInput.value);
    const currentOverride = validOverride(productId);
    error.textContent = '';
    quantityInput.classList.remove('is-invalid');
    if (quantity && !/^\d+$/.test(quantity)) {
      error.textContent = t('admin_inventory_quantity_invalid');
      quantityInput.classList.add('is-invalid');
      quantityInput.focus();
      return;
    }

    const unchanged = chosenState === 'catalog'
      ? !currentOverride
      : currentOverride
        && chosenState === currentOverride.state
        && quantity === clean(currentOverride.quantity);
    if (unchanged) {
      AdminCore.toast(t('admin_inventory_unchanged', { product: product.name || productId }), 'info');
      return;
    }

    if (chosenState === 'catalog' && currentOverride) {
      const accepted = await AdminCore.confirm({
        title: t('admin_inventory_clear_title'),
        message: t('admin_inventory_clear_confirm', { product: product.name || productId }),
        confirmLabel: t('admin_inventory_use_catalog')
      });
      if (!accepted) {
        renderInventory();
        return;
      }
    }

    AdminCore.setBusy(saveButton, true, t('admin_inventory_saving'));
    const nextOverrides = { ...overrides };
    if (chosenState === 'catalog') {
      delete nextOverrides[productId];
    } else if (LOCAL_STATES.includes(chosenState)) {
      nextOverrides[productId] = {
        ...currentOverride,
        state: chosenState,
        quantity,
        updatedAt: new Date().toISOString()
      };
    } else {
      error.textContent = t('admin_inventory_store_failed');
      AdminCore.setBusy(saveButton, false);
      return;
    }

    const result = AdminCore.write(storageKey, nextOverrides);
    if (result === undefined) {
      error.textContent = t('admin_inventory_store_failed');
      AdminCore.setBusy(saveButton, false);
      return;
    }

    overrides = nextOverrides;
    AdminCore.toast(t(chosenState === 'catalog' ? 'admin_inventory_cleared' : 'admin_inventory_stored', {
      product: product.name || productId
    }), 'success');
    AdminCore.setBusy(saveButton, false);
    renderInventory();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    storageKey = AdminCore.keys?.inventory === 'am_admin_inventory_v1'
      ? AdminCore.keys.inventory
      : 'am_admin_inventory_v1';
    applyI18n(document);
    readOverrides();

    byId('adminInventorySearch').addEventListener('input', () => {
      currentPage = 1;
      renderInventory();
    });
    byId('adminInventoryFilter').addEventListener('change', () => {
      currentPage = 1;
      renderInventory();
    });
    byId('adminInventoryClear').addEventListener('click', () => {
      byId('adminInventorySearch').value = '';
      byId('adminInventoryFilter').value = 'all';
      currentPage = 1;
      renderInventory();
      byId('adminInventorySearch').focus();
    });
    byId('adminInventoryRefresh').addEventListener('click', loadCatalog);
    byId('adminInventoryPrev').addEventListener('click', () => {
      if (currentPage <= 1) return;
      currentPage -= 1;
      renderInventory();
      byId('adminInventoryTableWrap').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    byId('adminInventoryNext').addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(filteredProducts().length / PAGE_SIZE));
      if (currentPage >= pages) return;
      currentPage += 1;
      renderInventory();
      byId('adminInventoryTableWrap').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    byId('adminInventoryBody').addEventListener('change', event => {
      if (event.target.matches('.admin-inventory-state-select')) syncQuantityControl(event.target);
    });
    byId('adminInventoryBody').addEventListener('submit', event => {
      if (!event.target.matches('.admin-inventory-row-form')) return;
      event.preventDefault();
      saveInventoryRow(event.target);
    });
    byId('adminInventoryBody').addEventListener('click', event => {
      const button = event.target.closest('[data-inventory-cancel]');
      if (!button) return;
      renderInventory();
    });

    loadCatalog();
  }

  window.addEventListener('admin:ready', init, { once: true });
  window.addEventListener('am:langchange', () => {
    if (!initialized) return;
    catalogProducts.sort((a, b) => clean(a.name).localeCompare(clean(b.name), getLang?.() === 'fr' ? 'fr' : 'en'));
    renderInventory();
  });
  window.addEventListener('storage', event => {
    if (!initialized || event.key !== storageKey) return;
    readOverrides();
    renderInventory();
  });
})();
