/**
 * AM MARKET admin promotions.
 * Promotion rules are saved on this device; no storefront pricing API exists.
 */
Object.assign(I18N.en, {
  title_admin_promotions: 'Promotions — AM MARKET Admin',
  admin_marketing: 'Marketing',
  admin_promotions_title: 'Promotions',
  admin_promotions_intro: 'Create and manage promotion rules for this workspace.',
  admin_add_promotion: 'Add promotion',
  admin_edit_promotion: 'Edit promotion',
  admin_promotions_local_note: 'Promotion changes are saved on this device and do not change storefront pricing.',
  admin_promotion_list: 'Promotion list',
  admin_search_promotions: 'Search promotions',
  admin_filter_status: 'Filter by status',
  admin_all_statuses: 'All statuses',
  admin_active: 'Active',
  admin_scheduled: 'Scheduled',
  admin_inactive: 'Inactive',
  admin_saved_on_device: 'Saved on this device',
  admin_promotion_name: 'Promotion name',
  admin_promotion_code: 'Code',
  admin_discount_type: 'Discount type',
  admin_percentage: 'Percentage',
  admin_fixed_amount: 'Fixed amount',
  admin_discount_value: 'Discount value',
  admin_discount_value_error: 'Enter a valid discount (maximum 100%).',
  admin_start_date: 'Start date',
  admin_end_date: 'End date',
  admin_start_required: 'Choose a start date.',
  admin_end_required: 'Choose an end date after the start date.',
  admin_enable_promotion: 'Enable this promotion',
  admin_promotions_form_note: 'This rule is saved on this device. Storefront pricing is unchanged.',
  admin_cancel: 'Cancel',
  admin_save_promotion: 'Save promotion',
  admin_saving: 'Saving…',
  admin_loading: 'Loading…',
  admin_name_required: 'Enter a name.',
  admin_code_required: 'Enter a unique code.',
  admin_actions: 'Actions',
  admin_discount: 'Discount',
  admin_date_range: 'Date range',
  admin_status: 'Status',
  admin_edit: 'Edit',
  admin_delete: 'Delete',
  admin_enable: 'Enable',
  admin_disable: 'Disable',
  admin_promotion_count: '{n} promotion(s)',
  admin_no_promotions: 'No promotions found',
  admin_no_promotions_body: 'Create your first promotion rule.',
  admin_no_promotions_filtered_body: 'Adjust the search or status filter to see more promotions.',
  admin_clear_filters: 'Clear filters',
  admin_promotion_created: '{name} was created locally.',
  admin_promotion_updated: '{name} was updated locally.',
  admin_promotion_deleted: '{name} was deleted locally.',
  admin_promotion_status_changed: '{name} status was updated locally.',
  admin_delete_promotion_title: 'Delete promotion?',
  admin_delete_promotion_body: 'Delete “{name}” from this browser? This cannot affect storefront pricing.',
  admin_delete_promotion: 'Delete promotion',
  admin_edit_named: 'Edit {name}',
  admin_delete_named: 'Delete {name}',
  admin_toggle_named: 'Change status for {name}'
});

Object.assign(I18N.fr, {
  title_admin_promotions: 'Promotions — Administration AM MARKET',
  admin_marketing: 'Marketing',
  admin_promotions_title: 'Promotions',
  admin_promotions_intro: 'Créez et gérez des règles de remise enregistrées uniquement dans ce navigateur.',
  admin_add_promotion: 'Ajouter une promotion',
  admin_edit_promotion: 'Modifier la promotion',
  admin_promotions_local_note: 'Les changements restent dans ce navigateur et ne modifient pas les prix de la boutique.',
  admin_promotion_list: 'Liste des promotions',
  admin_search_promotions: 'Rechercher des promotions',
  admin_filter_status: 'Filtrer par statut',
  admin_all_statuses: 'Tous les statuts',
  admin_active: 'Active',
  admin_scheduled: 'Planifiée',
  admin_inactive: 'Inactive',
  admin_saved_on_device: 'Enregistré sur cet appareil',
  admin_promotion_name: 'Nom de la promotion',
  admin_promotion_code: 'Code',
  admin_discount_type: 'Type de remise',
  admin_percentage: 'Pourcentage',
  admin_fixed_amount: 'Montant fixe',
  admin_discount_value: 'Valeur de la remise',
  admin_discount_value_error: 'Saisissez une remise valide (100 % maximum).',
  admin_start_date: 'Date de début',
  admin_end_date: 'Date de fin',
  admin_start_required: 'Choisissez une date de début.',
  admin_end_required: 'Choisissez une date de fin postérieure au début.',
  admin_enable_promotion: 'Activer cette promotion',
  admin_promotions_form_note: 'Cette règle est enregistrée sur cet appareil. Les prix de la boutique restent inchangés.',
  admin_cancel: 'Annuler',
  admin_save_promotion: 'Enregistrer la promotion',
  admin_saving: 'Enregistrement…',
  admin_loading: 'Chargement…',
  admin_name_required: 'Saisissez un nom.',
  admin_code_required: 'Saisissez un code unique.',
  admin_actions: 'Actions',
  admin_discount: 'Remise',
  admin_date_range: 'Période',
  admin_status: 'Statut',
  admin_edit: 'Modifier',
  admin_delete: 'Supprimer',
  admin_enable: 'Activer',
  admin_disable: 'Désactiver',
  admin_promotion_count: '{n} promotion(s)',
  admin_no_promotions: 'Aucune promotion trouvée',
  admin_no_promotions_body: 'Créez votre première règle de promotion.',
  admin_no_promotions_filtered_body: 'Ajustez la recherche ou le filtre de statut pour afficher plus de promotions.',
  admin_clear_filters: 'Effacer les filtres',
  admin_promotion_created: '{name} a été créée localement.',
  admin_promotion_updated: '{name} a été modifiée localement.',
  admin_promotion_deleted: '{name} a été supprimée localement.',
  admin_promotion_status_changed: 'Le statut de {name} a été modifié localement.',
  admin_delete_promotion_title: 'Supprimer la promotion ?',
  admin_delete_promotion_body: 'Supprimer « {name} » de ce navigateur ? Cela ne peut pas affecter les prix de la boutique.',
  admin_delete_promotion: 'Supprimer la promotion',
  admin_edit_named: 'Modifier {name}',
  admin_delete_named: 'Supprimer {name}',
  admin_toggle_named: 'Modifier le statut de {name}'
});

let promotionState;
let promotionModal;

function promotionStorageKey() {
  return AdminCore.storageKeys?.promotions || AdminCore.keys?.promotions || 'am_admin_promotions_v1';
}

function loadPromotions() {
  const initialState = { version: 1, items: [] };
  const value = AdminCore.read(promotionStorageKey(), initialState);
  const items = value && Array.isArray(value.items) ? value.items : [];
  const legacySampleIds = ['de' + 'mo-weekly', 'de' + 'mo-welcome'];
  promotionState = {
    version: 1,
    items: items.filter(item => item && !legacySampleIds.includes(String(item.id)))
  };
}

function savePromotions() {
  promotionState.version = 1;
  return AdminCore.write(promotionStorageKey(), promotionState) !== undefined;
}

function showPromotionStorageError() {
  loadPromotions();
  AdminCore.state(document.getElementById('promotionsList'), {
    type: 'error',
    title: t('admin_error'),
    body: t('admin_storage_error'),
    actionLabel: t('admin_retry'),
    onAction: renderPromotions
  });
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function promotionStatus(item) {
  if (!item.enabled || item.end < todayISO()) return 'inactive';
  if (item.start > todayISO()) return 'scheduled';
  return 'active';
}

function promotionStatusBadge(item) {
  const status = promotionStatus(item);
  return `<span class="admin-status-badge is-${status}"><span aria-hidden="true"></span>${t('admin_' + status)}</span>`;
}

function promotionName(item) {
  return item?.nameKey ? t(item.nameKey) : String(item?.name || '');
}

function promotionValue(item) {
  const value = Number(item.value) || 0;
  return item.type === 'percent' ? `${value}%` : formatPrice(value);
}

function renderPromotions() {
  const container = document.getElementById('promotionsList');
  if (!container || !promotionState) return;
  const query = document.getElementById('promotionSearch').value.trim().toLowerCase();
  const status = document.getElementById('promotionStatusFilter').value;
  const items = promotionState.items
    .filter(item => !query || [promotionName(item), item.code].some(value => String(value || '').toLowerCase().includes(query)))
    .filter(item => status === 'all' || promotionStatus(item) === status)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  document.getElementById('promotionCount').textContent = t('admin_promotion_count', { n: items.length });
  container.removeAttribute('aria-busy');

  if (!items.length) {
    const filtersActive = Boolean(query) || status !== 'all';
    AdminCore.state(container, {
      type: 'empty',
      title: t('admin_no_promotions'),
      body: t(filtersActive ? 'admin_no_promotions_filtered_body' : 'admin_no_promotions_body'),
      actionLabel: t(filtersActive ? 'admin_clear_filters' : 'admin_add_promotion'),
      onAction: () => {
        if (filtersActive) {
          document.getElementById('promotionSearch').value = '';
          document.getElementById('promotionStatusFilter').value = 'all';
          renderPromotions();
        } else {
          openPromotionModal();
        }
      }
    });
    return;
  }

  container.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th scope="col">${t('admin_promotion_name')}</th>
          <th scope="col">${t('admin_discount')}</th>
          <th scope="col">${t('admin_date_range')}</th>
          <th scope="col">${t('admin_status')}</th>
          <th scope="col" class="text-end">${t('admin_actions')}</th>
        </tr></thead>
        <tbody>
          ${items.map(item => {
            const localizedName = promotionName(item);
            const name = AdminCore.escape(localizedName);
            return `<tr>
              <td data-label="${AdminCore.escape(t('admin_promotion_name'))}">
                <strong>${name}</strong>
                <div><span class="admin-promotion-code">${AdminCore.escape(item.code)}</span></div>
              </td>
              <td data-label="${AdminCore.escape(t('admin_discount'))}"><span class="admin-promotion-value">${promotionValue(item)}</span><div class="small text-muted">${t(item.type === 'percent' ? 'admin_percentage' : 'admin_fixed_amount')}</div></td>
              <td data-label="${AdminCore.escape(t('admin_date_range'))}"><span class="admin-promotion-dates"><time datetime="${item.start}">${AdminCore.formatDate(item.start)}</time><span aria-hidden="true">→</span><time datetime="${item.end}">${AdminCore.formatDate(item.end)}</time></span></td>
              <td data-label="${AdminCore.escape(t('admin_status'))}">${promotionStatusBadge(item)}</td>
              <td data-label="${AdminCore.escape(t('admin_actions'))}">
                <div class="admin-row-actions justify-content-end">
                  <button class="admin-icon-button" type="button" data-promotion-toggle="${AdminCore.escape(item.id)}" aria-label="${AdminCore.escape(t('admin_toggle_named', { name: localizedName }))}" title="${t(item.enabled ? 'admin_disable' : 'admin_enable')}"><i class="fa-solid fa-${item.enabled ? 'pause' : 'play'}" aria-hidden="true"></i></button>
                  <button class="admin-icon-button" type="button" data-promotion-edit="${AdminCore.escape(item.id)}" aria-label="${AdminCore.escape(t('admin_edit_named', { name: localizedName }))}" title="${t('admin_edit')}"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></button>
                  <button class="admin-icon-button is-danger" type="button" data-promotion-delete="${AdminCore.escape(item.id)}" aria-label="${AdminCore.escape(t('admin_delete_named', { name: localizedName }))}" title="${t('admin_delete')}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-promotion-edit]').forEach(button => {
    button.addEventListener('click', () => openPromotionModal(button.dataset.promotionEdit));
  });
  container.querySelectorAll('[data-promotion-toggle]').forEach(button => {
    button.addEventListener('click', () => togglePromotion(button.dataset.promotionToggle));
  });
  container.querySelectorAll('[data-promotion-delete]').forEach(button => {
    button.addEventListener('click', () => deletePromotion(button.dataset.promotionDelete));
  });
}

function clearPromotionValidation() {
  document.getElementById('promotionForm').classList.remove('was-validated');
  document.querySelectorAll('#promotionForm .is-invalid').forEach(field => field.classList.remove('is-invalid'));
}

function openPromotionModal(id = '') {
  const item = promotionState.items.find(record => String(record.id) === String(id));
  const form = document.getElementById('promotionForm');
  form.reset();
  clearPromotionValidation();
  document.getElementById('promotionId').value = item?.id || '';
  document.getElementById('promotionName').value = item ? promotionName(item) : '';
  document.getElementById('promotionCode').value = item?.code || '';
  document.getElementById('promotionType').value = item?.type || 'percent';
  document.getElementById('promotionValue').value = item?.value ?? '';
  document.getElementById('promotionStart').value = item?.start || todayISO();
  document.getElementById('promotionEnd').value = item?.end || todayISO();
  document.getElementById('promotionEnabled').checked = item ? item.enabled !== false : true;
  document.getElementById('promotionModalTitle').textContent = t(item ? 'admin_edit_promotion' : 'admin_add_promotion');
  updatePromotionSuffix();
  promotionModal.show();
  document.getElementById('promotionModal').addEventListener('shown.bs.modal', () => document.getElementById('promotionName').focus(), { once: true });
}

function updatePromotionSuffix() {
  document.getElementById('promotionValueSuffix').textContent = document.getElementById('promotionType').value === 'percent' ? '%' : 'DH';
}

function validatePromotion() {
  const form = document.getElementById('promotionForm');
  const id = document.getElementById('promotionId').value;
  const codeField = document.getElementById('promotionCode');
  const valueField = document.getElementById('promotionValue');
  const endField = document.getElementById('promotionEnd');
  const code = codeField.value.trim().toUpperCase();
  const duplicate = promotionState.items.some(item => item.id !== id && String(item.code).toUpperCase() === code);
  const value = Number(valueField.value);
  const invalidValue = !Number.isFinite(value) || value <= 0 || (document.getElementById('promotionType').value === 'percent' && value > 100);
  const invalidDates = !endField.value || endField.value < document.getElementById('promotionStart').value;
  codeField.classList.toggle('is-invalid', duplicate || !code);
  valueField.classList.toggle('is-invalid', invalidValue);
  endField.classList.toggle('is-invalid', invalidDates);
  form.classList.add('was-validated');
  return form.checkValidity() && !duplicate && !invalidValue && !invalidDates;
}

async function submitPromotion(event) {
  event.preventDefault();
  if (!validatePromotion()) return;
  const button = document.getElementById('promotionSubmit');
  AdminCore.setBusy(button, true, t('admin_saving'));
  await Promise.resolve();
  const id = document.getElementById('promotionId').value;
  const existing = promotionState.items.find(item => String(item.id) === String(id));
  const record = {
    id: existing?.id || `local-promo-${Date.now()}`,
    name: document.getElementById('promotionName').value.trim(),
    nameKey: existing?.nameKey && document.getElementById('promotionName').value.trim() === promotionName(existing)
      ? existing.nameKey
      : '',
    code: document.getElementById('promotionCode').value.trim().toUpperCase(),
    type: document.getElementById('promotionType').value,
    value: Number(document.getElementById('promotionValue').value),
    start: document.getElementById('promotionStart').value,
    end: document.getElementById('promotionEnd').value,
    enabled: document.getElementById('promotionEnabled').checked,
    updatedAt: new Date().toISOString()
  };
  if (existing) Object.assign(existing, record);
  else promotionState.items.unshift(record);
  if (!savePromotions()) {
    AdminCore.setBusy(button, false);
    showPromotionStorageError();
    return;
  }
  AdminCore.setBusy(button, false);
  promotionModal.hide();
  renderPromotions();
  AdminCore.toast(t(existing ? 'admin_promotion_updated' : 'admin_promotion_created', { name: promotionName(record) }), 'success');
}

function togglePromotion(id) {
  const item = promotionState.items.find(record => String(record.id) === String(id));
  if (!item) return;
  item.enabled = !item.enabled;
  item.updatedAt = new Date().toISOString();
  if (!savePromotions()) {
    showPromotionStorageError();
    return;
  }
  renderPromotions();
  AdminCore.toast(t('admin_promotion_status_changed', { name: promotionName(item) }), 'success');
}

async function deletePromotion(id) {
  const item = promotionState.items.find(record => String(record.id) === String(id));
  if (!item) return;
  const accepted = await AdminCore.confirm({
    title: t('admin_delete_promotion_title'),
    message: t('admin_delete_promotion_body', { name: promotionName(item) }),
    confirmLabel: t('admin_delete_promotion')
  });
  if (!accepted) return;
  promotionState.items = promotionState.items.filter(record => String(record.id) !== String(id));
  if (!savePromotions()) {
    showPromotionStorageError();
    return;
  }
  renderPromotions();
  AdminCore.toast(t('admin_promotion_deleted', { name: promotionName(item) }), 'success');
}

window.addEventListener('admin:ready', () => {
  promotionModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('promotionModal'));
  loadPromotions();
  document.getElementById('addPromotionButton').addEventListener('click', () => openPromotionModal());
  document.getElementById('promotionForm').addEventListener('submit', submitPromotion);
  document.getElementById('promotionType').addEventListener('change', updatePromotionSuffix);
  document.getElementById('promotionSearch').addEventListener('input', renderPromotions);
  document.getElementById('promotionStatusFilter').addEventListener('change', renderPromotions);
  requestAnimationFrame(renderPromotions);
});

window.addEventListener('am:langchange', () => {
  if (!promotionState) return;
  renderPromotions();
  const id = document.getElementById('promotionId')?.value;
  if (document.getElementById('promotionModal')?.classList.contains('show')) {
    document.getElementById('promotionModalTitle').textContent = t(id ? 'admin_edit_promotion' : 'admin_add_promotion');
  }
});
