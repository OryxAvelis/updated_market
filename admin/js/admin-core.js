/**
 * AM MARKET admin shared UI.
 *
 * This is a frontend-only prototype. Authentication is delegated exclusively
 * to admin-auth.js and all admin writes remain in this browser's localStorage.
 */
(() => {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    orders: 'am_orders',
    products: 'am_admin_products_v1',
    productEdits: 'am_admin_product_edits_v1',
    productDeletes: 'am_admin_product_deletes_v1',
    categories: 'am_admin_categories_v1',
    categoryEdits: 'am_admin_category_edits_v1',
    categoryDeletes: 'am_admin_category_deletes_v1',
    orderStatuses: 'am_admin_order_statuses_v1',
    inventory: 'am_admin_inventory_v1',
    promotions: 'am_admin_promotions_v1',
    delivery: 'am_admin_delivery_v1',
    settings: 'am_admin_settings_v1'
  });

  const ROUTES = Object.freeze([
    { id: 'dashboard', file: 'index.html', icon: 'fa-gauge-high', label: 'admin_nav_dashboard' },
    { id: 'products', file: 'products.html', icon: 'fa-box-open', label: 'admin_nav_products' },
    { id: 'categories', file: 'categories.html', icon: 'fa-shapes', label: 'admin_nav_categories' },
    { id: 'orders', file: 'orders.html', icon: 'fa-receipt', label: 'admin_nav_orders' },
    { id: 'customers', file: 'customers.html', icon: 'fa-users', label: 'admin_nav_customers' },
    { id: 'inventory', file: 'inventory.html', icon: 'fa-boxes-stacked', label: 'admin_nav_inventory' },
    { id: 'promotions', file: 'promotions.html', icon: 'fa-tags', label: 'admin_nav_promotions' },
    { id: 'delivery', file: 'delivery.html', icon: 'fa-truck-fast', label: 'admin_nav_delivery' },
    { id: 'analytics', file: 'analytics.html', icon: 'fa-chart-line', label: 'admin_nav_analytics' },
    { id: 'settings', file: 'settings.html', icon: 'fa-gear', label: 'admin_nav_settings' }
  ]);

  const TRANSLATIONS = {
    en: {
      title_admin_login: 'Admin sign in — AM MARKET',
      title_admin_dashboard: 'Admin dashboard — AM MARKET',
      title_admin_products: 'Products — AM MARKET Admin',
      title_admin_categories: 'Categories — AM MARKET Admin',
      title_admin_orders: 'Orders — AM MARKET Admin',
      title_admin_customers: 'Customers — AM MARKET Admin',
      title_admin_inventory: 'Inventory — AM MARKET Admin',
      title_admin_promotions: 'Promotions — AM MARKET Admin',
      title_admin_delivery: 'Delivery — AM MARKET Admin',
      title_admin_analytics: 'Analytics — AM MARKET Admin',
      title_admin_settings: 'Settings — AM MARKET Admin',
      admin_skip_content: 'Skip to admin content',
      admin_panel: 'Admin panel',
      admin_prototype: 'Frontend prototype',
      admin_local_note: 'Local-only prototype. Changes stay in this browser and are not secured or sent to a server.',
      admin_primary_nav: 'Admin sections',
      admin_brand_label: 'AM MARKET admin panel',
      admin_display_settings: 'Display settings',
      admin_open_menu: 'Open admin menu',
      admin_close_menu: 'Close admin menu',
      admin_toggle_theme: 'Toggle color theme',
      admin_change_language: 'Change language',
      admin_theme_light: 'Light theme enabled',
      admin_theme_dark: 'Dark theme enabled',
      admin_language_changed: 'Language changed',
      admin_signed_in_as: 'Signed in as',
      admin_logout: 'Log out',
      admin_logged_out: 'You have been logged out',
      admin_nav_dashboard: 'Dashboard',
      admin_nav_products: 'Products',
      admin_nav_categories: 'Categories',
      admin_nav_orders: 'Orders',
      admin_nav_customers: 'Customers',
      admin_nav_inventory: 'Inventory',
      admin_nav_promotions: 'Promotions',
      admin_nav_delivery: 'Delivery',
      admin_nav_analytics: 'Analytics',
      admin_nav_settings: 'Settings',
      admin_loading: 'Loading…',
      admin_loading_body: 'Retrieving the latest browser data.',
      admin_empty: 'Nothing here yet',
      admin_error: 'Something went wrong',
      admin_retry: 'Try again',
      admin_cancel: 'Cancel',
      admin_delete: 'Delete',
      admin_confirm_title: 'Confirm this action',
      admin_confirm_body: 'This action cannot be undone in this browser.',
      admin_storage_error: 'This browser could not store the change',
      admin_saved_local: 'Change stored in this browser only',
      admin_login_eyebrow: 'AM MARKET administration',
      admin_login_title: 'Welcome back',
      admin_login_intro: 'Sign in to open the local admin prototype.',
      admin_login_email: 'Admin email',
      admin_login_password: 'Password',
      admin_required: 'Required',
      admin_login_submit: 'Sign in',
      admin_login_signing_in: 'Signing in…',
      admin_login_email_placeholder: 'name@example.com',
      admin_login_password_placeholder: 'Enter your password',
      admin_login_email_required: 'Enter the admin email.',
      admin_login_email_invalid: 'Enter a valid email address.',
      admin_login_password_required: 'Enter the admin password.',
      admin_login_empty_summary: 'Enter your email and password to continue.',
      admin_login_wrong: 'The email or password is incorrect.',
      admin_login_success: 'Signed in successfully',
      admin_login_notice_title: 'Prototype access only',
      admin_login_notice: 'This sign-in runs entirely in your browser. It is not secure authentication and does not connect to a backend.',
      admin_login_storefront: 'Return to storefront',
      admin_dashboard_eyebrow: 'Browser snapshot',
      admin_dashboard_title: 'Store overview',
      admin_dashboard_intro: 'Local orders and the read-only AM MARKET catalog at a glance.',
      admin_dashboard_metrics: 'Dashboard metrics',
      admin_dashboard_refresh: 'Refresh dashboard',
      admin_dashboard_refreshing: 'Refreshing…',
      admin_dashboard_refreshed: 'Dashboard refreshed',
      admin_dashboard_sales: 'Sales',
      admin_dashboard_orders: 'Orders',
      admin_dashboard_customers: 'Customers',
      admin_dashboard_products: 'Products',
      admin_dashboard_local_orders: 'From local browser orders',
      admin_dashboard_unique_customers: 'Unique local order contacts',
      admin_dashboard_catalog_total: 'Catalog plus local product overlay',
      admin_dashboard_local_label: 'Local browser',
      admin_dashboard_six_months: 'Last six months',
      admin_dashboard_period_total: 'Period total',
      admin_dashboard_no_orders: 'No local orders yet',
      admin_dashboard_demo_label: 'Demo fallback',
      admin_dashboard_demo_banner_title: 'Demo dashboard preview',
      admin_dashboard_demo_banner: 'There are no orders in this browser, so sales, order, customer and chart values below are clearly labeled demo data. Catalog values still come from the live read-only catalog.',
      admin_dashboard_local_banner_title: 'Local browser data',
      admin_dashboard_local_banner: 'Sales, orders and customers are calculated from orders stored in this browser only.',
      admin_dashboard_sales_trend: 'Sales trend',
      admin_dashboard_sales_chart_label: 'Sales trend chart',
      admin_dashboard_order_status: 'Order status',
      admin_dashboard_status_chart_label: 'Orders grouped by status',
      admin_dashboard_recent_orders: 'Recent orders',
      admin_dashboard_recent_intro: 'The newest orders stored in this browser.',
      admin_dashboard_order_id: 'Order',
      admin_dashboard_date: 'Date',
      admin_dashboard_customer: 'Customer',
      admin_dashboard_total: 'Total',
      admin_dashboard_status: 'Status',
      admin_dashboard_no_recent_title: 'No local orders to show',
      admin_dashboard_no_recent_body: 'Complete an order in the storefront to see it here.',
      admin_dashboard_open_storefront: 'Open storefront',
      admin_dashboard_catalog: 'Catalog snapshot',
      admin_dashboard_catalog_intro: 'Local product statuses, availability sample, and top-level categories.',
      admin_dashboard_product_status: 'Product status',
      admin_product_status_active: 'Active products',
      admin_product_status_draft: 'Draft products',
      admin_product_status_archived: 'Archived products',
      admin_dashboard_available: 'Available',
      admin_dashboard_unavailable: 'Unavailable',
      admin_dashboard_categories: 'Top-level categories',
      admin_dashboard_full_catalog: 'Availability covers the full catalog.',
      admin_dashboard_loaded_sample: 'Availability reflects {n} loaded catalog products.',
      admin_dashboard_catalog_error_title: 'Catalog unavailable',
      admin_dashboard_catalog_error_body: 'The read-only catalog could not be loaded. Local order metrics are still available.',
      admin_dashboard_local_only_title: 'What this prototype can do',
      admin_dashboard_local_only_body: 'It can inspect storefront orders saved in this browser and read the public catalog. Admin changes elsewhere in this prototype remain local and are never sent to a server.',
      admin_status_processing: 'Processing',
      admin_status_confirmed: 'Confirmed',
      admin_status_preparing: 'Preparing',
      admin_status_shipping: 'Shipping',
      admin_status_delivered: 'Delivered',
      admin_status_cancelled: 'Cancelled',
      admin_status_other: 'Other',
      admin_unknown_customer: 'Local customer',
      admin_not_available: 'Not available'
    },
    fr: {
      title_admin_login: 'Connexion administrateur — AM MARKET',
      title_admin_dashboard: 'Tableau de bord administrateur — AM MARKET',
      title_admin_products: 'Produits — Administration AM MARKET',
      title_admin_categories: 'Catégories — Administration AM MARKET',
      title_admin_orders: 'Commandes — Administration AM MARKET',
      title_admin_customers: 'Clients — Administration AM MARKET',
      title_admin_inventory: 'Stock — Administration AM MARKET',
      title_admin_promotions: 'Promotions — Administration AM MARKET',
      title_admin_delivery: 'Livraison — Administration AM MARKET',
      title_admin_analytics: 'Analyses — Administration AM MARKET',
      title_admin_settings: 'Paramètres — Administration AM MARKET',
      admin_skip_content: 'Aller au contenu administrateur',
      admin_panel: 'Espace administrateur',
      admin_prototype: 'Prototype frontend',
      admin_local_note: 'Prototype local uniquement. Les modifications restent dans ce navigateur, ne sont pas sécurisées et ne sont envoyées à aucun serveur.',
      admin_primary_nav: 'Sections administrateur',
      admin_brand_label: 'Espace administrateur AM MARKET',
      admin_display_settings: 'Paramètres d’affichage',
      admin_open_menu: 'Ouvrir le menu administrateur',
      admin_close_menu: 'Fermer le menu administrateur',
      admin_toggle_theme: 'Changer le thème de couleur',
      admin_change_language: 'Changer de langue',
      admin_theme_light: 'Thème clair activé',
      admin_theme_dark: 'Thème sombre activé',
      admin_language_changed: 'Langue modifiée',
      admin_signed_in_as: 'Connecté en tant que',
      admin_logout: 'Se déconnecter',
      admin_logged_out: 'Vous êtes déconnecté',
      admin_nav_dashboard: 'Tableau de bord',
      admin_nav_products: 'Produits',
      admin_nav_categories: 'Catégories',
      admin_nav_orders: 'Commandes',
      admin_nav_customers: 'Clients',
      admin_nav_inventory: 'Stock',
      admin_nav_promotions: 'Promotions',
      admin_nav_delivery: 'Livraison',
      admin_nav_analytics: 'Analyses',
      admin_nav_settings: 'Paramètres',
      admin_loading: 'Chargement…',
      admin_loading_body: 'Récupération des dernières données du navigateur.',
      admin_empty: 'Aucun élément pour le moment',
      admin_error: 'Une erreur est survenue',
      admin_retry: 'Réessayer',
      admin_cancel: 'Annuler',
      admin_delete: 'Supprimer',
      admin_confirm_title: 'Confirmer cette action',
      admin_confirm_body: 'Cette action est irréversible dans ce navigateur.',
      admin_storage_error: 'Le navigateur n’a pas pu enregistrer la modification',
      admin_saved_local: 'Modification stockée dans ce navigateur uniquement',
      admin_login_eyebrow: 'Administration AM MARKET',
      admin_login_title: 'Heureux de vous revoir',
      admin_login_intro: 'Connectez-vous pour ouvrir le prototype d’administration local.',
      admin_login_email: 'E-mail administrateur',
      admin_login_password: 'Mot de passe',
      admin_required: 'Obligatoire',
      admin_login_submit: 'Se connecter',
      admin_login_signing_in: 'Connexion…',
      admin_login_email_placeholder: 'nom@exemple.com',
      admin_login_password_placeholder: 'Saisissez votre mot de passe',
      admin_login_email_required: 'Saisissez l’e-mail administrateur.',
      admin_login_email_invalid: 'Saisissez une adresse e-mail valide.',
      admin_login_password_required: 'Saisissez le mot de passe administrateur.',
      admin_login_empty_summary: 'Saisissez votre e-mail et votre mot de passe pour continuer.',
      admin_login_wrong: 'L’e-mail ou le mot de passe est incorrect.',
      admin_login_success: 'Connexion réussie',
      admin_login_notice_title: 'Accès au prototype uniquement',
      admin_login_notice: 'Cette connexion fonctionne entièrement dans votre navigateur. Ce n’est pas une authentification sécurisée et aucun backend n’est utilisé.',
      admin_login_storefront: 'Retour à la boutique',
      admin_dashboard_eyebrow: 'Aperçu du navigateur',
      admin_dashboard_title: 'Vue d’ensemble de la boutique',
      admin_dashboard_intro: 'Les commandes locales et le catalogue AM MARKET en lecture seule en un coup d’œil.',
      admin_dashboard_metrics: 'Indicateurs du tableau de bord',
      admin_dashboard_refresh: 'Actualiser le tableau de bord',
      admin_dashboard_refreshing: 'Actualisation…',
      admin_dashboard_refreshed: 'Tableau de bord actualisé',
      admin_dashboard_sales: 'Ventes',
      admin_dashboard_orders: 'Commandes',
      admin_dashboard_customers: 'Clients',
      admin_dashboard_products: 'Produits',
      admin_dashboard_local_orders: 'D’après les commandes locales du navigateur',
      admin_dashboard_unique_customers: 'Contacts uniques des commandes locales',
      admin_dashboard_catalog_total: 'Catalogue et surcouche produit locale',
      admin_dashboard_local_label: 'Navigateur local',
      admin_dashboard_six_months: 'Six derniers mois',
      admin_dashboard_period_total: 'Total de la période',
      admin_dashboard_no_orders: 'Aucune commande locale',
      admin_dashboard_demo_label: 'Données de démonstration',
      admin_dashboard_demo_banner_title: 'Aperçu de démonstration',
      admin_dashboard_demo_banner: 'Aucune commande n’est stockée dans ce navigateur. Les valeurs de ventes, commandes, clients et graphiques ci-dessous sont donc clairement identifiées comme données de démonstration. Les valeurs du catalogue proviennent toujours du catalogue réel en lecture seule.',
      admin_dashboard_local_banner_title: 'Données locales du navigateur',
      admin_dashboard_local_banner: 'Les ventes, commandes et clients sont calculés à partir des commandes stockées uniquement dans ce navigateur.',
      admin_dashboard_sales_trend: 'Évolution des ventes',
      admin_dashboard_sales_chart_label: 'Graphique de l’évolution des ventes',
      admin_dashboard_order_status: 'Statut des commandes',
      admin_dashboard_status_chart_label: 'Commandes regroupées par statut',
      admin_dashboard_recent_orders: 'Commandes récentes',
      admin_dashboard_recent_intro: 'Les commandes les plus récentes stockées dans ce navigateur.',
      admin_dashboard_order_id: 'Commande',
      admin_dashboard_date: 'Date',
      admin_dashboard_customer: 'Client',
      admin_dashboard_total: 'Total',
      admin_dashboard_status: 'Statut',
      admin_dashboard_no_recent_title: 'Aucune commande locale à afficher',
      admin_dashboard_no_recent_body: 'Finalisez une commande dans la boutique pour la voir ici.',
      admin_dashboard_open_storefront: 'Ouvrir la boutique',
      admin_dashboard_catalog: 'Aperçu du catalogue',
      admin_dashboard_catalog_intro: 'Statuts produit locaux, échantillon de disponibilité et catégories principales.',
      admin_dashboard_product_status: 'Statut des produits',
      admin_product_status_active: 'Produits actifs',
      admin_product_status_draft: 'Produits en brouillon',
      admin_product_status_archived: 'Produits archivés',
      admin_dashboard_available: 'Disponibles',
      admin_dashboard_unavailable: 'Indisponibles',
      admin_dashboard_categories: 'Catégories principales',
      admin_dashboard_full_catalog: 'La disponibilité couvre tout le catalogue.',
      admin_dashboard_loaded_sample: 'La disponibilité reflète {n} produits du catalogue chargés.',
      admin_dashboard_catalog_error_title: 'Catalogue indisponible',
      admin_dashboard_catalog_error_body: 'Le catalogue en lecture seule n’a pas pu être chargé. Les indicateurs de commandes locales restent disponibles.',
      admin_dashboard_local_only_title: 'Fonctions de ce prototype',
      admin_dashboard_local_only_body: 'Il peut consulter les commandes de la boutique enregistrées dans ce navigateur et lire le catalogue public. Les modifications effectuées ailleurs dans ce prototype restent locales et ne sont jamais envoyées à un serveur.',
      admin_status_processing: 'En traitement',
      admin_status_confirmed: 'Confirmée',
      admin_status_preparing: 'En préparation',
      admin_status_shipping: 'En livraison',
      admin_status_delivered: 'Livrée',
      admin_status_cancelled: 'Annulée',
      admin_status_other: 'Autre',
      admin_unknown_customer: 'Client local',
      admin_not_available: 'Non disponible'
    }
  };

  if (typeof I18N === 'object' && I18N.en && I18N.fr) {
    Object.assign(I18N.en, TRANSLATIONS.en);
    Object.assign(I18N.fr, TRANSLATIONS.fr);
  }

  const body = document.body;
  const filename = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const publicPage = body?.dataset.adminPublic === 'true' || filename === 'login.html';
  const page = body?.dataset.adminPage || ROUTES.find(route => route.file === filename)?.id || 'dashboard';
  const session = window.AdminAuth?.getSession?.() || null;

  if (!publicPage && !session) {
    const next = ROUTES.some(route => route.file === filename) ? filename : 'index.html';
    location.replace(`login.html?next=${encodeURIComponent(next)}`);
    return;
  }

  let drawerOpen = false;
  let drawerTrigger = null;

  const tr = (key, vars) => typeof t === 'function' ? t(key, vars) : (TRANSLATIONS.en[key] || key);

  function escapeValue(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
  }

  function read(key, fallback = null) {
    try {
      const raw = localStorage.getItem(String(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function readResult(key, fallback = null) {
    try {
      const raw = localStorage.getItem(String(key));
      return { ok: true, exists: raw !== null, value: raw === null ? fallback : JSON.parse(raw) };
    } catch {
      return { ok: false, exists: true, value: fallback };
    }
  }

  function write(key, value) {
    try {
      if (value === undefined) localStorage.removeItem(String(key));
      else localStorage.setItem(String(key), JSON.stringify(value));
      window.dispatchEvent(new CustomEvent('admin:storagechange', { detail: { key: String(key), value } }));
      return value;
    } catch {
      toast(tr('admin_storage_error'), 'error');
      return undefined;
    }
  }

  function formatDate(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const locale = typeof getLang === 'function' && getLang() === 'fr' ? 'fr-MA' : 'en-MA';
    const resolvedOptions = Object.keys(options).length ? options : { dateStyle: 'medium' };
    try {
      return new Intl.DateTimeFormat(locale, resolvedOptions).format(date);
    } catch {
      return date.toLocaleDateString();
    }
  }

  function flattenCategories(list) {
    const output = [];
    const visitedObjects = new WeakSet();
    const visitedIds = new Set();
    const walk = (items, depth = 0, inheritedParent = null) => {
      if (!Array.isArray(items)) return;
      items.forEach(category => {
        if (!category || typeof category !== 'object') return;
        if (visitedObjects.has(category)) return;
        const idKey = category.id == null ? null : String(category.id);
        if (idKey && visitedIds.has(idKey)) return;
        visitedObjects.add(category);
        if (idKey) visitedIds.add(idKey);
        const parentId = category.parent_id ?? category.parentId ?? inheritedParent ?? null;
        const name = category.name || category.title || '';
        output.push({
          ...category,
          depth,
          parentId,
          displayName: `${depth ? '— '.repeat(depth) : ''}${name}`
        });
        const children = category.children || category.subcategories || category.categories || [];
        walk(children, depth + 1, category.id ?? inheritedParent);
      });
    };
    walk(list);
    return output;
  }

  function toast(message, type = 'success') {
    const element = document.getElementById('adminToast');
    if (!element || !window.bootstrap?.Toast) return;
    const normalizedType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    element.dataset.type = normalizedType;
    const icon = element.querySelector('[data-admin-toast-icon]');
    const messageElement = element.querySelector('[data-admin-toast-message]');
    const icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      warning: 'fa-triangle-exclamation',
      info: 'fa-circle-info'
    };
    if (icon) icon.className = `fa-solid ${icons[normalizedType]}`;
    if (messageElement) messageElement.textContent = String(message ?? '');
    bootstrap.Toast.getOrCreateInstance(element, { delay: 3600 }).show();
  }

  function confirmAction({ title, message, confirmLabel } = {}) {
    const element = document.getElementById('adminConfirmModal');
    if (!element || !window.bootstrap?.Modal) return Promise.resolve(window.confirm(String(message || '')));
    element.querySelector('[data-admin-confirm-title]').textContent = title || tr('admin_confirm_title');
    element.querySelector('[data-admin-confirm-message]').textContent = message || tr('admin_confirm_body');
    const confirmButton = element.querySelector('[data-admin-confirm-accept]');
    confirmButton.textContent = confirmLabel || tr('admin_delete');

    return new Promise(resolve => {
      const modal = bootstrap.Modal.getOrCreateInstance(element, { backdrop: 'static', keyboard: true });
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        confirmButton.removeEventListener('click', accept);
        element.removeEventListener('hidden.bs.modal', dismiss);
        resolve(value);
      };
      const accept = () => {
        modal.hide();
        finish(true);
      };
      const dismiss = () => finish(false);
      confirmButton.addEventListener('click', accept);
      element.addEventListener('hidden.bs.modal', dismiss);
      modal.show();
    });
  }

  function state(container, {
    type = 'empty',
    title = '',
    body: stateBody = '',
    actionLabel = '',
    onAction = null
  } = {}) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return null;
    const normalizedType = ['loading', 'empty', 'error'].includes(type) ? type : 'empty';
    const icons = {
      loading: '<span class="spinner-border" aria-hidden="true"></span>',
      empty: '<i class="fa-regular fa-folder-open" aria-hidden="true"></i>',
      error: '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'
    };
    const fallbackTitles = {
      loading: tr('admin_loading'),
      empty: tr('admin_empty'),
      error: tr('admin_error')
    };
    container.innerHTML = `
      <div class="admin-state admin-state--${normalizedType}" role="${normalizedType === 'error' ? 'alert' : 'status'}"${normalizedType === 'loading' ? ' aria-busy="true"' : ''}>
        <div class="admin-state-icon">${icons[normalizedType]}</div>
        <h3 class="admin-state-title">${escapeValue(title || fallbackTitles[normalizedType])}</h3>
        ${stateBody ? `<p class="admin-state-body">${escapeValue(stateBody)}</p>` : ''}
        ${actionLabel && typeof onAction === 'function' ? `<button class="admin-button admin-button--secondary admin-state-action" type="button">${escapeValue(actionLabel)}</button>` : ''}
      </div>`;
    const root = container.firstElementChild;
    root?.querySelector('.admin-state-action')?.addEventListener('click', onAction);
    return root;
  }

  function setBusy(button, busy, label = '') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.adminBusyHtml) button.dataset.adminBusyHtml = button.innerHTML;
      button.dataset.adminWasDisabled = String(button.disabled);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>${label ? `<span>${escapeValue(label)}</span>` : ''}`;
      return;
    }
    if (button.dataset.adminBusyHtml) button.innerHTML = button.dataset.adminBusyHtml;
    button.disabled = button.dataset.adminWasDisabled === 'true';
    button.removeAttribute('aria-busy');
    delete button.dataset.adminBusyHtml;
    delete button.dataset.adminWasDisabled;
  }

  function feedbackMarkup() {
    return `
      <div class="admin-toast-region toast-container position-fixed bottom-0 end-0 p-3" aria-live="polite" aria-atomic="true">
        <div class="admin-toast toast" id="adminToast" role="status" aria-live="polite" aria-atomic="true">
          <div class="admin-toast-body">
            <span class="admin-toast-icon" aria-hidden="true"><i class="fa-solid fa-circle-check" data-admin-toast-icon></i></span>
            <span class="admin-toast-message" data-admin-toast-message></span>
            <button type="button" class="admin-icon-button admin-toast-close" data-bs-dismiss="toast" aria-label="Close" data-i18n-aria="close">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
      <div class="modal fade admin-confirm-modal" id="adminConfirmModal" tabindex="-1" aria-labelledby="adminConfirmTitle" aria-describedby="adminConfirmMessage" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <div class="admin-confirm-icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></div>
              <h2 class="modal-title fs-5" id="adminConfirmTitle" data-admin-confirm-title>${escapeValue(tr('admin_confirm_title'))}</h2>
              <button type="button" class="admin-icon-button" data-bs-dismiss="modal" aria-label="Close" data-i18n-aria="close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
            <div class="modal-body"><p class="mb-0" id="adminConfirmMessage" data-admin-confirm-message>${escapeValue(tr('admin_confirm_body'))}</p></div>
            <div class="modal-footer">
              <button type="button" class="admin-button admin-button--secondary" data-bs-dismiss="modal" data-i18n="admin_cancel">Cancel</button>
              <button type="button" class="admin-button admin-button--danger" data-admin-confirm-accept>${escapeValue(tr('admin_delete'))}</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function ensureFeedback() {
    if (!document.getElementById('adminToast')) document.body.insertAdjacentHTML('beforeend', feedbackMarkup());
    if (typeof applyI18n === 'function') applyI18n(document.body);
  }

  function sidebarMarkup() {
    const links = ROUTES.map(route => {
      const active = route.id === page;
      return `
        <a class="admin-nav-link${active ? ' is-active' : ''}" href="${route.file}"${active ? ' aria-current="page"' : ''}>
          <i class="fa-solid ${route.icon}" aria-hidden="true"></i>
          <span data-i18n="${route.label}">${escapeValue(TRANSLATIONS.en[route.label])}</span>
        </a>`;
    }).join('');
    return `
      <a class="admin-skip-link" href="#adminMain" data-i18n="admin_skip_content">Skip to admin content</a>
      <div class="admin-shell">
        <aside class="admin-sidebar" id="adminSidebar" aria-label="Admin sections" data-i18n-aria="admin_primary_nav">
          <div class="admin-sidebar-head">
            <a class="admin-brand" href="index.html" aria-label="AM MARKET admin panel" data-i18n-aria="admin_brand_label">
              <img src="../img/logo-round.png" alt="" width="44" height="44">
              <span><strong>AM MARKET</strong><small data-i18n="admin_panel">Admin panel</small></span>
            </a>
            <button type="button" class="admin-icon-button admin-drawer-close" data-admin-drawer-close aria-label="Close admin menu" data-i18n-aria="admin_close_menu">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
          <nav class="admin-nav" aria-label="Admin sections" data-i18n-aria="admin_primary_nav">${links}</nav>
          <div class="admin-sidebar-note">
            <i class="fa-solid fa-laptop-file" aria-hidden="true"></i>
            <div><strong data-i18n="admin_prototype">Frontend prototype</strong><p data-i18n="admin_local_note">Local-only prototype. Changes stay in this browser and are not secured or sent to a server.</p></div>
          </div>
        </aside>
        <button class="admin-drawer-overlay" type="button" data-admin-drawer-close tabindex="-1" aria-label="Close admin menu" data-i18n-aria="admin_close_menu"></button>
        <div class="admin-workspace" id="adminWorkspace">
          <header class="admin-topbar">
            <div class="admin-topbar-leading">
              <button type="button" class="admin-icon-button admin-menu-button" data-admin-drawer-open aria-expanded="false" aria-controls="adminSidebar" aria-label="Open admin menu" data-i18n-aria="admin_open_menu">
                <i class="fa-solid fa-bars" aria-hidden="true"></i>
              </button>
              <div><p class="admin-topbar-eyebrow" data-i18n="admin_prototype">Frontend prototype</p><p class="admin-topbar-title" data-admin-page-title></p></div>
            </div>
            <div class="admin-topbar-actions">
              <div class="admin-session-copy">
                <span data-i18n="admin_signed_in_as">Signed in as</span>
                <strong data-admin-email></strong>
              </div>
              <button type="button" class="admin-icon-button" data-admin-theme aria-label="Toggle color theme" data-i18n-aria="admin_toggle_theme" title="Toggle color theme" data-i18n-title="admin_toggle_theme"><i class="fa-solid fa-moon" data-admin-theme-icon aria-hidden="true"></i></button>
              <button type="button" class="admin-icon-button admin-language-button" data-admin-lang aria-label="Change language" data-i18n-aria="admin_change_language" title="Change language" data-i18n-title="admin_change_language"><i class="fa-solid fa-globe" aria-hidden="true"></i><span data-admin-lang-label>EN</span></button>
              <button type="button" class="admin-button admin-button--secondary admin-logout-button" data-admin-logout><i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i><span data-i18n="admin_logout">Log out</span></button>
            </div>
          </header>
          <div class="admin-content" data-admin-content></div>
        </div>
      </div>`;
  }

  function pageTitleKey() {
    return `admin_nav_${page}`;
  }

  function updateDynamicControls() {
    document.querySelectorAll('[data-admin-page-title]').forEach(element => { element.textContent = tr(pageTitleKey()); });
    document.querySelectorAll('[data-admin-email]').forEach(element => { element.textContent = session?.email || ''; });
    document.querySelectorAll('[data-admin-lang-label]').forEach(element => { element.textContent = typeof getLang === 'function' ? getLang().toUpperCase() : 'EN'; });
    const dark = typeof getTheme === 'function' && getTheme() === 'dark';
    document.querySelectorAll('[data-admin-theme-icon]').forEach(icon => {
      icon.className = `fa-solid ${dark ? 'fa-sun' : 'fa-moon'}`;
    });
  }

  function drawerFocusable() {
    const sidebar = document.getElementById('adminSidebar');
    if (!sidebar) return [];
    return [...sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hidden && element.getClientRects().length > 0);
  }

  function setDrawer(open, { restoreFocus = true } = {}) {
    const sidebar = document.getElementById('adminSidebar');
    const workspace = document.getElementById('adminWorkspace');
    const trigger = document.querySelector('[data-admin-drawer-open]');
    if (!sidebar || !workspace || !trigger) return;
    const mobile = matchMedia('(max-width: 991.98px)').matches;
    drawerOpen = Boolean(open && mobile);
    body.classList.toggle('admin-drawer-open', drawerOpen);
    trigger.setAttribute('aria-expanded', String(drawerOpen));
    workspace.inert = drawerOpen;
    if (drawerOpen) {
      sidebar.inert = false;
      sidebar.removeAttribute('aria-hidden');
      drawerTrigger = trigger;
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      requestAnimationFrame(() => drawerFocusable()[0]?.focus());
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      if ((restoreFocus && drawerTrigger) || (mobile && sidebar.contains(document.activeElement))) {
        trigger.focus({ preventScroll: true });
      }
      sidebar.inert = mobile;
      if (mobile) sidebar.setAttribute('aria-hidden', 'true');
      else sidebar.removeAttribute('aria-hidden');
      drawerTrigger = null;
    }
  }

  function bindControls(root = document) {
    root.querySelectorAll('[data-admin-theme]').forEach(button => {
      if (button.dataset.adminBound) return;
      button.dataset.adminBound = 'true';
      button.addEventListener('click', () => {
        const next = typeof getTheme === 'function' && getTheme() === 'dark' ? 'light' : 'dark';
        if (typeof setTheme === 'function') setTheme(next);
        updateDynamicControls();
        toast(tr(next === 'dark' ? 'admin_theme_dark' : 'admin_theme_light'), 'info');
      });
    });
    root.querySelectorAll('[data-admin-lang]').forEach(button => {
      if (button.dataset.adminBound) return;
      button.dataset.adminBound = 'true';
      button.addEventListener('click', () => {
        if (typeof toggleLang === 'function') toggleLang();
        updateDynamicControls();
        toast(tr('admin_language_changed'), 'info');
      });
    });
    root.querySelectorAll('[data-admin-logout]').forEach(button => {
      if (button.dataset.adminBound) return;
      button.dataset.adminBound = 'true';
      button.addEventListener('click', () => {
        window.AdminAuth?.logout?.();
        toast(tr('admin_logged_out'), 'info');
        setTimeout(() => location.replace('login.html'), 650);
      });
    });
    root.querySelectorAll('[data-admin-drawer-open]').forEach(button => button.addEventListener('click', () => setDrawer(true)));
    root.querySelectorAll('[data-admin-drawer-close]').forEach(button => button.addEventListener('click', () => setDrawer(false)));
  }

  function buildShell() {
    const main = document.querySelector('main');
    if (!main || document.querySelector('.admin-shell')) return;
    main.id = main.id || 'adminMain';
    main.classList.add('admin-main');
    document.body.insertAdjacentHTML('afterbegin', sidebarMarkup());
    document.querySelector('[data-admin-content]')?.appendChild(main);
    if (typeof applyI18n === 'function') applyI18n(document.body);
    updateDynamicControls();
    bindControls(document);
    setDrawer(false, { restoreFocus: false });
  }

  const api = Object.freeze({
    session,
    storageKeys: STORAGE_KEYS,
    keys: STORAGE_KEYS,
    routes: ROUTES,
    read,
    readResult,
    write,
    toast,
    confirm: confirmAction,
    state,
    setBusy,
    syncControls: updateDynamicControls,
    escape: escapeValue,
    formatDate,
    flattenCategories
  });
  window.AdminCore = api;

  document.addEventListener('keydown', event => {
    if (!drawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDrawer(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = drawerFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('resize', () => {
    const mobile = matchMedia('(max-width: 991.98px)').matches;
    if (!mobile || !drawerOpen) setDrawer(false, { restoreFocus: false });
  });

  window.addEventListener('am:langchange', () => {
    updateDynamicControls();
  });

  document.addEventListener('DOMContentLoaded', () => {
    ensureFeedback();
    if (!publicPage) buildShell();
    else bindControls(document);
    updateDynamicControls();
    body?.classList.add('admin-ready');
    window.dispatchEvent(new CustomEvent('admin:ready', { detail: { session, page, core: api } }));
  });
})();
