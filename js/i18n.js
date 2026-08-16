/**
 * AM MARKET — i18n (EN / FR)
 * Language persisted in localStorage under 'am_lang'.
 * Static strings: data-i18n / data-i18n-html / data-i18n-ph / data-i18n-title
 * Dynamic strings: t(key, vars)
 */

const I18N = {
  en: {
    // Header
    search_ph: 'Search for products, brands and more...',
    wish_title: 'Wishlist',
    cart_title: 'Cart',
    my_account: 'My Account',
    login_link: 'Login / Sign In',
    my_orders: 'My Orders',
    lang_switch: 'Français / English',
    tagline: 'SHOP MORE, LIVE BETTER',
    search_btn: 'Search',
    notif_title: 'Notifications',
    notif_empty: 'No notifications yet',
    notif_order: 'Order #{id} placed',
    view_profile: 'View Profile',
    my_addresses: 'My Addresses',
    my_reviews: 'My Reviews',
    account_settings: 'Account Settings',
    help_center: 'Help Center',
    logout: 'Logout',
    guest: 'Guest',
    soon: 'Available soon!',
    logged_out: 'Logged out',
    view_all_cats: 'View All Categories',
    tab_home: 'Home',
    tab_search: 'Search',
    tab_cart: 'Cart',
    tab_fav: 'Favorites',
    tab_account: 'Account',
    // Sidebar / home
    all_categories: 'All Categories',
    loading: 'Loading...',
    loading_products: 'Loading products...',
    hero_title: 'Big Deals<br>For Your Home!',
    hero_sub: 'We have the products you love at the prices you’ll love.',
    hero2_title: 'Fresh Groceries Every Day',
    hero2_sub: 'Fruits, dairy & essentials delivered fast.',
    hero3_title: 'Up to 50% OFF Snacks',
    hero3_sub: 'Stock up on your favorites for less.',
    hero4_title: 'Free Delivery over 200 DH',
    hero4_sub: 'Fast & safe delivery all over Morocco.',
    shop_now: 'Shop Now',
    trust1_t: 'Fast Delivery', trust1_s: 'All over Morocco',
    trust2_t: 'Best Price', trust2_s: 'Guarantee',
    trust3_t: 'Easy Returns', trust3_s: 'Within 7 days',
    trust4_t: 'Secure Payment', trust4_s: '100% protected',
    trust5_t: '24/7 Support', trust5_s: 'We’re here for you',
    shop_by_cats: 'Shop by Categories',
    view_all: 'View all',
    recently_viewed: 'Recently Viewed',
    products: 'Products',
    back_top: 'Back to top',
    // Shop / filters
    home: 'Home',
    filters: 'Filters',
    clear: 'Clear',
    category: 'Category',
    price_dh: 'Price (DH)',
    availability: 'Availability',
    in_stock_only: 'In stock only',
    on_promo: 'On promotion',
    brand: 'Brand',
    all_brands: 'All brands',
    no_brands: 'No brands',
    sort_default: 'Default',
    sort_asc: 'Price: Low to High',
    sort_desc: 'Price: High to Low',
    sort_name: 'Name A–Z',
    shown_total: '{n} shown · {total} total',
    n_products: '{n} products',
    no_products: 'No products found',
    no_products_sub: 'We couldn’t find anything for “{q}”',
    clear_search: 'Clear search',
    browse_all: 'Browse all',
    try: 'Try',
    suggest_msg: 'No exact match for “{q}”. Showing results for <strong>“{s}”</strong>',
    search_only: 'Search “{s}” only',
    search_title: 'Search: “{q}”',
    failed_load: 'Failed to load products',
    api_error: 'Could not load data from API. Check your connection.',
    // Detail
    product_crumb: 'Product',
    related: 'Related Products',
    in_stock: 'In Stock',
    out_stock: 'Out of Stock',
    off_badge: '{n}% OFF',
    no_desc: 'No description available for this product.',
    quantity: 'Quantity',
    add_to_cart: 'Add to Cart',
    buy_now: 'Buy Now',
    add_wish: 'Add to Wishlist',
    remove_wish: 'Remove from Wishlist',
    free_del_over: 'Free delivery over 200 DH',
    easy_returns: 'Easy returns',
    secure_payment: 'Secure payment',
    product_not_found: 'Product not found',
    // Cart
    your_cart: 'Your Cart',
    order_summary: 'Order Summary',
    subtotal: 'Subtotal',
    delivery: 'Delivery',
    total: 'Total',
    proceed: 'Proceed to Checkout',
    cart_empty: 'Your cart is empty',
    continue_shopping: 'Continue Shopping',
    free: 'Free',
    each: '{p} each',
    removed: 'Removed',
    added_cart: 'Added to cart',
    // Checkout
    checkout: 'Checkout',
    delivery_info: 'Delivery Information',
    full_name: 'Full Name *',
    phone: 'Phone *',
    email_label: 'Email *',
    address: 'Address *',
    city: 'City *',
    payment_method: 'Payment Method',
    cod: 'Cash on Delivery',
    card_label: 'Credit / Debit Card',
    place_order: 'Place Order',
    fill_all: 'Please fill all fields',
    order_ok: 'Order placed successfully!',
    // Orders
    no_orders: 'No orders yet',
    start_shopping: 'Start Shopping',
    order_no: 'Order #{id}',
    status_processing: 'Processing',
    // Wishlist
    my_wishlist: 'My Wishlist',
    wish_empty: 'Wishlist is empty',
    browse_products: 'Browse Products',
    no_items: 'No items',
    added_wish: 'Added to wishlist',
    removed_wish: 'Removed from wishlist',
    // Footer
    footer_desc: 'Your Moroccan marketplace for everyday products.',
    footer_cats: 'Categories',
    fcat_food: 'Food',
    fcat_drinks: 'Drinks',
    fcat_hygiene: 'Hygiene',
    fcat_home: 'Home',
    footer_help: 'Help',
    about: 'About',
    contact: 'Contact',
    faqs: 'FAQs',
    delivery_link: 'Delivery',
    newsletter: 'Newsletter',
    newsletter_sub: 'Get updates on latest products.',
    go: 'Go',
    rights: '© 2026 <a href="index.html" class="text-blue fw-semibold">AM MARKET</a>. All rights reserved.',
    // Login page
    back_home: 'Back to Store',
    brand_login_title: 'Welcome back!',
    brand_login_text: 'Sign in to manage your orders, wishlist and get the best deals on everyday products.',
    brand_signup_title: 'Welcome aboard!',
    brand_signup_text: 'We’re glad you’re here — create your account in seconds and start enjoying the best deals on everyday products.',
    perk1: 'Free delivery over 200 DH',
    perk2: 'Easy returns within 7 days',
    perk3: '100% secure payment',
    sign_in_h: 'Sign In',
    login_sub: 'Good to see you again 👋',
    email_ph: 'Email address',
    password_ph: 'Password',
    show_pass: 'Show password',
    remember: 'Remember me',
    forgot: 'Forgot password?',
    sign_in_btn: 'Sign In',
    or_continue: 'or continue with',
    new_to: 'New to AM Market?',
    create_account_link: 'Create an account',
    create_h: 'Create Account',
    signup_sub: 'Join AM Market in less than a minute 🚀',
    full_name_ph: 'Full name',
    pass6_ph: 'Password (6+ characters)',
    create_btn: 'Create Account',
    have_account: 'Already have an account?',
    sign_in_link: 'Sign in',
    please_wait: 'Please wait...',
    signed_in: 'Signed in!',
    account_created: 'Account created!',
    welcome_user: 'Welcome, {name}!',
    check_creds: 'Please check your email and password',
    fill_correct: 'Please fill all fields correctly'
  },

  fr: {
    // En-tête
    search_ph: 'Rechercher des produits, marques et plus...',
    wish_title: 'Liste de souhaits',
    cart_title: 'Panier',
    my_account: 'Mon Compte',
    login_link: 'Connexion / Inscription',
    my_orders: 'Mes Commandes',
    lang_switch: 'English / Français',
    tagline: 'ACHETEZ PLUS, VIVEZ MIEUX',
    search_btn: 'Rechercher',
    notif_title: 'Notifications',
    notif_empty: 'Aucune notification',
    notif_order: 'Commande n°{id} passée',
    view_profile: 'Voir le profil',
    my_addresses: 'Mes Adresses',
    my_reviews: 'Mes Avis',
    account_settings: 'Paramètres du compte',
    help_center: 'Centre d’aide',
    logout: 'Déconnexion',
    guest: 'Invité',
    soon: 'Bientôt disponible !',
    logged_out: 'Déconnecté',
    view_all_cats: 'Voir toutes les catégories',
    tab_home: 'Accueil',
    tab_search: 'Rechercher',
    tab_cart: 'Panier',
    tab_fav: 'Favoris',
    tab_account: 'Compte',
    // Sidebar / accueil
    all_categories: 'Toutes les Catégories',
    loading: 'Chargement...',
    loading_products: 'Chargement des produits...',
    hero_title: 'Grandes Promos<br>Pour Votre Maison !',
    hero_sub: 'Nous avons les produits que vous aimez, aux prix que vous allez adorer.',
    hero2_title: 'Produits Frais Chaque Jour',
    hero2_sub: 'Fruits, laitiers & essentiels livrés rapidement.',
    hero3_title: 'Jusqu’à -50% sur les Snacks',
    hero3_sub: 'Faites le plein de vos favoris pour moins cher.',
    hero4_title: 'Livraison Gratuite dès 200 DH',
    hero4_sub: 'Livraison rapide & sécurisée partout au Maroc.',
    shop_now: 'Acheter',
    trust1_t: 'Livraison Rapide', trust1_s: 'Partout au Maroc',
    trust2_t: 'Meilleur Prix', trust2_s: 'Garanti',
    trust3_t: 'Retours Faciles', trust3_s: 'Sous 7 jours',
    trust4_t: 'Paiement Sécurisé', trust4_s: '100% protégé',
    trust5_t: 'Support 24/7', trust5_s: 'Nous sommes là pour vous',
    shop_by_cats: 'Parcourir par Catégories',
    view_all: 'Voir tout',
    recently_viewed: 'Récemment Vus',
    products: 'Produits',
    back_top: 'Haut de page',
    // Boutique / filtres
    home: 'Accueil',
    filters: 'Filtres',
    clear: 'Effacer',
    category: 'Catégorie',
    price_dh: 'Prix (DH)',
    availability: 'Disponibilité',
    in_stock_only: 'En stock uniquement',
    on_promo: 'En promotion',
    brand: 'Marque',
    all_brands: 'Toutes les marques',
    no_brands: 'Aucune marque',
    sort_default: 'Par défaut',
    sort_asc: 'Prix : croissant',
    sort_desc: 'Prix : décroissant',
    sort_name: 'Nom A–Z',
    shown_total: '{n} affichés · {total} au total',
    n_products: '{n} produits',
    no_products: 'Aucun produit trouvé',
    no_products_sub: 'Aucun résultat pour « {q} »',
    clear_search: 'Effacer la recherche',
    browse_all: 'Tout parcourir',
    try: 'Essayez',
    suggest_msg: 'Aucune correspondance exacte pour « {q} ». Résultats pour <strong>« {s} »</strong>',
    search_only: 'Rechercher « {s} » uniquement',
    search_title: 'Recherche : « {q} »',
    failed_load: 'Échec du chargement des produits',
    api_error: 'Impossible de charger les données. Vérifiez votre connexion.',
    // Fiche produit
    product_crumb: 'Produit',
    related: 'Produits Similaires',
    in_stock: 'En stock',
    out_stock: 'Rupture de stock',
    off_badge: '-{n}%',
    no_desc: 'Aucune description disponible pour ce produit.',
    quantity: 'Quantité',
    add_to_cart: 'Ajouter au Panier',
    buy_now: 'Acheter Maintenant',
    add_wish: 'Ajouter à la liste de souhaits',
    remove_wish: 'Retirer de la liste de souhaits',
    free_del_over: 'Livraison gratuite dès 200 DH',
    easy_returns: 'Retours faciles',
    secure_payment: 'Paiement sécurisé',
    product_not_found: 'Produit introuvable',
    // Panier
    your_cart: 'Votre Panier',
    order_summary: 'Récapitulatif de la Commande',
    subtotal: 'Sous-total',
    delivery: 'Livraison',
    total: 'Total',
    proceed: 'Passer la Commande',
    cart_empty: 'Votre panier est vide',
    continue_shopping: 'Continuer vos achats',
    free: 'Gratuite',
    each: '{p} l’unité',
    removed: 'Supprimé',
    added_cart: 'Ajouté au panier',
    // Commande
    checkout: 'Paiement',
    delivery_info: 'Informations de Livraison',
    full_name: 'Nom complet *',
    phone: 'Téléphone *',
    email_label: 'Email *',
    address: 'Adresse *',
    city: 'Ville *',
    payment_method: 'Mode de Paiement',
    cod: 'Paiement à la Livraison',
    card_label: 'Carte Bancaire',
    place_order: 'Commander',
    fill_all: 'Veuillez remplir tous les champs',
    order_ok: 'Commande passée avec succès !',
    // Commandes
    no_orders: 'Aucune commande pour le moment',
    start_shopping: 'Commencer vos achats',
    order_no: 'Commande n°{id}',
    status_processing: 'En cours',
    // Liste de souhaits
    my_wishlist: 'Ma Liste de Souhaits',
    wish_empty: 'Votre liste de souhaits est vide',
    browse_products: 'Parcourir les produits',
    no_items: 'Aucun article',
    added_wish: 'Ajouté à la liste de souhaits',
    removed_wish: 'Retiré de la liste de souhaits',
    // Pied de page
    footer_desc: 'Votre marketplace marocaine pour tous les produits du quotidien.',
    footer_cats: 'Catégories',
    fcat_food: 'Alimentation',
    fcat_drinks: 'Boissons',
    fcat_hygiene: 'Hygiène',
    fcat_home: 'Maison',
    footer_help: 'Aide',
    about: 'À propos',
    contact: 'Contact',
    faqs: 'FAQs',
    delivery_link: 'Livraison',
    newsletter: 'Newsletter',
    newsletter_sub: 'Recevez nos nouveautés et offres.',
    go: 'OK',
    rights: '© 2026 <a href="index.html" class="text-blue fw-semibold">AM MARKET</a>. Tous droits réservés.',
    // Page connexion
    back_home: 'Retour à la boutique',
    brand_login_title: 'Bon retour !',
    brand_login_text: 'Connectez-vous pour gérer vos commandes, votre liste de souhaits et profiter des meilleures offres du quotidien.',
    brand_signup_title: 'Bienvenue à bord !',
    brand_signup_text: 'Nous sommes ravis de vous voir — créez votre compte en quelques secondes et profitez des meilleures offres du quotidien.',
    perk1: 'Livraison gratuite dès 200 DH',
    perk2: 'Retours faciles sous 7 jours',
    perk3: 'Paiement 100% sécurisé',
    sign_in_h: 'Connexion',
    login_sub: 'Ravi de vous revoir 👋',
    email_ph: 'Adresse email',
    password_ph: 'Mot de passe',
    show_pass: 'Afficher le mot de passe',
    remember: 'Se souvenir de moi',
    forgot: 'Mot de passe oublié ?',
    sign_in_btn: 'Se connecter',
    or_continue: 'ou continuer avec',
    new_to: 'Nouveau sur AM Market ?',
    create_account_link: 'Créer un compte',
    create_h: 'Créer un Compte',
    signup_sub: 'Rejoignez AM Market en moins d’une minute 🚀',
    full_name_ph: 'Nom complet',
    pass6_ph: 'Mot de passe (6+ caractères)',
    create_btn: 'Créer le compte',
    have_account: 'Déjà un compte ?',
    sign_in_link: 'Se connecter',
    please_wait: 'Veuillez patienter...',
    signed_in: 'Connecté !',
    account_created: 'Compte créé !',
    welcome_user: 'Bienvenue, {name} !',
    check_creds: 'Vérifiez votre email et votre mot de passe',
    fill_correct: 'Veuillez remplir correctement tous les champs'
  }
};

// Keys allowed to render markup via data-i18n-html (static constants only)
const I18N_HTML_KEYS = { hero_title: 1, rights: 1 };

// Category names as returned by the API (French) -> English display names
const CAT_EN = {
  'boissons': 'Beverages',
  'hygiene': 'Hygiene',
  'produits laitiers': 'Dairy Products',
  'glaces': 'Ice Cream',
  'epicerie': 'Groceries',
  'fruits sec': 'Dried Fruits',
  'friandise': 'Candies',
  'maison cuisine': 'Home & Kitchen',
  'univers bebe': 'Baby & Kids',
  'snacks sucres': 'Sweet Snacks',
  'animaux': 'Pet Supplies',
  'snacks sales': 'Salty Snacks',
  'boulangerie patisserie': 'Bakery & Pastry',
  'nettoyage': 'Cleaning',
  'cadeaux fetes': 'Gifts & Parties',
  'fournitures bureau': 'Office Supplies',
  'divertissement': 'Entertainment',
  'frais': 'Fresh Food',
  'petit dejeuner': 'Breakfast',
  'asiatique': 'Asian Food',
  'accessoire telephone': 'Phone Accessories',
  'accessoire téléphone': 'Phone Accessories',
  'congele': 'Frozen',
  'eau': 'Water'
};

// Translate an API category name for the current language (FR shows it as-is)
function catName(name) {
  if (!name) return name || '';
  if (getLang() === 'fr') return name;
  return CAT_EN[String(name).toLowerCase().trim()] || name;
}

function getLang() {
  const l = localStorage.getItem('am_lang');
  return (l === 'fr' || l === 'en') ? l : 'en';
}

function t(key, vars) {
  const lang = getLang();
  let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

function applyI18n(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  // innerHTML only for whitelisted keys whose values are trusted, developer-managed
  // markup constants in I18N (no user/network data ever interpolated into them).
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (I18N_HTML_KEYS[key]) el.innerHTML = t(key);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
  document.documentElement.lang = getLang();
  const lbl = document.getElementById('langLabel');
  if (lbl) lbl.textContent = getLang() === 'en' ? 'EN' : 'FR';
}

function setLang(lang) {
  localStorage.setItem('am_lang', lang);
  applyI18n();
  window.dispatchEvent(new CustomEvent('am:langchange', { detail: { lang } }));
}

function toggleLang() {
  setLang(getLang() === 'en' ? 'fr' : 'en');
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  document.querySelectorAll('[data-lang-toggle]').forEach(b => b.addEventListener('click', toggleLang));
});
