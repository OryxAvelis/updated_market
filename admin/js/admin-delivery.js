/**
 * AM MARKET admin delivery configuration.
 * Rules and zones use the shared admin workspace. Fee and threshold publish to checkout.
 */
Object.assign(I18N.en, {
  title_admin_delivery: 'Delivery — AM MARKET Admin',
  admin_operations: 'Operations',
  admin_delivery_title: 'Delivery',
  admin_delivery_intro: 'Configure delivery rules and service zones.',
  admin_add_zone: 'Add zone',
  admin_edit_zone: 'Edit zone',
  admin_delivery_local_note: 'Rules and zones are shared database-backed settings. The default fee and free-delivery threshold are published to checkout; zones remain planning drafts.',
  admin_delivery_rules: 'Delivery rules',
  admin_delivery_rules_sub: 'Saving publishes these defaults to storefront checkout.',
  admin_default_fee: 'Default delivery fee',
  admin_free_threshold: 'Free-delivery threshold',
  admin_nonnegative_required: 'Enter zero or a positive amount.',
  admin_delivery_zones: 'Delivery zones',
  admin_zone_name: 'Zone name',
  admin_coverage: 'Coverage',
  admin_coverage_placeholder: 'Cities or service area',
  admin_coverage_required: 'Describe the service area.',
  admin_zone_fee: 'Zone fee',
  admin_enable_zone: 'Enable this zone',
  admin_local_only: 'Shared admin workspace',
  admin_cancel: 'Cancel',
  admin_save_local: 'Save shared settings',
  admin_saving: 'Saving…',
  admin_loading: 'Loading…',
  admin_name_required: 'Enter a name.',
  admin_status: 'Status',
  admin_active: 'Active',
  admin_inactive: 'Inactive',
  admin_actions: 'Actions',
  admin_edit: 'Edit',
  admin_delete: 'Delete',
  admin_enable: 'Enable',
  admin_disable: 'Disable',
  admin_zone_count: '{n} delivery zone(s)',
  admin_no_zones: 'No delivery zones',
  admin_no_zones_body: 'Add a delivery zone to configure a service area.',
  admin_create_zone: 'Create zone',
  admin_delivery_rules_saved: 'Delivery rules were saved and checkout defaults were published.',
  admin_zone_created: '{name} was saved to the shared workspace.',
  admin_zone_updated: '{name} was updated in the shared workspace.',
  admin_zone_deleted: '{name} was deleted from the shared workspace.',
  admin_zone_status_changed: '{name} status was updated in the shared workspace.',
  admin_delete_zone_title: 'Delete delivery zone?',
  admin_delete_zone_body: 'Delete “{name}” from the shared workspace?',
  admin_delete_local: 'Delete shared draft',
  admin_edit_named: 'Edit {name}',
  admin_delete_named: 'Delete {name}',
  admin_toggle_named: 'Change status for {name}',
  admin_fee_summary: '{fee} fee · free over {threshold}'
});

Object.assign(I18N.fr, {
  title_admin_delivery: 'Livraison — Administration AM MARKET',
  admin_operations: 'Opérations',
  admin_delivery_title: 'Livraison',
  admin_delivery_intro: 'Configurez les règles de livraison et les zones desservies.',
  admin_add_zone: 'Ajouter une zone',
  admin_edit_zone: 'Modifier la zone',
  admin_delivery_local_note: 'Les règles et zones sont partagées et enregistrées en base. Les frais par défaut et le seuil de gratuité sont publiés dans le paiement ; les zones restent des brouillons.',
  admin_delivery_rules: 'Règles de livraison',
  admin_delivery_rules_sub: 'L’enregistrement publie ces valeurs dans le paiement de la boutique.',
  admin_default_fee: 'Frais de livraison par défaut',
  admin_free_threshold: 'Seuil de livraison gratuite',
  admin_nonnegative_required: 'Saisissez zéro ou un montant positif.',
  admin_delivery_zones: 'Zones de livraison',
  admin_zone_name: 'Nom de la zone',
  admin_coverage: 'Couverture',
  admin_coverage_placeholder: 'Villes ou zone desservie',
  admin_coverage_required: 'Décrivez la zone desservie.',
  admin_zone_fee: 'Frais de la zone',
  admin_enable_zone: 'Activer cette zone',
  admin_local_only: 'Espace administrateur partagé',
  admin_cancel: 'Annuler',
  admin_save_local: 'Enregistrer les paramètres partagés',
  admin_saving: 'Enregistrement…',
  admin_loading: 'Chargement…',
  admin_name_required: 'Saisissez un nom.',
  admin_status: 'Statut',
  admin_active: 'Active',
  admin_inactive: 'Inactive',
  admin_actions: 'Actions',
  admin_edit: 'Modifier',
  admin_delete: 'Supprimer',
  admin_enable: 'Activer',
  admin_disable: 'Désactiver',
  admin_zone_count: '{n} zone(s) de livraison',
  admin_no_zones: 'Aucune zone de livraison',
  admin_no_zones_body: 'Ajoutez une zone de livraison pour configurer une zone desservie.',
  admin_create_zone: 'Créer une zone',
  admin_delivery_rules_saved: 'Les règles ont été enregistrées et les valeurs du paiement publiées.',
  admin_zone_created: '{name} a été enregistrée dans l’espace partagé.',
  admin_zone_updated: '{name} a été modifiée dans l’espace partagé.',
  admin_zone_deleted: '{name} a été supprimée de l’espace partagé.',
  admin_zone_status_changed: 'Le statut de {name} a été modifié dans l’espace partagé.',
  admin_delete_zone_title: 'Supprimer la zone de livraison ?',
  admin_delete_zone_body: 'Supprimer « {name} » de l’espace partagé ?',
  admin_delete_local: 'Supprimer le brouillon partagé',
  admin_edit_named: 'Modifier {name}',
  admin_delete_named: 'Supprimer {name}',
  admin_toggle_named: 'Modifier le statut de {name}',
  admin_fee_summary: '{fee} de frais · gratuit dès {threshold}'
});

const DELIVERY_DEFAULTS = {
  version: 1,
  defaultFee: 20,
  freeThreshold: 200,
  zones: []
};

let deliveryState;
let deliveryZoneModal;
let canEditWorkspace = false;

function deliveryStorageKey() {
  return AdminCore.storageKeys?.delivery || AdminCore.keys?.delivery || 'am_admin_delivery_v1';
}

function normalizeDeliveryState(saved) {
  const next = saved && Array.isArray(saved.zones)
    ? structuredClone(saved)
    : structuredClone(DELIVERY_DEFAULTS);
  next.zones = next.zones.filter(zone => zone && zone.system !== true);
  next.defaultFee = Number.isFinite(Number(next.defaultFee)) ? Number(next.defaultFee) : 20;
  next.freeThreshold = Number.isFinite(Number(next.freeThreshold)) ? Number(next.freeThreshold) : 200;
  next.version = 1;
  return next;
}

function loadDeliveryState() {
  deliveryState = normalizeDeliveryState(AdminCore.read(deliveryStorageKey(), null));
}

async function saveDeliveryState() {
  deliveryState = normalizeDeliveryState(await AdminCore.saveWorkspace('delivery', deliveryState));
}

async function showDeliveryStorageError() {
  try {
    deliveryState = normalizeDeliveryState(await AdminCore.loadWorkspace('delivery'));
  } catch {
    loadDeliveryState();
  }
  fillDeliveryRules();
  AdminCore.state(document.getElementById('deliveryZonesList'), {
    type: 'error',
    title: t('admin_error'),
    body: t('admin_storage_error'),
    actionLabel: t('admin_retry'),
    onAction: renderDeliveryZones
  });
}

function zoneName(zone) {
  return zone.name;
}

function zoneCoverage(zone) {
  return zone.coverage;
}

function fillDeliveryRules() {
  document.getElementById('defaultDeliveryFee').value = deliveryState.defaultFee;
  document.getElementById('freeDeliveryThreshold').value = deliveryState.freeThreshold;
  document.getElementById('deliveryRulesForm').classList.remove('was-validated');
  document.querySelectorAll('#deliveryRulesForm .is-invalid').forEach(field => field.classList.remove('is-invalid'));
}

function renderDeliveryZones() {
  const container = document.getElementById('deliveryZonesList');
  if (!container || !deliveryState) return;
  container.removeAttribute('aria-busy');
  document.getElementById('deliveryZoneCount').textContent = t('admin_zone_count', { n: deliveryState.zones.length });
  if (!deliveryState.zones.length) {
    AdminCore.state(container, {
      type: 'empty',
      title: t('admin_no_zones'),
      body: t('admin_no_zones_body'),
      actionLabel: canEditWorkspace ? t('admin_create_zone') : '',
      onAction: canEditWorkspace ? () => openZoneModal() : null
    });
    return;
  }

  container.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th scope="col">${t('admin_zone_name')}</th>
          <th scope="col">${t('admin_zone_fee')}</th>
          <th scope="col">${t('admin_status')}</th>
          <th scope="col" class="text-end">${t('admin_actions')}</th>
        </tr></thead>
        <tbody>
          ${deliveryState.zones.map(zone => {
            const name = zoneName(zone);
            return `<tr>
              <td data-label="${AdminCore.escape(t('admin_zone_name'))}"><span class="admin-zone-name"><strong>${AdminCore.escape(name)}</strong><span>${AdminCore.escape(zoneCoverage(zone))}</span></span></td>
              <td data-label="${AdminCore.escape(t('admin_zone_fee'))}"><span class="admin-zone-fee">${formatPrice(zone.fee)}</span><div class="admin-delivery-summary">${t('admin_fee_summary', { fee: formatPrice(deliveryState.defaultFee), threshold: formatPrice(deliveryState.freeThreshold) })}</div></td>
              <td data-label="${AdminCore.escape(t('admin_status'))}"><span class="admin-status-badge ${zone.enabled ? 'is-active' : 'is-inactive'}"><span aria-hidden="true"></span>${t(zone.enabled ? 'admin_active' : 'admin_inactive')}</span></td>
              <td data-label="${AdminCore.escape(t('admin_actions'))}"><div class="admin-row-actions justify-content-end">
                <button class="admin-icon-button" type="button" data-zone-toggle="${AdminCore.escape(zone.id)}"${canEditWorkspace ? '' : ' disabled'} aria-label="${AdminCore.escape(t('admin_toggle_named', { name }))}" title="${t(zone.enabled ? 'admin_disable' : 'admin_enable')}"><i class="fa-solid fa-${zone.enabled ? 'pause' : 'play'}" aria-hidden="true"></i></button>
                <button class="admin-icon-button" type="button" data-zone-edit="${AdminCore.escape(zone.id)}"${canEditWorkspace ? '' : ' disabled'} aria-label="${AdminCore.escape(t('admin_edit_named', { name }))}" title="${t('admin_edit')}"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></button>
                <button class="admin-icon-button is-danger" type="button" data-zone-delete="${AdminCore.escape(zone.id)}"${canEditWorkspace ? '' : ' disabled'} aria-label="${AdminCore.escape(t('admin_delete_named', { name }))}" title="${t('admin_delete')}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
              </div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-zone-edit]').forEach(button => button.addEventListener('click', () => openZoneModal(button.dataset.zoneEdit)));
  container.querySelectorAll('[data-zone-toggle]').forEach(button => button.addEventListener('click', () => toggleZone(button.dataset.zoneToggle)));
  container.querySelectorAll('[data-zone-delete]').forEach(button => button.addEventListener('click', () => deleteZone(button.dataset.zoneDelete)));
}

function validateNonnegative(field) {
  const valid = field.value !== '' && field.checkValidity() &&
    Number.isFinite(Number(field.value)) && Number(field.value) >= 0;
  field.classList.toggle('is-invalid', !valid);
  return valid;
}

async function submitDeliveryRules(event) {
  event.preventDefault();
  const fee = document.getElementById('defaultDeliveryFee');
  const threshold = document.getElementById('freeDeliveryThreshold');
  const valid = validateNonnegative(fee) && validateNonnegative(threshold);
  event.currentTarget.classList.add('was-validated');
  if (!valid) return;
  const button = document.getElementById('deliveryRulesSubmit');
  AdminCore.setBusy(button, true, t('admin_saving'));
  await Promise.resolve();
  deliveryState.defaultFee = Number(fee.value);
  deliveryState.freeThreshold = Number(threshold.value);
  try {
    await saveDeliveryState();
  } catch {
    AdminCore.setBusy(button, false);
    await showDeliveryStorageError();
    return;
  }
  AdminCore.setBusy(button, false);
  fillDeliveryRules();
  renderDeliveryZones();
  AdminCore.toast(t('admin_delivery_rules_saved'), 'success');
}

function clearZoneValidation() {
  document.getElementById('deliveryZoneForm').classList.remove('was-validated');
  document.querySelectorAll('#deliveryZoneForm .is-invalid').forEach(field => field.classList.remove('is-invalid'));
}

function openZoneModal(id = '') {
  const zone = deliveryState.zones.find(item => String(item.id) === String(id));
  document.getElementById('deliveryZoneForm').reset();
  clearZoneValidation();
  document.getElementById('deliveryZoneId').value = zone?.id || '';
  document.getElementById('deliveryZoneName').value = zone ? zoneName(zone) : '';
  document.getElementById('deliveryZoneCoverage').value = zone ? zoneCoverage(zone) : '';
  document.getElementById('deliveryZoneFee').value = zone?.fee ?? deliveryState.defaultFee;
  document.getElementById('deliveryZoneEnabled').checked = zone ? zone.enabled !== false : true;
  document.getElementById('deliveryZoneModalTitle').textContent = t(zone ? 'admin_edit_zone' : 'admin_add_zone');
  deliveryZoneModal.show();
  document.getElementById('deliveryZoneModal').addEventListener('shown.bs.modal', () => document.getElementById('deliveryZoneName').focus(), { once: true });
}

async function submitZone(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const nameField = document.getElementById('deliveryZoneName');
  const coverageField = document.getElementById('deliveryZoneCoverage');
  const feeField = document.getElementById('deliveryZoneFee');
  nameField.classList.toggle('is-invalid', !nameField.value.trim());
  coverageField.classList.toggle('is-invalid', !coverageField.value.trim());
  const validFee = validateNonnegative(feeField);
  form.classList.add('was-validated');
  if (!form.checkValidity() || !nameField.value.trim() || !coverageField.value.trim() || !validFee) return;
  const button = document.getElementById('deliveryZoneSubmit');
  AdminCore.setBusy(button, true, t('admin_saving'));
  await Promise.resolve();
  const id = document.getElementById('deliveryZoneId').value;
  const existing = deliveryState.zones.find(item => String(item.id) === String(id));
  const record = {
    id: existing?.id || `local-zone-${Date.now()}`,
    name: nameField.value.trim(),
    coverage: coverageField.value.trim(),
    fee: Number(feeField.value),
    enabled: document.getElementById('deliveryZoneEnabled').checked,
    updatedAt: new Date().toISOString()
  };
  if (existing) Object.assign(existing, record);
  else deliveryState.zones.push(record);
  try {
    await saveDeliveryState();
  } catch {
    AdminCore.setBusy(button, false);
    await showDeliveryStorageError();
    return;
  }
  AdminCore.setBusy(button, false);
  deliveryZoneModal.hide();
  renderDeliveryZones();
  AdminCore.toast(t(existing ? 'admin_zone_updated' : 'admin_zone_created', { name: record.name }), 'success');
}

async function toggleZone(id) {
  const zone = deliveryState.zones.find(item => String(item.id) === String(id));
  if (!zone) return;
  const name = zoneName(zone);
  zone.enabled = !zone.enabled;
  zone.updatedAt = new Date().toISOString();
  try {
    await saveDeliveryState();
  } catch {
    await showDeliveryStorageError();
    return;
  }
  renderDeliveryZones();
  AdminCore.toast(t('admin_zone_status_changed', { name }), 'success');
}

async function deleteZone(id) {
  const zone = deliveryState.zones.find(item => String(item.id) === String(id));
  if (!zone) return;
  const name = zoneName(zone);
  const accepted = await AdminCore.confirm({
    title: t('admin_delete_zone_title'),
    message: t('admin_delete_zone_body', { name }),
    confirmLabel: t('admin_delete_local')
  });
  if (!accepted) return;
  deliveryState.zones = deliveryState.zones.filter(item => String(item.id) !== String(id));
  try {
    await saveDeliveryState();
  } catch {
    await showDeliveryStorageError();
    return;
  }
  renderDeliveryZones();
  AdminCore.toast(t('admin_zone_deleted', { name }), 'success');
}

window.addEventListener('admin:ready', () => {
  canEditWorkspace = AdminCore.canEditWorkspace();
  deliveryZoneModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('deliveryZoneModal'));
  loadDeliveryState();
  document.getElementById('deliveryRulesSubmit').disabled = !canEditWorkspace;
  document.getElementById('addZoneButton').disabled = !canEditWorkspace;
  document.getElementById('deliveryZoneSubmit').disabled = !canEditWorkspace;
  fillDeliveryRules();
  document.getElementById('deliveryRulesForm').addEventListener('submit', submitDeliveryRules);
  document.getElementById('deliveryRulesCancel').addEventListener('click', fillDeliveryRules);
  document.getElementById('addZoneButton').addEventListener('click', () => openZoneModal());
  document.getElementById('deliveryZoneForm').addEventListener('submit', submitZone);
  requestAnimationFrame(renderDeliveryZones);
});

window.addEventListener('am:langchange', () => {
  if (!deliveryState) return;
  renderDeliveryZones();
  const id = document.getElementById('deliveryZoneId')?.value;
  if (document.getElementById('deliveryZoneModal')?.classList.contains('show')) {
    document.getElementById('deliveryZoneModalTitle').textContent = t(id ? 'admin_edit_zone' : 'admin_add_zone');
  }
});
