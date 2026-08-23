/**
 * AM MARKET admin settings.
 * Store details are local-only; interface preferences reuse am_theme and am_lang.
 */
Object.assign(I18N.en, {
  title_admin_settings: 'Settings — AM MARKET Admin',
  admin_configuration: 'Configuration',
  admin_settings_title: 'Settings',
  admin_settings_intro: 'Manage local prototype store information and interface preferences.',
  admin_settings_local_note: 'Store details below are saved only in this browser and are not published.',
  admin_store_information: 'Store information',
  admin_store_information_sub: 'Local prototype contact and identity fields.',
  admin_store_name: 'Store name',
  admin_contact_email: 'Contact email',
  admin_contact_phone: 'Contact phone',
  admin_store_address: 'Store address',
  admin_name_required: 'Enter a name.',
  admin_valid_email: 'Enter a valid email address.',
  admin_cancel: 'Cancel',
  admin_save_local: 'Save locally',
  admin_saving: 'Saving…',
  admin_appearance_language: 'Appearance & language',
  admin_preferences_browser_note: 'Preferences use the same browser settings as the storefront.',
  admin_theme: 'Theme',
  admin_light: 'Light',
  admin_light_sub: 'Bright interface',
  admin_dark: 'Dark',
  admin_dark_sub: 'Low-light interface',
  admin_language: 'Language',
  admin_requires_backend: 'Requires backend',
  admin_security_title: 'Security',
  admin_security_inert: 'This prototype cannot provide password changes, roles, two-factor authentication, or audit logs. No controls are shown because those features require a real backend.',
  admin_store_settings_saved: 'Store information was saved locally.',
  admin_store_settings_reset: 'Unsaved store information was reset.',
  admin_theme_changed: 'Theme preference was updated in this browser.',
  admin_language_changed: 'Language preference was updated in this browser.'
});

Object.assign(I18N.fr, {
  title_admin_settings: 'Paramètres — Administration AM MARKET',
  admin_configuration: 'Configuration',
  admin_settings_title: 'Paramètres',
  admin_settings_intro: 'Gérez les informations locales du magasin et les préférences de l’interface.',
  admin_settings_local_note: 'Les informations ci-dessous sont enregistrées uniquement dans ce navigateur et ne sont pas publiées.',
  admin_store_information: 'Informations du magasin',
  admin_store_information_sub: 'Champs locaux d’identité et de contact du prototype.',
  admin_store_name: 'Nom du magasin',
  admin_contact_email: 'E-mail de contact',
  admin_contact_phone: 'Téléphone de contact',
  admin_store_address: 'Adresse du magasin',
  admin_name_required: 'Saisissez un nom.',
  admin_valid_email: 'Saisissez une adresse e-mail valide.',
  admin_cancel: 'Annuler',
  admin_save_local: 'Enregistrer localement',
  admin_saving: 'Enregistrement…',
  admin_appearance_language: 'Apparence et langue',
  admin_preferences_browser_note: 'Ces préférences utilisent les mêmes réglages de navigateur que la boutique.',
  admin_theme: 'Thème',
  admin_light: 'Clair',
  admin_light_sub: 'Interface lumineuse',
  admin_dark: 'Sombre',
  admin_dark_sub: 'Interface pour faible luminosité',
  admin_language: 'Langue',
  admin_requires_backend: 'Nécessite un backend',
  admin_security_title: 'Sécurité',
  admin_security_inert: 'Ce prototype ne peut pas gérer les changements de mot de passe, les rôles, la double authentification ou les journaux d’audit. Aucun contrôle n’est affiché car ces fonctions exigent un vrai backend.',
  admin_store_settings_saved: 'Les informations du magasin ont été enregistrées localement.',
  admin_store_settings_reset: 'Les modifications non enregistrées ont été annulées.',
  admin_theme_changed: 'La préférence de thème a été modifiée dans ce navigateur.',
  admin_language_changed: 'La préférence de langue a été modifiée dans ce navigateur.'
});

const DEFAULT_ADMIN_SETTINGS = {
  version: 1,
  storeName: 'AM MARKET',
  email: '',
  phone: '',
  address: ''
};

let adminSettings;

function settingsStorageKey() {
  return AdminCore.storageKeys?.settings || AdminCore.keys?.settings || 'am_admin_settings_v1';
}

function loadAdminSettings() {
  const saved = AdminCore.read(settingsStorageKey(), DEFAULT_ADMIN_SETTINGS);
  adminSettings = {
    ...DEFAULT_ADMIN_SETTINGS,
    ...(saved && typeof saved === 'object' ? saved : {}),
    version: 1
  };
}

function fillSettingsForm() {
  document.getElementById('storeName').value = adminSettings.storeName || 'AM MARKET';
  document.getElementById('storeEmail').value = adminSettings.email || '';
  document.getElementById('storePhone').value = adminSettings.phone || '';
  document.getElementById('storeAddress').value = adminSettings.address || '';
  const form = document.getElementById('storeSettingsForm');
  form.classList.remove('was-validated');
  form.querySelectorAll('.is-invalid').forEach(field => field.classList.remove('is-invalid'));
}

function updatePreferenceChoices() {
  document.querySelectorAll('[data-admin-theme-choice]').forEach(button => {
    const active = button.dataset.adminThemeChoice === getTheme();
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-admin-lang-choice]').forEach(button => {
    const active = button.dataset.adminLangChoice === getLang();
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function submitStoreSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = document.getElementById('storeName');
  const email = document.getElementById('storeEmail');
  const validName = Boolean(name.value.trim());
  const validEmail = !email.value.trim() || email.checkValidity();
  name.classList.toggle('is-invalid', !validName);
  email.classList.toggle('is-invalid', !validEmail);
  form.classList.add('was-validated');
  if (!validName || !validEmail) return;
  const button = document.getElementById('storeSettingsSubmit');
  AdminCore.setBusy(button, true, t('admin_saving'));
  await Promise.resolve();
  const nextSettings = {
    version: 1,
    storeName: name.value.trim(),
    email: email.value.trim(),
    phone: document.getElementById('storePhone').value.trim(),
    address: document.getElementById('storeAddress').value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (AdminCore.write(settingsStorageKey(), nextSettings) === undefined) {
    AdminCore.setBusy(button, false);
    return;
  }
  adminSettings = nextSettings;
  AdminCore.setBusy(button, false);
  fillSettingsForm();
  AdminCore.toast(t('admin_store_settings_saved'), 'success');
}

function chooseTheme(theme) {
  if (theme === getTheme()) return;
  setTheme(theme);
  updatePreferenceChoices();
  AdminCore.syncControls?.();
  AdminCore.toast(t('admin_theme_changed'), 'success');
}

function chooseLanguage(language) {
  if (language === getLang()) return;
  setLang(language);
  updatePreferenceChoices();
  AdminCore.toast(t('admin_language_changed'), 'success');
}

window.addEventListener('admin:ready', () => {
  loadAdminSettings();
  fillSettingsForm();
  updatePreferenceChoices();
  document.getElementById('storeSettingsForm').addEventListener('submit', submitStoreSettings);
  document.getElementById('storeSettingsCancel').addEventListener('click', () => {
    fillSettingsForm();
    AdminCore.toast(t('admin_store_settings_reset'), 'info');
  });
  document.querySelectorAll('[data-admin-theme-choice]').forEach(button => {
    button.addEventListener('click', () => chooseTheme(button.dataset.adminThemeChoice));
  });
  document.querySelectorAll('[data-admin-lang-choice]').forEach(button => {
    button.addEventListener('click', () => chooseLanguage(button.dataset.adminLangChoice));
  });
});

window.addEventListener('am:langchange', updatePreferenceChoices);
