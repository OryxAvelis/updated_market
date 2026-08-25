/**
 * AM MARKET secure storefront authentication UI.
 * Authentication is cookie-based through StoreAPI. Only the two anonymous
 * shopping keys are considered for a post-authentication merge.
 */
(function initLoginPage() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PRODUCT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
  const CART_MERGE_ATTEMPT_KEY = 'am_cart_merge_attempt_v1';
  const AUTH_SESSION_LOCK = 'am-market-auth-session-v1';
  const AUTH_STATE_CHANNEL = 'am-market-auth-state-v1';
  const AUTH_COPY = {
    en: {
      secureAccount: 'Secure account sessions',
      loginSubtitle: 'Good to see you again.',
      signupSubtitle: 'Join AM Market in less than a minute.',
      checkoutPrompt: 'An account is optional. Sign in to save this order to your history, or continue checkout as a guest.',
      checkoutBrandTitle: 'Checkout your way',
      checkoutBrandText: 'Continue as a guest, or sign in for saved order history and an easier return visit.',
      continueGuest: 'Continue as Guest',
      backToCart: 'Back to cart',
      passwordPlaceholder: 'Password',
      passwordRule: 'Use 12–128 characters.',
      forgotTitle: 'Reset your password',
      forgotSubtitle: 'Enter your account email. If an account exists, we will send a secure reset link.',
      forgotBrandTitle: 'Account recovery',
      forgotBrandText: 'We use a short-lived, one-time link so your password stays private.',
      sendReset: 'Send reset link',
      passwordTooShort: 'Use at least 12 characters.',
      emailInvalid: 'Enter a valid email address.',
      nameInvalid: 'Enter at least 2 characters.',
      genericError: 'We could not complete that request. Please try again.',
      networkError: 'The server could not be reached. Check your connection and try again.',
      invalidCredentials: 'The email or password is incorrect.',
      emailExists: 'An account already exists for this email address.',
      rateLimited: 'Too many attempts. Please wait before trying again.',
      authLockUnavailable: 'This browser cannot safely coordinate account changes across tabs. Update your browser and try again.',
      loginSuccess: 'Signed in securely. Taking you to the store…',
      demoLoginSuccess: 'Demo account opened. Taking you to the store…',
      demoNoticeTitle: 'Local demo',
      demoNotice: 'Any non-empty email and password work in this local demo. No real customer account is authenticated. Do not use real credentials.',
      demoEmailLabel: 'Demo email (any text)',
      demoEmailPlaceholder: 'Any non-empty value',
      demoPasswordLabel: 'Demo password',
      demoPasswordPlaceholder: 'Any non-empty value',
      demoSubmit: 'Open demo',
      demoValueRequired: 'Enter any value.',
      demoEmailTooLong: 'Use no more than 254 characters.',
      demoPasswordTooLong: 'Use no more than 128 characters.',
      demoUnavailable: 'The local demo account is unavailable. Restart the local demo setup and try again.',
      registerSuccess: 'Your account is ready. Taking you to the store…',
      mergeWarning: 'You are signed in. Some guest items could not be synchronized and remain saved in this browser.',
      mergeTitle: 'Keep your shopping together?',
      mergeSummary: '{cart} cart product(s) and {wishlist} saved item(s) are stored in this browser.',
      mergePendingSummary: '{cart} cart product(s), {wishlist} saved item(s), and an unfinished cart merge are stored in this browser.',
      mergeNote: "Choose whether to add this browser's guest items to your account. Nothing is removed unless the merge is confirmed.",
      mergeAction: 'Merge shopping',
      retryMerge: 'Retry merge',
      keepSeparate: 'Keep separate',
      continueAfterAuth: 'Continue',
      continueGuestCheckout: 'Sign out & continue guest checkout',
      mergeWorking: 'Merging your guest shopping securely…',
      mergeSuccess: 'Your guest cart and saved items are now in your account. No duplicate products were created.',
      keptSeparate: 'Your guest cart and saved items remain in this browser and were not added to this account.',
      keptSeparateCheckout: 'Your guest cart remains separate and intact. Sign out below to continue this guest checkout; your account cart will not replace it.',
      signingOutGuest: 'Signing out so you can continue this guest checkout…',
      signOutGuestFailed: 'We could not sign out safely. Your guest cart is still intact; try again.',
      guestDataUnreadable: 'Some guest shopping data could not be read. It remains stored in this browser and was not removed.',
      resetSent: 'If an account exists for that email, a secure reset link will be sent shortly.',
      accountDeactivated: 'Your account has been deactivated. You are now signed out.',
      accountDeleted: 'Your account has been permanently deleted. You are now signed out.',
      pending: 'Please wait…'
    },
    fr: {
      secureAccount: 'Sessions de compte sécurisées',
      loginSubtitle: 'Ravi de vous revoir.',
      signupSubtitle: 'Rejoignez AM Market en moins d’une minute.',
      checkoutPrompt: 'Le compte est facultatif. Connectez-vous pour enregistrer cette commande dans votre historique, ou continuez en invité.',
      checkoutBrandTitle: 'Commandez à votre façon',
      checkoutBrandText: 'Continuez en invité, ou connectez-vous pour enregistrer vos commandes et faciliter votre prochaine visite.',
      continueGuest: 'Continuer en invité',
      backToCart: 'Retour au panier',
      passwordPlaceholder: 'Mot de passe',
      passwordRule: 'Utilisez entre 12 et 128 caractères.',
      forgotTitle: 'Réinitialiser votre mot de passe',
      forgotSubtitle: 'Saisissez l’adresse email du compte. Si le compte existe, nous enverrons un lien sécurisé.',
      forgotBrandTitle: 'Récupération du compte',
      forgotBrandText: 'Nous utilisons un lien temporaire à usage unique afin de protéger votre mot de passe.',
      sendReset: 'Envoyer le lien',
      passwordTooShort: 'Utilisez au moins 12 caractères.',
      emailInvalid: 'Saisissez une adresse email valide.',
      nameInvalid: 'Saisissez au moins 2 caractères.',
      genericError: 'Impossible de terminer cette demande. Veuillez réessayer.',
      networkError: 'Le serveur est inaccessible. Vérifiez votre connexion puis réessayez.',
      invalidCredentials: 'L’adresse email ou le mot de passe est incorrect.',
      emailExists: 'Un compte existe déjà pour cette adresse email.',
      rateLimited: 'Trop de tentatives. Patientez avant de réessayer.',
      authLockUnavailable: 'Ce navigateur ne peut pas coordonner les changements de compte entre les onglets en toute sécurité. Mettez-le à jour puis réessayez.',
      loginSuccess: 'Connexion sécurisée réussie. Redirection vers la boutique…',
      demoLoginSuccess: 'Compte de démonstration ouvert. Redirection vers la boutique…',
      demoNoticeTitle: 'Démo locale',
      demoNotice: 'Toute adresse email et tout mot de passe non vides fonctionnent dans cette démo locale. Aucun vrai compte client n’est authentifié. N’utilisez pas de vrais identifiants.',
      demoEmailLabel: 'Email de démo (tout texte)',
      demoEmailPlaceholder: 'Toute valeur non vide',
      demoPasswordLabel: 'Mot de passe de démonstration',
      demoPasswordPlaceholder: 'Toute valeur non vide',
      demoSubmit: 'Ouvrir la démo',
      demoValueRequired: 'Saisissez une valeur.',
      demoEmailTooLong: 'Utilisez au maximum 254 caractères.',
      demoPasswordTooLong: 'Utilisez au maximum 128 caractères.',
      demoUnavailable: 'Le compte de démonstration locale est indisponible. Relancez la configuration de la démo locale puis réessayez.',
      registerSuccess: 'Votre compte est prêt. Redirection vers la boutique…',
      mergeWarning: 'Vous êtes connecté. Certains articles invités n’ont pas pu être synchronisés et restent enregistrés dans ce navigateur.',
      mergeTitle: 'Regrouper vos achats ?',
      mergeSummary: '{cart} produit(s) dans le panier et {wishlist} favori(s) sont enregistrés dans ce navigateur.',
      mergePendingSummary: '{cart} produit(s) dans le panier, {wishlist} favori(s) et une fusion inachevée sont enregistrés dans ce navigateur.',
      mergeNote: 'Choisissez si vous souhaitez ajouter les articles invités de ce navigateur à votre compte. Rien ne sera supprimé sans confirmation de la fusion.',
      mergeAction: 'Fusionner mes achats',
      retryMerge: 'Réessayer la fusion',
      keepSeparate: 'Garder séparément',
      continueAfterAuth: 'Continuer',
      continueGuestCheckout: 'Se déconnecter et continuer en invité',
      mergeWorking: 'Fusion sécurisée de vos achats invités…',
      mergeSuccess: 'Votre panier invité et vos favoris sont maintenant dans votre compte. Aucun produit en double n’a été créé.',
      keptSeparate: 'Votre panier invité et vos favoris restent dans ce navigateur et n’ont pas été ajoutés à ce compte.',
      keptSeparateCheckout: 'Votre panier invité reste séparé et intact. Déconnectez-vous ci-dessous pour poursuivre cette commande invitée ; le panier du compte ne le remplacera pas.',
      signingOutGuest: 'Déconnexion pour poursuivre cette commande invitée…',
      signOutGuestFailed: 'La déconnexion sécurisée a échoué. Votre panier invité est toujours intact ; réessayez.',
      guestDataUnreadable: 'Certaines données d’achat invité sont illisibles. Elles restent enregistrées dans ce navigateur et n’ont pas été supprimées.',
      resetSent: 'Si un compte correspond à cette adresse, un lien sécurisé sera envoyé sous peu.',
      accountDeactivated: 'Votre compte a été désactivé. Vous êtes maintenant déconnecté.',
      accountDeleted: 'Votre compte a été supprimé définitivement. Vous êtes maintenant déconnecté.',
      pending: 'Veuillez patienter…'
    }
  };

  const fieldMap = {
    email: { input: 'loginEmail', wrap: 'loginEmailWrap', error: 'loginEmailError', key: 'emailInvalid' },
    password: { input: 'loginPass', wrap: 'loginPassWrap', error: 'loginPassError', key: 'passwordTooShort' },
    displayName: { input: 'suName', wrap: 'suNameWrap', error: 'suNameError', key: 'nameInvalid' },
    signupEmail: { input: 'suEmail', wrap: 'suEmailWrap', error: 'suEmailError', key: 'emailInvalid' },
    signupPassword: { input: 'suPass', wrap: 'suPassWrap', error: 'suPassError', key: 'passwordTooShort' },
    forgotEmail: { input: 'forgotEmail', wrap: 'forgotEmailWrap', error: 'forgotEmailError', key: 'emailInvalid' }
  };

  let currentMode = 'login';
  let authBusy = false;
  let activeGuestMergeState = null;
  let postAuthContinuation = 'authenticated';
  let activeAuthenticatedUserId = '';
  let localDemoLoginEnabled = false;

  function safeNextPage() {
    const candidate = new URLSearchParams(location.search).get('next') || '';
    return /^(?:index|all-categories|categories|product|cart|checkout|wishlist|orders|settings|help)\.html(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%?-]*)?$/.test(candidate)
      ? candidate
      : 'index.html';
  }

  function isCheckoutIntent() {
    return safeNextPage().split('?')[0] === 'checkout.html';
  }

  function accountNoticeKey() {
    const notice = new URLSearchParams(location.search).get('account');
    return ({ deactivated: 'accountDeactivated', deleted: 'accountDeleted' })[notice] || '';
  }

  function currentCopy() {
    return AUTH_COPY[typeof getLang === 'function' && getLang() === 'fr' ? 'fr' : 'en'];
  }

  function copy(key) {
    return currentCopy()[key] || AUTH_COPY.en[key] || key;
  }

  function formattedCopy(key, values = {}) {
    return Object.entries(values).reduce(
      (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
      copy(key)
    );
  }

  function applyLocalCopy(root = document) {
    root.querySelectorAll('[data-auth-copy]').forEach((element) => {
      element.textContent = copy(element.dataset.authCopy);
    });
    root.querySelectorAll('[data-auth-copy-placeholder]').forEach((element) => {
      element.placeholder = copy(element.dataset.authCopyPlaceholder);
    });
  }

  function applyLocalDemoPresentation() {
    if (!localDemoLoginEnabled) return;
    const notice = $('demoLoginNotice');
    const form = $('loginForm');
    const recoveryActions = $('loginRecoveryActions');
    const signupPrompt = $('loginSignupPrompt');
    if (notice) {
      notice.hidden = false;
      applyLocalCopy(notice);
    }
    if (recoveryActions) recoveryActions.hidden = true;
    if (signupPrompt) signupPrompt.hidden = true;
    if (!form) return;

    form.setAttribute('aria-describedby', 'demoLoginNotice');

    const email = $('loginEmail');
    const password = $('loginPass');
    const emailLabel = $('loginEmailLabel');
    const passwordLabel = $('loginPasswordLabel');
    const submitLabel = $('loginSubmitLabel');
    if (!email || !password) return;

    email.type = 'text';
    email.autocomplete = 'off';
    email.removeAttribute('data-i18n-ph');
    email.placeholder = copy('demoEmailPlaceholder');
    password.autocomplete = 'off';
    password.removeAttribute('minlength');
    password.placeholder = copy('demoPasswordPlaceholder');
    if (emailLabel) emailLabel.textContent = copy('demoEmailLabel');
    if (passwordLabel) passwordLabel.textContent = copy('demoPasswordLabel');
    if (submitLabel && !form.hasAttribute('aria-busy')) submitLabel.textContent = copy('demoSubmit');
  }

  function applyLocalDemoCapability(session) {
    if (session?.capabilities?.localDemoLogin !== true) return;
    localDemoLoginEnabled = true;
    applyLocalDemoPresentation();
  }

  function setBrand(mode) {
    const brand = mode === 'signup'
      ? { title: t('brand_signup_title'), text: t('brand_signup_text') }
      : mode === 'forgot'
        ? { title: copy('forgotBrandTitle'), text: copy('forgotBrandText') }
        : isCheckoutIntent()
          ? { title: copy('checkoutBrandTitle'), text: copy('checkoutBrandText') }
          : { title: t('brand_login_title'), text: t('brand_login_text') };
    const title = $('brandTitle');
    const text = $('brandText');
    title.textContent = brand.title;
    text.textContent = brand.text;
    [title, text].forEach((element) => {
      element.classList.remove('swap');
      void element.offsetWidth;
      element.classList.add('swap');
    });
  }

  function hideAlert() {
    const alert = $('authAlert');
    alert.hidden = true;
    alert.textContent = '';
    alert.className = 'auth-alert';
    alert.setAttribute('role', 'alert');
    alert.setAttribute('aria-live', 'assertive');
    delete alert.dataset.authAlertKey;
  }

  function showAlert(message, type = 'error', focus = false, messageKey = '') {
    const alert = $('authAlert');
    alert.textContent = message;
    alert.className = `auth-alert auth-alert--${type}`;
    alert.hidden = false;
    const polite = type === 'success' || type === 'warning';
    alert.setAttribute('role', polite ? 'status' : 'alert');
    alert.setAttribute('aria-live', polite ? 'polite' : 'assertive');
    if (messageKey) alert.dataset.authAlertKey = messageKey;
    else delete alert.dataset.authAlertKey;
    if (focus) requestAnimationFrame(() => alert.focus({ preventScroll: true }));
  }

  function showCopyAlert(key, type = 'error', focus = false) {
    showAlert(copy(key), type, focus, key);
  }

  function showMode(mode, backwards = false) {
    if (authBusy || (localDemoLoginEnabled && mode !== 'login') || !['login', 'signup', 'forgot'].includes(mode)) return;
    currentMode = mode;
    hideAlert();
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      const selected = panel.dataset.authPanel === mode;
      panel.hidden = !selected;
      panel.setAttribute('aria-hidden', String(!selected));
      panel.classList.remove('anim', 'anim-back');
      if (selected) {
        void panel.offsetWidth;
        panel.classList.add(backwards ? 'anim-back' : 'anim');
      }
    });
    setBrand(mode);
    const panel = document.querySelector(`[data-auth-panel="${mode}"]`);
    requestAnimationFrame(() => panel?.querySelector('input, h2')?.focus({ preventScroll: true }));
  }

  function setFieldError(config, key = config.key, message = '') {
    const input = $(config.input);
    const wrap = $(config.wrap);
    const error = $(config.error);
    wrap.classList.add('error');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', config.error);
    error.dataset.authErrorKey = key;
    error.textContent = message || copy(key);
  }

  function clearFieldError(config) {
    const input = $(config.input);
    $(config.wrap).classList.remove('error');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const error = $(config.error);
    error.textContent = '';
    delete error.dataset.authErrorKey;
  }

  function clearFormErrors(form) {
    Object.values(fieldMap).forEach((config) => {
      if (form.contains($(config.input))) clearFieldError(config);
    });
  }

  function isValidEmail(value) {
    return value.length <= 254 && EMAIL_PATTERN.test(value);
  }

  function setPending(form, pending) {
    authBusy = pending;
    document.querySelectorAll('[data-auth-panel] form').forEach((candidate) => {
      candidate.toggleAttribute('aria-busy', pending && candidate === form);
      Array.from(candidate.elements).forEach((control) => { control.disabled = pending; });
    });
    ['toSignup', 'toLogin', 'toForgot', 'forgotToLogin'].forEach((id) => {
      const control = $(id);
      if (control) control.disabled = pending;
    });
    const submit = form.querySelector('[type="submit"]');
    const spinner = submit?.querySelector('.auth-spinner');
    if (spinner) spinner.hidden = !pending;
    const label = submit?.querySelector('[data-submit-label]');
    if (label) {
      if (pending) label.textContent = copy('pending');
      else {
        if (typeof applyI18n === 'function') applyI18n(submit);
        applyLocalCopy(submit);
        applyLocalDemoPresentation();
      }
    }
  }

  function errorKey(error) {
    const keyByCode = {
      INVALID_CREDENTIALS: 'invalidCredentials',
      EMAIL_ALREADY_REGISTERED: 'emailExists',
      RATE_LIMITED: 'rateLimited',
      LOCAL_DEV_LOGIN_UNAVAILABLE: 'demoUnavailable',
      AUTH_LOCK_UNAVAILABLE: 'authLockUnavailable',
      NETWORK_ERROR: 'networkError',
      REQUEST_TIMEOUT: 'networkError'
    };
    return keyByCode[error?.code] || 'genericError';
  }

  function applyServerFieldErrors(error, serverFields) {
    const issues = [];
    if (Array.isArray(error?.fields)) issues.push(...error.fields);
    else if (error?.fields && typeof error.fields === 'object') {
      Object.entries(error.fields).forEach(([path, message]) => issues.push({ path, message }));
    }
    if (Array.isArray(error?.details)) issues.push(...error.details);
    let firstInput = null;
    issues.forEach((issue) => {
      const path = String(issue.path || '').split('.').pop();
      const config = serverFields[path];
      if (!config) return;
      setFieldError(config);
      firstInput ||= $(config.input);
    });
    firstInput?.focus({ preventScroll: true });
  }

  function guestCart() {
    let raw;
    try { raw = localStorage.getItem('am_cart'); } catch { return { present: false, valid: false, items: [] }; }
    if (raw == null) return { present: false, valid: true, items: [] };
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) return { present: true, valid: false, items: [] };
      const quantities = new Map();
      let invalidItem = false;
      value.forEach((item) => {
        const productId = String(item?.id ?? '').trim();
        const quantity = Number(item?.qty);
        if (!PRODUCT_ID_PATTERN.test(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
          invalidItem = true;
          return;
        }
        const total = (quantities.get(productId) || 0) + quantity;
        if (total > 99) invalidItem = true;
        else quantities.set(productId, total);
      });
      if (invalidItem || quantities.size > 100) return { present: true, valid: false, items: [] };
      return {
        present: true,
        valid: true,
        items: Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }))
      };
    } catch {
      return { present: true, valid: false, items: [] };
    }
  }

  function guestWishlist() {
    let raw;
    try { raw = localStorage.getItem('am_wish'); } catch { return { present: false, valid: false, items: [] }; }
    if (raw == null) return { present: false, valid: true, items: [] };
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) return { present: true, valid: false, items: [] };
      const normalized = value.map((id) => String(id ?? '').trim());
      if (normalized.some(id => !PRODUCT_ID_PATTERN.test(id))) return { present: true, valid: false, items: [] };
      const items = [...new Set(normalized)];
      if (items.length > 100) return { present: true, valid: false, items: [] };
      return { present: true, valid: true, items };
    } catch {
      return { present: true, valid: false, items: [] };
    }
  }

  function guestShoppingState() {
    const cartState = guestCart();
    const wishlistState = guestWishlist();
    const unresolvedCart = hasCartMergeAttempt();
    const cartProducts = cartState.valid ? cartState.items.length : 0;
    const wishlistItems = wishlistState.valid ? wishlistState.items.length : 0;
    return {
      cart: cartState,
      wishlist: wishlistState,
      unresolvedCart,
      cartProducts,
      wishlistItems,
      hasMergeable: cartProducts > 0 || wishlistItems > 0 || unresolvedCart,
      hasInvalid: (cartState.present && !cartState.valid) || (wishlistState.present && !wishlistState.valid)
    };
  }

  function confirmedWishlistIds(payload, requested) {
    if (!Array.isArray(payload?.items)) return null;
    const confirmed = new Set(payload.items.map((item) => {
      if (item && typeof item === 'object') return String(item.productId ?? '').trim();
      return String(item ?? '').trim();
    }).filter(id => PRODUCT_ID_PATTERN.test(id)));
    return requested.filter(id => confirmed.has(String(id)));
  }

  function canonicalCartItems(items) {
    return items.map(item => ({ productId: String(item.productId), quantity: Number(item.quantity) }))
      .sort((left, right) => left.productId.localeCompare(right.productId));
  }

  function cartMergeAttempt(items) {
    let raw;
    try { raw = localStorage.getItem(CART_MERGE_ATTEMPT_KEY); } catch { return false; }
    if (raw != null) {
      try {
        const stored = JSON.parse(raw);
        const storedItems = Array.isArray(stored?.items) ? canonicalCartItems(stored.items) : [];
        const signature = JSON.stringify(storedItems);
        const keyValid = typeof stored?.idempotencyKey === 'string' &&
          /^am1\.[0-9a-z]+\.[0-9a-f-]{36}$/i.test(stored.idempotencyKey);
        const itemsValid = storedItems.length > 0 && storedItems.every(item =>
          PRODUCT_ID_PATTERN.test(item.productId) && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99);
        if (keyValid && itemsValid && stored.signature === signature) return { ...stored, items: storedItems };
      } catch {
        // A malformed unresolved attempt must fail closed instead of risking a duplicate merge.
      }
      return false;
    }

    const canonicalItems = canonicalCartItems(items);
    if (!canonicalItems.length) return null;
    const attempt = {
      signature: JSON.stringify(canonicalItems),
      items: canonicalItems,
      idempotencyKey: StoreAPI.createIdempotencyKey()
    };
    try { localStorage.setItem(CART_MERGE_ATTEMPT_KEY, JSON.stringify(attempt)); } catch { return false; }
    return attempt;
  }

  function clearCartMergeAttempt(idempotencyKey) {
    try {
      const stored = JSON.parse(localStorage.getItem(CART_MERGE_ATTEMPT_KEY) || 'null');
      if (!stored || stored.idempotencyKey === idempotencyKey) localStorage.removeItem(CART_MERGE_ATTEMPT_KEY);
    } catch {
      try { localStorage.removeItem(CART_MERGE_ATTEMPT_KEY); } catch { /* Best effort. */ }
    }
  }

  function hasCartMergeAttempt() {
    try { return localStorage.getItem(CART_MERGE_ATTEMPT_KEY) != null; } catch { return true; }
  }

  function subtractMergedGuestItems(items) {
    const current = guestCart();
    if (!current.present) return true;
    if (!current.valid) return false;
    const quantities = new Map(current.items.map(item => [item.productId, item.quantity]));
    items.forEach((item) => {
      const remaining = (quantities.get(item.productId) || 0) - item.quantity;
      if (remaining > 0) quantities.set(item.productId, remaining);
      else quantities.delete(item.productId);
    });
    const remaining = Array.from(quantities, ([id, qty]) => ({ id, qty }));
    try {
      if (remaining.length) localStorage.setItem('am_cart', JSON.stringify(remaining));
      else localStorage.removeItem('am_cart');
      return true;
    } catch {
      return false;
    }
  }

  function subtractMergedGuestWishlist(items) {
    const current = guestWishlist();
    if (!current.present) return true;
    if (!current.valid) return false;
    const merged = new Set(items.map(String));
    const remaining = current.items.filter(id => !merged.has(id));
    try {
      if (remaining.length) localStorage.setItem('am_wish', JSON.stringify(remaining));
      else localStorage.removeItem('am_wish');
      return true;
    } catch {
      return false;
    }
  }

  async function mergeGuestCart() {
    // A second round captures legitimate guest-cart changes made in another
    // tab while the first caller-owned attempt was unresolved.
    for (let round = 0; round < 2; round += 1) {
      const snapshot = guestCart();
      if (!snapshot.valid) return false;
      const attempt = cartMergeAttempt(snapshot.items);
      if (attempt === false) return false;
      if (attempt == null) {
        try { localStorage.removeItem('am_cart'); } catch { return false; }
        return true;
      }
      try {
        await StoreAPI.cart.mergeGuest({ items: attempt.items }, { idempotencyKey: attempt.idempotencyKey });
      } catch {
        return false;
      }
      if (!subtractMergedGuestItems(attempt.items)) return false;
      clearCartMergeAttempt(attempt.idempotencyKey);
    }
    const remaining = guestCart();
    let unresolvedAttempt = true;
    try { unresolvedAttempt = localStorage.getItem(CART_MERGE_ATTEMPT_KEY) != null; } catch { /* Fail closed. */ }
    return remaining.valid && (!remaining.present || remaining.items.length === 0) && !unresolvedAttempt;
  }

  async function mergeGuestCartSafely() {
    const snapshot = guestCart();
    if (!snapshot.present && !hasCartMergeAttempt()) return true;
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') return false;
    return locks.request('am-market-cart-merge-v1', { mode: 'exclusive' }, mergeGuestCart);
  }

  async function withAuthSessionLock(work) {
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') {
      const error = new Error('A cross-tab account lock is unavailable.');
      error.code = 'AUTH_LOCK_UNAVAILABLE';
      throw error;
    }
    return locks.request(AUTH_SESSION_LOCK, { mode: 'exclusive' }, work);
  }

  function broadcastAccountChanged(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId || typeof globalThis.BroadcastChannel !== 'function') return false;
    let channel;
    try {
      channel = new globalThis.BroadcastChannel(AUTH_STATE_CHANNEL);
      channel.postMessage({ version: 1, type: 'account-changed', userId: normalizedUserId });
      globalThis.setTimeout(() => {
        try { channel.close(); } catch { /* Best effort. */ }
      }, 0);
      return true;
    } catch (error) {
      try { channel?.close(); } catch { /* Best effort. */ }
      console.warn('[AM MARKET auth] Could not notify other tabs about the account change', error);
      return false;
    }
  }

  function broadcastGuestCommerceChanged() {
    if (typeof globalThis.BroadcastChannel !== 'function') return false;
    let channel;
    try {
      channel = new globalThis.BroadcastChannel(AUTH_STATE_CHANNEL);
      channel.postMessage({ version: 1, type: 'guest-commerce-changed' });
      globalThis.setTimeout(() => {
        try { channel.close(); } catch { /* Best effort. */ }
      }, 0);
      return true;
    } catch (error) {
      try { channel?.close(); } catch { /* Best effort. */ }
      console.warn('[AM MARKET auth] Could not notify other tabs about guest shopping changes', error);
      return false;
    }
  }

  async function mergeGuestShopping() {
    const wish = guestWishlist();
    const jobs = [];
    let failures = Number(wish.present && !wish.valid);

    jobs.push(mergeGuestCartSafely().then(ok => { if (!ok) failures += 1; }));
    if (wish.present && wish.valid && wish.items.length) {
      jobs.push(StoreAPI.wishlist.mergeGuest({ items: wish.items })
        .then((payload) => {
          const confirmed = confirmedWishlistIds(payload, wish.items);
          if (!confirmed) {
            failures += 1;
            return;
          }
          if (confirmed.length && !subtractMergedGuestWishlist(confirmed)) failures += 1;
          if (confirmed.length !== wish.items.length) failures += 1;
        })
        .catch(() => { failures += 1; }));
    }

    await Promise.all(jobs);
    return failures;
  }

  function guestMergeSummary(state = activeGuestMergeState || guestShoppingState()) {
    return formattedCopy(state.unresolvedCart ? 'mergePendingSummary' : 'mergeSummary', {
      cart: state.cartProducts,
      wishlist: state.wishlistItems
    });
  }

  function broadcastSignedOut(userId = activeAuthenticatedUserId) {
    if (typeof globalThis.BroadcastChannel !== 'function') return false;
    const normalizedUserId = String(userId || '').trim();
    let channel;
    try {
      channel = new globalThis.BroadcastChannel(AUTH_STATE_CHANNEL);
      channel.postMessage({
        version: 1,
        type: normalizedUserId ? 'signed-out' : 'session-invalidated',
        reason: 'logout',
        ...(normalizedUserId ? { userId: normalizedUserId } : {})
      });
      globalThis.setTimeout(() => {
        try { channel.close(); } catch { /* Best effort. */ }
      }, 0);
      return true;
    } catch (error) {
      try { channel?.close(); } catch { /* Best effort. */ }
      console.warn('[AM MARKET auth] Could not notify other tabs about sign-out', error);
      return false;
    }
  }

  function renderGuestMergeSummary(state = activeGuestMergeState || guestShoppingState()) {
    activeGuestMergeState = state;
    const summary = $('guestMergeSummary');
    if (summary) summary.textContent = guestMergeSummary(state);
  }

  function setGuestMergePending(pending) {
    const mergeButton = $('mergeGuestBtn');
    const keepButton = $('keepGuestBtn');
    if (mergeButton) {
      mergeButton.disabled = pending;
      mergeButton.toggleAttribute('aria-busy', pending);
      const spinner = mergeButton.querySelector('.auth-spinner');
      if (spinner) spinner.hidden = !pending;
    }
    if (keepButton) keepButton.disabled = pending;
  }

  function showGuestMergeChoice(kind, state) {
    activeGuestMergeState = state;
    postAuthContinuation = 'authenticated';
    if ($('checkoutAuthContext')) $('checkoutAuthContext').hidden = true;
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    });
    const panel = $('guestMergePanel');
    panel.hidden = false;
    panel.dataset.authKind = kind;
    const mergeButton = $('mergeGuestBtn');
    const mergeLabel = mergeButton?.querySelector('[data-auth-copy]');
    if (mergeLabel) mergeLabel.dataset.authCopy = 'mergeAction';
    if (mergeButton) mergeButton.hidden = !state.hasMergeable;
    if ($('keepGuestBtn')) $('keepGuestBtn').hidden = false;
    if ($('continueAfterAuthBtn')) $('continueAfterAuthBtn').hidden = true;
    setGuestMergePending(false);
    renderGuestMergeSummary(state);
    if (state.hasInvalid) showCopyAlert('guestDataUnreadable', 'warning');
    else hideAlert();
    applyLocalCopy(panel);
    requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  }

  function finishGuestMergeChoice(messageKey, type, { continuation = 'authenticated' } = {}) {
    postAuthContinuation = continuation;
    showCopyAlert(messageKey, type, true);
    const mergeButton = $('mergeGuestBtn');
    const keepButton = $('keepGuestBtn');
    if (mergeButton) mergeButton.hidden = true;
    if (keepButton) keepButton.hidden = true;
    const continueButton = $('continueAfterAuthBtn');
    if (continueButton) {
      continueButton.dataset.authCopy = continuation === 'guest' ? 'continueGuestCheckout' : 'continueAfterAuth';
      applyLocalCopy(continueButton);
      continueButton.hidden = false;
      requestAnimationFrame(() => continueButton.focus({ preventScroll: true }));
    }
  }

  async function acceptGuestMerge() {
    if ($('mergeGuestBtn')?.disabled) return false;
    setGuestMergePending(true);
    showCopyAlert('mergeWorking', 'success');
    let failures = 0;
    try {
      failures = await mergeGuestShopping();
    } catch (error) {
      console.error('[AM MARKET auth] Guest shopping recovery failed unexpectedly', error);
      failures = 1;
    } finally {
      broadcastGuestCommerceChanged();
    }

    const remaining = guestShoppingState();
    renderGuestMergeSummary(remaining);
    setGuestMergePending(false);
    if (!failures && !remaining.hasMergeable && !remaining.hasInvalid) {
      finishGuestMergeChoice('mergeSuccess', 'success');
      return true;
    }

    const mergeButton = $('mergeGuestBtn');
    const mergeLabel = mergeButton?.querySelector('[data-auth-copy]');
    if (mergeLabel) {
      mergeLabel.dataset.authCopy = 'retryMerge';
      applyLocalCopy(mergeButton);
    }
    if (mergeButton) mergeButton.hidden = !remaining.hasMergeable;
    showCopyAlert(remaining.hasInvalid && !remaining.hasMergeable ? 'guestDataUnreadable' : 'mergeWarning', 'warning', true);
    return false;
  }

  function keepGuestShoppingSeparate() {
    const checkoutIntent = isCheckoutIntent();
    finishGuestMergeChoice(checkoutIntent ? 'keptSeparateCheckout' : 'keptSeparate', 'success', {
      continuation: checkoutIntent ? 'guest' : 'authenticated'
    });
    return true;
  }

  async function continueAfterAuthentication() {
    if (postAuthContinuation !== 'guest') {
      location.replace(safeNextPage());
      return true;
    }

    const button = $('continueAfterAuthBtn');
    if (button?.disabled) return false;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    showCopyAlert('signingOutGuest', 'success', true);
    try {
      await withAuthSessionLock(async () => {
        await StoreAPI.auth.logout();
        broadcastSignedOut();
      });
      location.replace('checkout.html');
      return true;
    } catch (error) {
      console.error('[AM MARKET auth] Could not leave the account session for guest checkout', error);
      showCopyAlert('signOutGuestFailed', 'warning', true);
      return false;
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  async function completeAuthentication(kind, userId = '', successKey = '') {
    activeAuthenticatedUserId = String(userId || activeAuthenticatedUserId || '').trim();
    const state = guestShoppingState();
    if (state.hasMergeable || state.hasInvalid) {
      showGuestMergeChoice(kind, state);
      return 'choice';
    }
    if ($('checkoutAuthContext')) $('checkoutAuthContext').hidden = true;
    showCopyAlert(successKey || (kind === 'register' ? 'registerSuccess' : 'loginSuccess'), 'success', true);
    globalThis.setTimeout(() => location.replace(safeNextPage()), 900);
    return 'redirect';
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    clearFormErrors(form);
    hideAlert();
    const email = $('loginEmail').value.trim();
    const password = $('loginPass').value;
    const isDemoLogin = localDemoLoginEnabled;
    let firstInvalid = null;
    if (isDemoLogin) {
      if (!email) { setFieldError(fieldMap.email, 'demoValueRequired'); firstInvalid ||= $('loginEmail'); }
      else if (email.length > 254) { setFieldError(fieldMap.email, 'demoEmailTooLong'); firstInvalid ||= $('loginEmail'); }
      if (!password) { setFieldError(fieldMap.password, 'demoValueRequired'); firstInvalid ||= $('loginPass'); }
      else if (password.length > 128) { setFieldError(fieldMap.password, 'demoPasswordTooLong'); firstInvalid ||= $('loginPass'); }
    } else {
      if (!isValidEmail(email)) { setFieldError(fieldMap.email); firstInvalid ||= $('loginEmail'); }
      if (password.length < 12 || password.length > 128) { setFieldError(fieldMap.password); firstInvalid ||= $('loginPass'); }
    }
    if (firstInvalid) { firstInvalid.focus(); return; }

    setPending(form, true);
    let completed = false;
    try {
      await withAuthSessionLock(async () => {
        const result = isDemoLogin
          ? await StoreAPI.auth.demoLogin({ email, password })
          : await StoreAPI.auth.login({ email, password });
        broadcastAccountChanged(result?.user?.id);
        await completeAuthentication('login', result?.user?.id, isDemoLogin ? 'demoLoginSuccess' : '');
      });
      completed = true;
    } catch (error) {
      showCopyAlert(errorKey(error), 'error', true);
      applyServerFieldErrors(error, { email: fieldMap.email, password: fieldMap.password });
      $('loginPass').value = '';
    } finally {
      if (!completed) setPending(form, false);
    }
  }

  async function submitSignup(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    clearFormErrors(form);
    hideAlert();
    const displayName = $('suName').value.trim();
    const email = $('suEmail').value.trim();
    const password = $('suPass').value;
    let firstInvalid = null;
    if (displayName.length < 2 || displayName.length > 100) { setFieldError(fieldMap.displayName); firstInvalid ||= $('suName'); }
    if (!isValidEmail(email)) { setFieldError(fieldMap.signupEmail); firstInvalid ||= $('suEmail'); }
    if (password.length < 12 || password.length > 128) { setFieldError(fieldMap.signupPassword); firstInvalid ||= $('suPass'); }
    if (firstInvalid) { firstInvalid.focus(); return; }

    setPending(form, true);
    let completed = false;
    try {
      await withAuthSessionLock(async () => {
        const result = await StoreAPI.auth.register({ displayName, email, password, language: getLang() });
        broadcastAccountChanged(result?.user?.id);
        await completeAuthentication('register', result?.user?.id);
      });
      completed = true;
    } catch (error) {
      showCopyAlert(errorKey(error), 'error', true);
      applyServerFieldErrors(error, {
        displayName: fieldMap.displayName,
        email: fieldMap.signupEmail,
        password: fieldMap.signupPassword
      });
      if (error?.code === 'EMAIL_ALREADY_REGISTERED') {
        setFieldError(fieldMap.signupEmail, 'emailExists');
        $('suEmail').focus();
      }
      $('suPass').value = '';
    } finally {
      if (!completed) setPending(form, false);
    }
  }

  async function submitForgot(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    clearFormErrors(form);
    hideAlert();
    const email = $('forgotEmail').value.trim();
    if (!isValidEmail(email)) {
      setFieldError(fieldMap.forgotEmail);
      $('forgotEmail').focus();
      return;
    }

    setPending(form, true);
    try {
      await StoreAPI.auth.requestPasswordReset({ email });
      showCopyAlert('resetSent', 'success', true);
    } catch (error) {
      showCopyAlert(errorKey(error), 'error', true);
      applyServerFieldErrors(error, { email: fieldMap.forgotEmail });
    } finally {
      setPending(form, false);
    }
  }

  function bindPasswordVisibility() {
    document.querySelectorAll('[data-eye]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = $(button.dataset.eye);
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!showing));
        const icon = button.querySelector('[aria-hidden="true"]');
        icon?.classList.toggle('fa-eye', showing);
        icon?.classList.toggle('fa-eye-slash', !showing);
        const label = t(showing ? 'show_pass' : 'hide_pass');
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
      });
    });
  }

  function syncPasswordVisibilityLabels() {
    document.querySelectorAll('[data-eye]').forEach((button) => {
      const input = $(button.dataset.eye);
      const label = t(input.type === 'text' ? 'hide_pass' : 'show_pass');
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    });
  }

  function bindErrorClearing() {
    Object.values(fieldMap).forEach((config) => {
      $(config.input)?.addEventListener('input', () => clearFieldError(config));
    });
  }

  function syncLocalizedState() {
    applyLocalCopy();
    applyLocalDemoPresentation();
    setBrand(currentMode);
    applyCheckoutIntent();
    if (activeGuestMergeState && !$('guestMergePanel')?.hidden) renderGuestMergeSummary(activeGuestMergeState);
    const alert = $('authAlert');
    if (!alert.hidden) {
      const key = alert.dataset.authAlertKey;
      if (key) alert.textContent = copy(key);
      else hideAlert();
    }
    document.querySelectorAll('.field-error[data-auth-error-key]').forEach((error) => {
      error.textContent = copy(error.dataset.authErrorKey);
    });
    document.querySelectorAll('form[aria-busy="true"] [data-submit-label]').forEach((label) => {
      label.textContent = copy('pending');
    });
    syncPasswordVisibilityLabels();
  }

  function applyCheckoutIntent() {
    const checkoutIntent = isCheckoutIntent();
    const context = $('checkoutAuthContext');
    const mergeChoiceVisible = activeGuestMergeState && !$('guestMergePanel')?.hidden;
    if (context) context.hidden = !checkoutIntent || Boolean(mergeChoiceVisible);
    const continueGuestLink = $('continueGuestLink');
    if (continueGuestLink) continueGuestLink.href = 'checkout.html';
    const backLink = $('authBackLink');
    const backLabel = $('authBackLabel');
    if (backLink) backLink.href = checkoutIntent ? 'cart.html' : 'index.html';
    if (backLabel) backLabel.textContent = checkoutIntent ? copy('backToCart') : t('back_home');
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLocalCopy();
    setBrand('login');
    applyCheckoutIntent();
    const noticeKey = accountNoticeKey();
    bindPasswordVisibility();
    syncPasswordVisibilityLabels();
    bindErrorClearing();
    $('toSignup').addEventListener('click', () => showMode('signup'));
    $('toLogin').addEventListener('click', () => showMode('login', true));
    $('toForgot').addEventListener('click', () => {
      if (!$('forgotEmail').value) $('forgotEmail').value = $('loginEmail').value.trim();
      showMode('forgot');
    });
    $('forgotToLogin').addEventListener('click', () => showMode('login', true));
    $('loginForm').addEventListener('submit', submitLogin);
    $('signupForm').addEventListener('submit', submitSignup);
    $('forgotForm').addEventListener('submit', submitForgot);
    $('mergeGuestBtn').addEventListener('click', acceptGuestMerge);
    $('keepGuestBtn').addEventListener('click', keepGuestShoppingSeparate);
    $('continueAfterAuthBtn').addEventListener('click', continueAfterAuthentication);

    const loginForm = $('loginForm');
    setPending(loginForm, true);
    let redirecting = false;
    withAuthSessionLock(async () => {
      const session = await StoreAPI.bootstrap();
      applyLocalDemoCapability(session);
      if (session?.authenticated) {
        redirecting = true;
        broadcastAccountChanged(session.user?.id);
        await completeAuthentication('login', session.user?.id);
      }
    })
      .then(() => {
        if (redirecting) return;
        setPending(loginForm, false);
        if (noticeKey) showCopyAlert(noticeKey, 'warning', true);
      })
      .catch((error) => {
        if (redirecting) {
          showCopyAlert('mergeWarning', 'warning', true);
          globalThis.setTimeout(() => location.replace(safeNextPage()), 1600);
          return;
        }
        setPending(loginForm, false);
        if (error?.code === 'AUTH_LOCK_UNAVAILABLE') showCopyAlert('authLockUnavailable', 'error', true);
        else if (noticeKey) showCopyAlert(noticeKey, 'warning', true);
        // Submit handlers provide actionable connection errors.
      });
  });

  window.addEventListener('am:langchange', syncLocalizedState);
})();
