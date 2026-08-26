Object.assign(I18N.en, {
  title_admin_categories: 'AM MARKET Admin — Categories',
  admin_categories_skip: 'Skip to category management',
  admin_categories_catalog_label: 'Catalog workspace',
  admin_categories_title: 'Categories',
  admin_categories_subtitle: 'Explore the live hierarchy and manage shared category drafts.',
  admin_categories_add: 'Add category',
  admin_categories_local_note_title: 'Shared workspace drafts',
  admin_categories_local_note: 'Category changes are saved in the database-backed admin workspace and do not update the catalog API or storefront.',
  admin_categories_list_title: 'Catalog categories',
  admin_categories_search_label: 'Search categories',
  admin_categories_search_placeholder: 'Search by category name',
  admin_categories_scope_filter: 'Filter hierarchy level',
  admin_categories_all_levels: 'All levels',
  admin_categories_root_only: 'Top-level only',
  admin_categories_status_filter: 'Filter by status',
  admin_categories_all_statuses: 'All statuses',
  admin_categories_enabled: 'Enabled',
  admin_categories_disabled: 'Disabled',
  admin_categories_reset: 'Reset',
  admin_categories_search_button: 'Search',
  admin_categories_table_caption: 'Categories from the live catalog with shared workspace drafts applied',
  admin_categories_col_category: 'Category',
  admin_categories_col_parent: 'Parent',
  admin_categories_col_products: 'Catalog products',
  admin_categories_col_status: 'Status',
  admin_categories_col_source: 'Source',
  admin_categories_col_actions: 'Actions',
  admin_categories_local_edit: 'Shared draft change',
  admin_categories_close: 'Close',
  admin_categories_field_name: 'Category name',
  admin_categories_field_parent: 'Parent category',
  admin_categories_no_parent: 'No parent (top level)',
  admin_categories_parent_help: 'A category cannot be placed inside itself or one of its descendants.',
  admin_categories_field_icon: 'Icon or emoji (optional)',
  admin_categories_icon_help: 'Used in the shared admin draft.',
  admin_categories_field_enabled: 'Enabled in this admin view',
  admin_categories_form_note: 'Submitting saves this change to the shared admin workspace.',
  admin_categories_cancel: 'Cancel',
  admin_categories_apply_local: 'Save shared draft',
  admin_categories_add_title: 'Add category',
  admin_categories_edit_title: 'Edit category',
  admin_categories_loading_title: 'Loading categories',
  admin_categories_loading_body: 'Reading the live hierarchy and applying shared workspace drafts.',
  admin_categories_error_title: 'Categories could not be loaded',
  admin_categories_error_body: 'Check your connection and try the live catalog again.',
  admin_categories_retry: 'Retry',
  admin_categories_empty_title: 'No categories match',
  admin_categories_empty_body: 'Adjust the search or filters to see catalog categories.',
  admin_categories_clear_filters: 'Clear filters',
  admin_categories_summary: 'Showing {shown} of {total} categories',
  admin_categories_top_level: 'Top level',
  admin_categories_source_live: 'Live catalog',
  admin_categories_source_local: 'Workspace draft',
  admin_categories_source_edited: 'Live + shared draft',
  admin_categories_reference: 'ID {id}',
  admin_categories_count_loading: 'Reading…',
  admin_categories_count_loading_named: 'Reading product count for {name}',
  admin_categories_count_unavailable: 'Count unavailable',
  admin_categories_count_includes_descendants: 'Includes descendant catalog products where provided by the live read endpoint.',
  admin_categories_edit_named: 'Edit {name}',
  admin_categories_disable_named: 'Disable {name}',
  admin_categories_enable_named: 'Enable {name}',
  admin_categories_delete_named: 'Delete {name}',
  admin_categories_validation_name: 'Enter at least 2 characters.',
  admin_categories_validation_duplicate: 'A category with this name already exists under the selected parent.',
  admin_categories_validation_parent: 'Choose a valid parent that is not this category or one of its descendants.',
  admin_categories_validation_icon: 'Use no more than 12 characters for the icon.',
  admin_categories_saving: 'Saving shared draft…',
  admin_categories_added_local: '“{name}” was added to the shared admin workspace.',
  admin_categories_updated_local: '“{name}” was updated in the shared admin workspace.',
  admin_categories_removed_local: '“{name}” was removed from the shared admin workspace.',
  admin_categories_hidden_local: '“{name}” is hidden in the shared admin draft; the storefront is unchanged.',
  admin_categories_enabled_local: '“{name}” was enabled in the shared admin draft.',
  admin_categories_disabled_local: '“{name}” was disabled in the shared admin draft; the storefront is unchanged.',
  admin_categories_write_error: 'The category change could not be saved. The latest shared draft was restored.',
  admin_categories_delete_title: 'Delete “{name}”?',
  admin_categories_delete_live_message: 'This hides the live category in the shared admin draft. It does not delete it from the API or storefront.',
  admin_categories_delete_local_message: 'This removes the category created in the shared admin draft. The catalog API is unchanged.',
  admin_categories_delete_children_note: ' {count} direct child category(s) will move up one level in the shared workspace.',
  admin_categories_delete_confirm: 'Delete shared draft',
  admin_categories_delete_blocked_products: '“{name}” still contains {count} catalog or draft product(s). Reassign those products before deleting the category.',
  admin_categories_disable_title: 'Disable “{name}”?',
  admin_categories_enable_title: 'Enable “{name}”?',
  admin_categories_disable_message: 'This changes the shared admin draft. The category remains enabled on the live storefront.',
  admin_categories_enable_message: 'This changes the shared admin draft and does not update the storefront.',
  admin_categories_disable_confirm: 'Disable in shared draft',
  admin_categories_enable_confirm: 'Enable in shared draft'
});

Object.assign(I18N.fr, {
  title_admin_categories: 'Administration AM MARKET — Catégories',
  admin_categories_skip: 'Aller à la gestion des catégories',
  admin_categories_catalog_label: 'Espace catalogue',
  admin_categories_title: 'Catégories',
  admin_categories_subtitle: 'Explorez la hiérarchie en ligne et gérez les brouillons de catégorie partagés.',
  admin_categories_add: 'Ajouter une catégorie',
  admin_categories_local_note_title: 'Brouillons partagés',
  admin_categories_local_note: 'Les modifications sont enregistrées dans l’espace administrateur partagé en base. Elles ne modifient ni l’API du catalogue ni la boutique.',
  admin_categories_list_title: 'Catégories du catalogue',
  admin_categories_search_label: 'Rechercher des catégories',
  admin_categories_search_placeholder: 'Rechercher par nom de catégorie',
  admin_categories_scope_filter: 'Filtrer par niveau hiérarchique',
  admin_categories_all_levels: 'Tous les niveaux',
  admin_categories_root_only: 'Catégories principales',
  admin_categories_status_filter: 'Filtrer par statut',
  admin_categories_all_statuses: 'Tous les statuts',
  admin_categories_enabled: 'Activée',
  admin_categories_disabled: 'Désactivée',
  admin_categories_reset: 'Réinitialiser',
  admin_categories_search_button: 'Rechercher',
  admin_categories_table_caption: 'Catégories du catalogue en ligne avec les brouillons partagés appliqués',
  admin_categories_col_category: 'Catégorie',
  admin_categories_col_parent: 'Parent',
  admin_categories_col_products: 'Produits catalogue',
  admin_categories_col_status: 'Statut',
  admin_categories_col_source: 'Source',
  admin_categories_col_actions: 'Actions',
  admin_categories_local_edit: 'Modification du brouillon partagé',
  admin_categories_close: 'Fermer',
  admin_categories_field_name: 'Nom de la catégorie',
  admin_categories_field_parent: 'Catégorie parente',
  admin_categories_no_parent: 'Aucun parent (niveau principal)',
  admin_categories_parent_help: 'Une catégorie ne peut pas être placée dans elle-même ni dans l’un de ses descendants.',
  admin_categories_field_icon: 'Icône ou emoji (facultatif)',
  admin_categories_icon_help: 'Utilisée dans le brouillon administrateur partagé.',
  admin_categories_field_enabled: 'Activée dans cette vue admin',
  admin_categories_form_note: 'La validation enregistre cette modification dans l’espace administrateur partagé.',
  admin_categories_cancel: 'Annuler',
  admin_categories_apply_local: 'Enregistrer le brouillon partagé',
  admin_categories_add_title: 'Ajouter une catégorie',
  admin_categories_edit_title: 'Modifier la catégorie',
  admin_categories_loading_title: 'Chargement des catégories',
  admin_categories_loading_body: 'Lecture de la hiérarchie en ligne et application des brouillons partagés.',
  admin_categories_error_title: 'Impossible de charger les catégories',
  admin_categories_error_body: 'Vérifiez votre connexion puis réessayez de lire le catalogue en ligne.',
  admin_categories_retry: 'Réessayer',
  admin_categories_empty_title: 'Aucune catégorie correspondante',
  admin_categories_empty_body: 'Modifiez la recherche ou les filtres pour afficher des catégories.',
  admin_categories_clear_filters: 'Effacer les filtres',
  admin_categories_summary: '{shown} catégorie(s) affichée(s) sur {total}',
  admin_categories_top_level: 'Niveau principal',
  admin_categories_source_live: 'Catalogue en ligne',
  admin_categories_source_local: 'Brouillon partagé',
  admin_categories_source_edited: 'En ligne + brouillon',
  admin_categories_reference: 'ID {id}',
  admin_categories_count_loading: 'Lecture…',
  admin_categories_count_loading_named: 'Lecture du nombre de produits pour {name}',
  admin_categories_count_unavailable: 'Nombre indisponible',
  admin_categories_count_includes_descendants: 'Inclut les produits des sous-catégories lorsque le point de lecture en ligne les fournit.',
  admin_categories_edit_named: 'Modifier {name}',
  admin_categories_disable_named: 'Désactiver {name}',
  admin_categories_enable_named: 'Activer {name}',
  admin_categories_delete_named: 'Supprimer {name}',
  admin_categories_validation_name: 'Saisissez au moins 2 caractères.',
  admin_categories_validation_duplicate: 'Une catégorie portant ce nom existe déjà sous le parent sélectionné.',
  admin_categories_validation_parent: 'Choisissez un parent valide qui n’est ni cette catégorie ni l’un de ses descendants.',
  admin_categories_validation_icon: 'Utilisez au maximum 12 caractères pour l’icône.',
  admin_categories_saving: 'Enregistrement du brouillon partagé…',
  admin_categories_added_local: '« {name} » a été ajoutée à l’espace administrateur partagé.',
  admin_categories_updated_local: '« {name} » a été modifiée dans l’espace administrateur partagé.',
  admin_categories_removed_local: '« {name} » a été retirée de l’espace administrateur partagé.',
  admin_categories_hidden_local: '« {name} » est masquée dans le brouillon partagé ; la boutique reste inchangée.',
  admin_categories_enabled_local: '« {name} » a été activée dans le brouillon partagé.',
  admin_categories_disabled_local: '« {name} » a été désactivée dans le brouillon partagé ; la boutique reste inchangée.',
  admin_categories_write_error: 'Impossible d’enregistrer la modification. Le dernier brouillon partagé a été restauré.',
  admin_categories_delete_title: 'Supprimer « {name} » ?',
  admin_categories_delete_live_message: 'Cette action masque la catégorie en ligne dans le brouillon administrateur partagé. Elle ne la supprime ni de l’API ni de la boutique.',
  admin_categories_delete_local_message: 'Cette action retire la catégorie créée dans le brouillon partagé. L’API du catalogue reste inchangée.',
  admin_categories_delete_children_note: ' {count} catégorie(s) enfant(s) directe(s) remonteront d’un niveau dans l’espace partagé.',
  admin_categories_delete_confirm: 'Supprimer le brouillon partagé',
  admin_categories_delete_blocked_products: '« {name} » contient encore {count} produit(s) du catalogue ou en brouillon. Réaffectez ces produits avant de supprimer la catégorie.',
  admin_categories_disable_title: 'Désactiver « {name} » ?',
  admin_categories_enable_title: 'Activer « {name} » ?',
  admin_categories_disable_message: 'Cette action modifie le brouillon administrateur partagé. La catégorie reste activée sur la boutique en ligne.',
  admin_categories_enable_message: 'Cette action modifie le brouillon administrateur partagé et ne met pas à jour la boutique.',
  admin_categories_disable_confirm: 'Désactiver dans le brouillon',
  admin_categories_enable_confirm: 'Activer dans le brouillon'
});

(() => {
  'use strict';

  const LOCAL_ID_PREFIX = 'local-category-';
  let core;
  let categoryStorageKey;
  let productStorageKey;
  let overlay;
  let allCategories = [];
  let visibleCategories = [];
  let categoryModal = null;
  let searchTimer = null;
  let renderSequence = 0;
  const countCache = new Map();
  let productCountDeltas = new Map();
  let canEditWorkspace = false;

  const byId = id => document.getElementById(id);
  const asId = value => value == null || value === '' ? '' : String(value);
  const esc = value => core.escape(value == null ? '' : String(value));

  function emptyOverlay() {
    return { version: 1, created: [], patches: {}, hiddenIds: [] };
  }

  function sanitizeOverlay(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      version: 1,
      created: Array.isArray(source.created) ? source.created.filter(item => item && item.id != null) : [],
      patches: source.patches && typeof source.patches === 'object' && !Array.isArray(source.patches) ? source.patches : {},
      hiddenIds: [...new Set((Array.isArray(source.hiddenIds) ? source.hiddenIds : []).map(asId).filter(Boolean))]
    };
  }

  async function persistOverlay() {
    overlay = sanitizeOverlay(overlay);
    overlay = sanitizeOverlay(await core.saveWorkspace('categories', overlay));
  }

  async function restoreOverlay() {
    try {
      overlay = sanitizeOverlay(await core.loadWorkspace('categories', { refresh: true }));
    } catch {
      overlay = sanitizeOverlay(core.read(categoryStorageKey, emptyOverlay()));
    }
  }

  function isLocalId(id) {
    return asId(id).startsWith(LOCAL_ID_PREFIX);
  }

  function categoryCountValue(category) {
    const candidates = [category.product_count, category.products_count, category.productCount];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return null;
  }

  function normalizeCategory(category, source = 'live', order = 0) {
    const enabledValue = category.enabled ?? category.is_enabled ?? category.active ?? category.is_active;
    return {
      ...category,
      id: asId(category.id),
      name: String(category.name || category.displayName || '').trim() || `#${asId(category.id)}`,
      parentId: asId(category.parentId ?? category.parent_id ?? category.parent?.id),
      icon: String(category.icon || '').trim(),
      enabled: enabledValue !== false,
      depth: Math.max(0, Number(category.depth) || 0),
      productCount: categoryCountValue(category),
      source,
      localEdited: source === 'live-edited',
      order
    };
  }

  function buildHierarchy(records) {
    const map = new Map(records.map(record => [record.id, { ...record }]));
    const childMap = new Map();
    const roots = [];
    map.forEach(record => {
      if (record.parentId && map.has(record.parentId) && record.parentId !== record.id) {
        if (!childMap.has(record.parentId)) childMap.set(record.parentId, []);
        childMap.get(record.parentId).push(record);
      } else {
        roots.push(record);
      }
    });
    const sortRecords = list => list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    sortRecords(roots);
    childMap.forEach(sortRecords);

    const ordered = [];
    const visited = new Set();
    const visit = (record, depth) => {
      if (visited.has(record.id)) return;
      visited.add(record.id);
      ordered.push({ ...record, depth: Math.min(depth, 8) });
      (childMap.get(record.id) || []).forEach(child => visit(child, depth + 1));
    };
    roots.forEach(root => visit(root, 0));
    map.forEach(record => {
      if (!visited.has(record.id)) visit(record, 0);
    });
    return ordered;
  }

  function rebuildCategories() {
    const flat = core.flattenCategories(Array.isArray(categories) ? categories : []);
    const hidden = new Set(overlay.hiddenIds.map(asId));
    const records = flat
      .map((category, index) => normalizeCategory(category, 'live', index))
      .filter(category => !hidden.has(category.id))
      .map(category => {
        const patch = overlay.patches[category.id];
        return patch && typeof patch === 'object'
          ? normalizeCategory({ ...category, ...patch, id: category.id }, 'live-edited', category.order)
          : category;
      });
    overlay.created.forEach((category, index) => {
      const id = asId(category.id);
      if (!hidden.has(id)) records.push(normalizeCategory(category, 'local', flat.length + index));
    });
    allCategories = buildHierarchy(records);
    rebuildProductCountDeltas();
  }

  function rebuildProductCountDeltas() {
    const value = core.read(productStorageKey, {});
    const source = value && typeof value === 'object' ? value : {};
    const deltas = new Map();
    const categoryMap = new Map(allCategories.map(category => [category.id, category]));
    const add = (categoryId, amount) => {
      let current = asId(categoryId);
      const visited = new Set();
      while (current && !visited.has(current)) {
        visited.add(current);
        deltas.set(current, (deltas.get(current) || 0) + amount);
        current = asId(categoryMap.get(current)?.parentId);
      }
    };

    (Array.isArray(source.created) ? source.created : []).forEach(product => add(product?.categoryId ?? product?.category_id, 1));
    Object.values(source.patches && typeof source.patches === 'object' ? source.patches : {}).forEach(patch => {
      if (!patch || typeof patch !== 'object') return;
      const from = asId(patch?._base?.categoryId);
      const to = asId(patch.categoryId ?? patch.category_id);
      if (from && from !== to) add(from, -1);
      if (to && from !== to && (from || to.startsWith(LOCAL_ID_PREFIX))) add(to, 1);
    });
    Object.values(source.hiddenMeta && typeof source.hiddenMeta === 'object' ? source.hiddenMeta : {}).forEach(meta => {
      add(meta?.categoryId, -1);
    });
    productCountDeltas = deltas;
  }

  function adjustedProductCount(categoryId, base) {
    if (base == null) return null;
    return Math.max(0, Number(base) + (productCountDeltas.get(asId(categoryId)) || 0));
  }

  function currentFilters() {
    return {
      search: byId('categorySearch').value.trim().toLocaleLowerCase(),
      scope: byId('categoryScopeFilter').value,
      status: byId('categoryStatusFilter').value
    };
  }

  function filteredCategories() {
    const filters = currentFilters();
    const map = new Map(allCategories.map(category => [category.id, category]));
    return allCategories.filter(category => {
      const parentName = map.get(category.parentId)?.name || '';
      const searchable = `${category.name} ${parentName}`.toLocaleLowerCase();
      if (filters.search && !searchable.includes(filters.search)) return false;
      if (filters.scope === 'root' && category.depth !== 0) return false;
      if (filters.status === 'enabled' && !category.enabled) return false;
      if (filters.status === 'disabled' && category.enabled) return false;
      return true;
    });
  }

  function showState(type, title, body, actionLabel = '', onAction = null) {
    const stateContainer = byId('categoryListState');
    stateContainer.hidden = false;
    byId('categoryTableWrap').hidden = true;
    core.state(stateContainer, { type, title, body, actionLabel, onAction });
  }

  async function loadCategories(force = false) {
    showState('loading', t('admin_categories_loading_title'), t('admin_categories_loading_body'));
    try {
      if (force && typeof fetchCategories === 'function') {
        const fresh = await fetchCategories();
        categories = fresh;
      } else {
        await ensureCategories();
      }
      overlay = sanitizeOverlay(core.read(categoryStorageKey, emptyOverlay()));
      rebuildCategories();
      renderCategories();
    } catch (error) {
      console.warn('Admin category catalog read failed:', error);
      allCategories = [];
      visibleCategories = [];
      byId('categorySummary').textContent = '';
      showState(
        'error',
        t('admin_categories_error_title'),
        t('admin_categories_error_body'),
        t('admin_categories_retry'),
        () => loadCategories(true)
      );
    }
  }

  function sourceMarkup(category) {
    const kind = category.source === 'local' ? 'local' : (category.source === 'live-edited' ? 'edited' : 'live');
    const icon = kind === 'live' ? 'fa-cloud' : (kind === 'local' ? 'fa-laptop' : 'fa-pen-to-square');
    return `<span class="admin-categories-source is-${kind}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${esc(t(`admin_categories_source_${kind}`))}</span>`;
  }

  function countMarkup(category) {
    if (category.source === 'local') {
      countCache.set(category.id, 0);
      return `<span class="admin-categories-count">${esc(adjustedProductCount(category.id, 0))}</span>`;
    }
    if (Number.isFinite(category.productCount)) countCache.set(category.id, category.productCount);
    if (countCache.has(category.id)) {
      const count = adjustedProductCount(category.id, countCache.get(category.id));
      return count == null
        ? `<span class="admin-categories-count" title="${esc(t('admin_categories_count_unavailable'))}">—</span>`
        : `<span class="admin-categories-count" title="${esc(t('admin_categories_count_includes_descendants'))}">${esc(count)}</span>`;
    }
    return `<span class="admin-categories-count is-loading" data-category-count="${esc(category.id)}" role="status" aria-label="${esc(t('admin_categories_count_loading_named', { name: category.name }))}"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> ${esc(t('admin_categories_count_loading'))}</span>`;
  }

  function categoryRow(category, categoryMap) {
    const parent = categoryMap.get(category.parentId);
    const parentName = parent ? (typeof catName === 'function' ? catName(parent.name) : parent.name) : t('admin_categories_top_level');
    const name = typeof catName === 'function' ? catName(category.name) : category.name;
    const icon = category.icon || (typeof getCatIcon === 'function' ? getCatIcon(category) : '');
    const status = category.enabled ? 'enabled' : 'disabled';
    const toggleKey = category.enabled ? 'admin_categories_disable_named' : 'admin_categories_enable_named';
    const toggleIcon = category.enabled ? 'fa-eye-slash' : 'fa-eye';
    return `<tr data-category-id="${esc(category.id)}">
      <td data-label="${esc(t('admin_categories_col_category'))}">
        <div class="admin-categories-name-wrap" style="--category-depth:${category.depth}">
          <i class="fa-solid fa-turn-up fa-rotate-90 admin-categories-branch" aria-hidden="true" ${category.depth ? '' : 'hidden'}></i>
          <span class="admin-categories-icon" aria-hidden="true">${esc(icon || '•')}</span>
          <span>
            <span class="admin-categories-name">${esc(name)}</span>
            <span class="admin-categories-id">${esc(t('admin_categories_reference', { id: category.id }))}</span>
          </span>
        </div>
      </td>
      <td data-label="${esc(t('admin_categories_col_parent'))}">${esc(parentName)}</td>
      <td data-label="${esc(t('admin_categories_col_products'))}">${countMarkup(category)}</td>
      <td data-label="${esc(t('admin_categories_col_status'))}"><span class="admin-categories-badge is-${status}">${esc(t(`admin_categories_${status}`))}</span></td>
      <td data-label="${esc(t('admin_categories_col_source'))}">${sourceMarkup(category)}</td>
      <td data-label="${esc(t('admin_categories_col_actions'))}">
        <div class="admin-categories-actions">
          <button class="admin-categories-action" type="button" data-category-action="edit"${canEditWorkspace ? '' : ' disabled'} aria-label="${esc(t('admin_categories_edit_named', { name }))}" title="${esc(t('admin_categories_edit_named', { name }))}">
            <i class="fa-solid fa-pen" aria-hidden="true"></i>
          </button>
          <button class="admin-categories-action" type="button" data-category-action="toggle"${canEditWorkspace ? '' : ' disabled'} aria-label="${esc(t(toggleKey, { name }))}" title="${esc(t(toggleKey, { name }))}">
            <i class="fa-solid ${toggleIcon}" aria-hidden="true"></i>
          </button>
          <button class="admin-categories-action is-delete" type="button" data-category-action="delete"${canEditWorkspace ? '' : ' disabled'} aria-label="${esc(t('admin_categories_delete_named', { name }))}" title="${esc(t('admin_categories_delete_named', { name }))}">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }

  function renderCategories() {
    const token = ++renderSequence;
    visibleCategories = filteredCategories();
    if (!visibleCategories.length) {
      byId('categorySummary').textContent = '';
      showState(
        'empty',
        t('admin_categories_empty_title'),
        t('admin_categories_empty_body'),
        t('admin_categories_clear_filters'),
        resetFilters
      );
      return;
    }

    const categoryMap = new Map(allCategories.map(category => [category.id, category]));
    byId('categoryListState').hidden = true;
    byId('categoryTableWrap').hidden = false;
    byId('categoryTableBody').innerHTML = visibleCategories.map(category => categoryRow(category, categoryMap)).join('');
    byId('categorySummary').textContent = t('admin_categories_summary', { shown: visibleCategories.length, total: allCategories.length });
    hydrateVisibleCounts(visibleCategories, token);
  }

  async function hydrateVisibleCounts(records, token) {
    const queue = records.filter(category => category.source !== 'local' && !countCache.has(category.id));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const category = queue[cursor++];
        try {
          const data = await fetchProducts(1, category.id, '', '', 1);
          countCache.set(category.id, Math.max(0, Number(data.count) || 0));
        } catch (error) {
          console.warn(`Admin product count read failed for category ${category.id}:`, error);
          countCache.set(category.id, null);
        }
        if (token !== renderSequence) continue;
        const target = byId('categoryTableBody').querySelector(`[data-category-count="${CSS.escape(category.id)}"]`);
        if (!target) continue;
        const count = adjustedProductCount(category.id, countCache.get(category.id));
        target.classList.remove('is-loading');
        target.removeAttribute('role');
        target.removeAttribute('aria-label');
        target.title = count == null ? t('admin_categories_count_unavailable') : t('admin_categories_count_includes_descendants');
        target.textContent = count == null ? '—' : String(count);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }

  function resetFilters() {
    byId('categorySearch').value = '';
    byId('categoryScopeFilter').value = 'all';
    byId('categoryStatusFilter').value = '';
    renderCategories();
  }

  function descendantIds(categoryId) {
    const descendants = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      allCategories.forEach(category => {
        if (category.id === categoryId || descendants.has(category.id)) return;
        if (category.parentId === categoryId || descendants.has(category.parentId)) {
          descendants.add(category.id);
          changed = true;
        }
      });
    }
    return descendants;
  }

  function renderParentOptions(editId = '', selectedId = '') {
    const excluded = editId ? descendantIds(editId) : new Set();
    if (editId) excluded.add(editId);
    const options = allCategories
      .filter(category => !excluded.has(category.id))
      .map(category => {
        const prefix = category.depth ? '— '.repeat(Math.min(category.depth, 4)) : '';
        const name = typeof catName === 'function' ? catName(category.name) : category.name;
        return `<option value="${esc(category.id)}">${esc(prefix + name)}</option>`;
      }).join('');
    const select = byId('categoryParent');
    select.innerHTML = `<option value="">${esc(t('admin_categories_no_parent'))}</option>${options}`;
    if ([...select.options].some(option => option.value === selectedId)) select.value = selectedId;
  }

  function clearValidation() {
    byId('categoryEditorForm').querySelectorAll('.is-invalid').forEach(element => element.classList.remove('is-invalid'));
    byId('categoryEditorForm').querySelectorAll('.invalid-feedback').forEach(element => { element.textContent = ''; });
  }

  function invalidate(inputId, errorId, message) {
    byId(inputId).classList.add('is-invalid');
    byId(errorId).textContent = message;
  }

  function openCategoryEditor(category = null) {
    clearValidation();
    byId('categoryEditorForm').reset();
    byId('categoryEditId').value = category?.id || '';
    byId('categoryEditorTitle').textContent = t(category ? 'admin_categories_edit_title' : 'admin_categories_add_title');
    byId('categoryName').value = category?.name || '';
    byId('categoryIcon').value = category?.icon || '';
    byId('categoryEnabled').checked = category?.enabled !== false;
    renderParentOptions(category?.id || '', category?.parentId || '');
    categoryModal.show();
    byId('categoryEditorModal').addEventListener('shown.bs.modal', () => byId('categoryName').focus(), { once: true });
  }

  function validateCategoryForm() {
    clearValidation();
    const editId = byId('categoryEditId').value;
    const name = byId('categoryName').value.trim();
    const parentId = byId('categoryParent').value;
    const icon = byId('categoryIcon').value.trim();
    let valid = true;

    if (name.length < 2) {
      invalidate('categoryName', 'categoryNameError', t('admin_categories_validation_name'));
      valid = false;
    }
    const duplicate = allCategories.some(category =>
      category.id !== editId
      && category.parentId === parentId
      && category.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (name.length >= 2 && duplicate) {
      invalidate('categoryName', 'categoryNameError', t('admin_categories_validation_duplicate'));
      valid = false;
    }
    const excluded = editId ? descendantIds(editId) : new Set();
    if (editId) excluded.add(editId);
    if (parentId && (!allCategories.some(category => category.id === parentId) || excluded.has(parentId))) {
      invalidate('categoryParent', 'categoryParentError', t('admin_categories_validation_parent'));
      valid = false;
    }
    if (icon.length > 12) {
      invalidate('categoryIcon', 'categoryIconError', t('admin_categories_validation_icon'));
      valid = false;
    }
    if (!valid) {
      byId('categoryEditorForm').querySelector('.is-invalid')?.focus();
      return null;
    }
    return {
      name,
      parentId,
      parent_id: parentId || null,
      icon,
      enabled: byId('categoryEnabled').checked,
      updatedAt: new Date().toISOString()
    };
  }

  function nextLocalId() {
    const random = Math.random().toString(36).slice(2, 8);
    return `${LOCAL_ID_PREFIX}${Date.now()}-${random}`;
  }

  async function saveCategory(event) {
    event.preventDefault();
    const values = validateCategoryForm();
    if (!values) return;
    const editId = byId('categoryEditId').value;
    const saveButton = byId('saveCategoryButton');
    core.setBusy(saveButton, true, t('admin_categories_saving'));

    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!editId) {
        overlay.created.unshift({ ...values, id: nextLocalId(), createdAt: new Date().toISOString(), source: 'local' });
        await persistOverlay();
        categoryModal.hide();
        core.toast(t('admin_categories_added_local', { name: values.name }));
      } else if (isLocalId(editId)) {
        const index = overlay.created.findIndex(item => asId(item.id) === editId);
        if (index >= 0) overlay.created[index] = { ...overlay.created[index], ...values, id: editId };
        await persistOverlay();
        categoryModal.hide();
        core.toast(t('admin_categories_updated_local', { name: values.name }));
      } else {
        overlay.patches[editId] = { ...(overlay.patches[editId] || {}), ...values };
        await persistOverlay();
        categoryModal.hide();
        core.toast(t('admin_categories_updated_local', { name: values.name }));
      }
      rebuildCategories();
      renderCategories();
    } catch (error) {
      console.warn('Admin category overlay write failed:', error);
      await restoreOverlay();
      rebuildCategories();
      renderCategories();
      core.toast(t('admin_categories_write_error'), 'error');
    } finally {
      core.setBusy(saveButton, false);
    }
  }

  function updateCategoryRecord(categoryId, values) {
    if (isLocalId(categoryId)) {
      const index = overlay.created.findIndex(item => asId(item.id) === categoryId);
      if (index >= 0) overlay.created[index] = { ...overlay.created[index], ...values, id: categoryId };
    } else {
      overlay.patches[categoryId] = { ...(overlay.patches[categoryId] || {}), ...values };
    }
  }

  async function toggleCategory(category) {
    const enabling = !category.enabled;
    const confirmed = await core.confirm({
      title: t(enabling ? 'admin_categories_enable_title' : 'admin_categories_disable_title', { name: category.name }),
      message: t(enabling ? 'admin_categories_enable_message' : 'admin_categories_disable_message'),
      confirmLabel: t(enabling ? 'admin_categories_enable_confirm' : 'admin_categories_disable_confirm')
    });
    if (!confirmed) return;
    try {
      updateCategoryRecord(category.id, { enabled: enabling, updatedAt: new Date().toISOString() });
      await persistOverlay();
      core.toast(t(enabling ? 'admin_categories_enabled_local' : 'admin_categories_disabled_local', { name: category.name }));
      rebuildCategories();
      renderCategories();
    } catch (error) {
      console.warn('Admin category status write failed:', error);
      await restoreOverlay();
      rebuildCategories();
      renderCategories();
      core.toast(t('admin_categories_write_error'), 'error');
    }
  }

  async function deleteCategory(category) {
    let baseCount = category.source === 'local' ? 0 : countCache.get(category.id);
    if (baseCount === undefined && category.source !== 'local') {
      try {
        const data = await fetchProducts(1, category.id, '', '', 1);
        baseCount = Math.max(0, Number(data.count) || 0);
        countCache.set(category.id, baseCount);
      } catch {
        baseCount = null;
      }
    }
    const affectedProducts = adjustedProductCount(category.id, baseCount);
    if (Number.isFinite(affectedProducts) && affectedProducts > 0) {
      core.toast(t('admin_categories_delete_blocked_products', { name: category.name, count: affectedProducts }), 'warning');
      return;
    }
    const directChildren = allCategories.filter(item => item.parentId === category.id);
    const local = isLocalId(category.id);
    const baseMessage = t(local ? 'admin_categories_delete_local_message' : 'admin_categories_delete_live_message');
    const childNote = directChildren.length ? t('admin_categories_delete_children_note', { count: directChildren.length }) : '';
    const confirmed = await core.confirm({
      title: t('admin_categories_delete_title', { name: category.name }),
      message: baseMessage + childNote,
      confirmLabel: t('admin_categories_delete_confirm')
    });
    if (!confirmed) return;

    try {
      directChildren.forEach(child => updateCategoryRecord(child.id, {
        parentId: category.parentId,
        parent_id: category.parentId || null,
        updatedAt: new Date().toISOString()
      }));
      if (local) {
        overlay.created = overlay.created.filter(item => asId(item.id) !== category.id);
      } else {
        overlay.hiddenIds = [...new Set([...overlay.hiddenIds.map(asId), category.id])];
        delete overlay.patches[category.id];
      }
      await persistOverlay();
      core.toast(t(local ? 'admin_categories_removed_local' : 'admin_categories_hidden_local', { name: category.name }));
      rebuildCategories();
      renderCategories();
    } catch (error) {
      console.warn('Admin category delete failed:', error);
      await restoreOverlay();
      rebuildCategories();
      renderCategories();
      core.toast(t('admin_categories_write_error'), 'error');
    }
  }

  function bindEvents() {
    byId('addCategoryButton').addEventListener('click', () => openCategoryEditor());
    byId('categoryEditorForm').addEventListener('submit', saveCategory);
    byId('categoryEditorModal').addEventListener('hidden.bs.modal', clearValidation);

    byId('categoryFilters').addEventListener('submit', event => {
      event.preventDefault();
      renderCategories();
    });
    byId('categorySearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderCategories, 180);
    });
    ['categoryScopeFilter', 'categoryStatusFilter'].forEach(id => byId(id).addEventListener('change', renderCategories));
    byId('resetCategoryFilters').addEventListener('click', resetFilters);

    byId('categoryTableBody').addEventListener('click', event => {
      const button = event.target.closest('[data-category-action]');
      const row = button?.closest('[data-category-id]');
      if (!button || !row) return;
      const category = allCategories.find(item => item.id === row.dataset.categoryId);
      if (!category) return;
      if (button.dataset.categoryAction === 'edit') openCategoryEditor(category);
      if (button.dataset.categoryAction === 'toggle') toggleCategory(category);
      if (button.dataset.categoryAction === 'delete') deleteCategory(category);
    });

    window.addEventListener('am:langchange', () => {
      renderCategories();
      const editId = byId('categoryEditId').value;
      const selectedParent = byId('categoryParent').value;
      renderParentOptions(editId, selectedParent);
      byId('categoryEditorTitle').textContent = t(editId ? 'admin_categories_edit_title' : 'admin_categories_add_title');
    });
  }

  async function initCategories(event) {
    core = event.detail?.core || window.AdminCore;
    canEditWorkspace = core.canEditWorkspace();
    if (!core) return;
    categoryStorageKey = core.storageKeys?.categories || core.keys?.categories || 'am_admin_categories_v1';
    productStorageKey = core.storageKeys?.products || core.keys?.products || 'am_admin_products_v1';
    overlay = sanitizeOverlay(core.read(categoryStorageKey, emptyOverlay()));
    byId('addCategoryButton').disabled = !canEditWorkspace;
    byId('saveCategoryButton').disabled = !canEditWorkspace;
    categoryModal = bootstrap.Modal.getOrCreateInstance(byId('categoryEditorModal'));
    bindEvents();
    await loadCategories();
  }

  window.addEventListener('admin:ready', initCategories, { once: true });
})();
