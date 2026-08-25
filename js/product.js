/**
 * AM MARKET — product.js (product.html)
 * Product detail page. Reads the product id from the URL:
 *   product.html?id=123
 */

const productId = new URLSearchParams(location.search).get('id');
if (!productId) location.replace('index.html');
let productQuantity = 1;
let currentProductReview = null;
let currentReviewsPayload = null;
let productReviewRequestSequence = 0;
const productCopy = (en, fr) => getLang() === 'fr' ? fr : en;

function extractPackSize(product) {
  const explicit = product.package_size || product.pack_size || product.size || product.weight || product.volume || product.weight_volume;
  if (explicit) return String(explicit);
  const match = String(product.name || '').match(/\b\d+(?:[.,]\d+)?\s?(?:kg|g|mg|l|cl|ml)\b/i);
  return match ? match[0] : '';
}

function productSpecsHTML(product) {
  const specs = [
    [t('spec_brand'), product.brand_name],
    [t('spec_category'), product.category_name ? catName(product.category_name) : ''],
    [t('spec_pack'), extractPackSize(product)],
    [t('spec_reference'), product.sku || product.barcode || product.ean]
  ].filter(([, value]) => value != null && String(value).trim());
  if (!specs.length) return '';
  return `<div class="detail-specs" aria-label="${escapeHtml(t('product_details'))}">
    <h2>${t('product_details')}</h2>
    <dl>${specs.map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}
    </dl>
  </div>`;
}

let stickyAtcObserver = null;

async function renderDetail(id, { reviewDraft = null } = {}) {
  const box = $('detailContent');
  const relatedBox = $('relatedSection');
  const reviewsSection = $('reviewsSection');
  const reviewsSummary = $('reviewsSummary');
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = `<div class="col-lg-5" aria-hidden="true"><div class="detail-img skeleton-block"></div></div>
    <div class="col-lg-7" aria-hidden="true"><div class="detail-panel">
      <div class="skeleton-block skeleton-line short"></div>
      <div class="skeleton-block skeleton-line title" style="height:24px;margin-top:14px"></div>
      <div class="skeleton-block skeleton-line price" style="height:30px"></div>
      <div class="skeleton-block skeleton-line" style="width:100%;margin-top:22px"></div>
      <div class="skeleton-block skeleton-line" style="width:72%"></div>
    </div></div>`;
  if (relatedBox) relatedBox.style.display = 'none';
  if (reviewsSection) reviewsSection.setAttribute('aria-busy', 'true');
  if (reviewsSummary) reviewsSummary.textContent = productCopy('Loading reviews…', 'Chargement des avis…');
  $('reviewComposer')?.replaceChildren();
  $('reviewsList')?.replaceChildren();

  try {
    const p = await fetchProduct(id);
    addRecent(p);
    $('detailCrumb').textContent = p.name;
    document.title = 'AM MARKET — ' + p.name;
    const inWish = wishlist.includes(String(p.id));
    const available = p.is_available !== false;

    const hasOld = parseFloat(p.original_price) > parseFloat(p.price);
    const disc = parseInt(p.discount_percent) || 0;

    box.innerHTML = `
      <div class="col-lg-5">
        <div class="detail-img">
          <img src="${safeImageUrl(p.image_url)}" alt="${escapeHtml(p.name)}" data-image-fallback="img/placeholder.svg">
        </div>
      </div>
      <div class="col-lg-7">
        <div class="detail-panel">
          ${p.brand_name ? `<div class="detail-brand">${escapeHtml(p.brand_name)}</div>` : ''}
          <h1 class="detail-title">${escapeHtml(p.name)}</h1>

          <div class="detail-meta">
            ${p.category_name ? `<span class="detail-chip">${escapeHtml(catName(p.category_name))}</span>` : ''}
            <span class="detail-chip ${available ? 'in-stock' : 'out-stock'}">${available ? t('in_stock') : t('out_stock')}</span>
          </div>

          <div class="detail-price-row">
            <span class="detail-price">${formatPrice(p.price)}</span>
            ${hasOld ? `<span class="detail-old">${formatPrice(p.original_price)}</span>` : ''}
            ${disc > 0 ? `<span class="detail-disc">-${disc}%</span>` : ''}
          </div>

          <p class="detail-desc ${p.description ? '' : 'detail-desc-empty'}">${escapeHtml(p.description) || t('no_desc')}</p>

          ${productSpecsHTML(p)}

          <div class="detail-qty">
            <span class="detail-qty-label">${t('quantity')}</span>
            <div class="qty-box detail-qty-box">
              <button type="button" id="dMinus" aria-label="${escapeHtml(t('decrease_named', { name: p.name }))}">−</button>
              <input type="number" id="dQty" value="${productQuantity}" min="1" max="99" inputmode="numeric" aria-label="${escapeHtml(t('quantity_named', { name: p.name }))}">
              <button type="button" id="dPlus" aria-label="${escapeHtml(t('increase_named', { name: p.name }))}">+</button>
            </div>
          </div>

          <div class="detail-actions">
            <button class="detail-btn-primary" id="dAdd" ${!available ? 'disabled' : ''}>
              <i class="fa-solid fa-cart-shopping"></i> ${t('add_to_cart')}
            </button>
            <button class="detail-btn-secondary" id="dBuy" ${!available ? 'disabled' : ''}>${t('buy_now')}</button>
            <button class="detail-wish ${inWish ? 'active' : ''}" id="dWish" type="button" aria-pressed="${inWish}">
              <i class="fa-${inWish ? 'solid' : 'regular'} fa-heart"></i>
              <span>${inWish ? t('remove_wish') : t('add_wish')}</span>
            </button>
          </div>

          <div class="detail-trust">
            <div class="detail-trust-item"><i class="fa-solid fa-truck-fast"></i><span>${t('free_del_over')}</span></div>
            <div class="detail-trust-item"><i class="fa-solid fa-rotate-left"></i><span>${t('easy_returns')}</span></div>
            <div class="detail-trust-item"><i class="fa-solid fa-shield-halved"></i><span>${t('secure_payment')}</span></div>
          </div>
        </div>
      </div>`;

    const qty = $('dQty');
    const normalizeQty = () => {
      const value = Math.floor(Number(qty.value) || 1);
      productQuantity = Math.max(1, Math.min(99, value));
      qty.value = productQuantity;
      return +qty.value;
    };
    qty.addEventListener('input', () => {
      const value = Math.floor(Number(qty.value));
      if (Number.isFinite(value) && value >= 1 && value <= 99) productQuantity = value;
    });
    qty.addEventListener('change', normalizeQty);
    qty.addEventListener('blur', normalizeQty);
    $('dMinus').onclick = () => {
      qty.value = Math.max(1, normalizeQty() - 1);
      normalizeQty();
    };
    $('dPlus').onclick = () => {
      qty.value = Math.min(99, normalizeQty() + 1);
      normalizeQty();
    };
    const doAdd = () => addToCart(p.id, normalizeQty(), p);
    $('dAdd').onclick = doAdd;
    $('dBuy').onclick = async () => {
      if (!doAdd()) return;
      const button = $('dBuy');
      button.disabled = true;
      try {
        await waitForStoreMutations();
        location.href = 'checkout.html';
      } catch (error) {
        if (handleStoreUnauthorized(error)) return;
        console.error('Buy now cart synchronization failed', error);
        toast(t('api_error'));
        renderAccountRecovery();
        button.disabled = false;
        button.focus({ preventScroll: true });
      }
    };
    $('dWish').onclick = async () => {
      const id = String(p.id);
      const wasSaved = wishlist.includes(id);
      if (!toggleWish(id)) return;
      await renderDetail(id);
      $('dWish')?.focus({ preventScroll: true });
      if (wasSaved) {
        toast(t('removed_wish'), t('undo'), async () => {
          if (!wishlist.includes(id)) wishlist.push(id);
          saveWish();
          await renderDetail(id);
          $('dWish')?.focus({ preventScroll: true });
          toast(t('added_wish'));
        });
      }
    };

    // Sticky mobile add-to-cart bar
    let bar = document.getElementById('stickyAtc');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'stickyAtc';
      bar.className = 'sticky-atc';
      bar.innerHTML = `
        <div class="sticky-atc-inner">
          <span class="sticky-atc-price" id="stickyPrice"></span>
          <button type="button" class="sticky-atc-btn" id="stickyAdd">
            <i class="fa-solid fa-cart-shopping"></i>
            <span data-i18n="add_to_cart">${t('add_to_cart')}</span>
          </button>
        </div>`;
      document.body.appendChild(bar);
    }
    $('stickyPrice').textContent = formatPrice(p.price);
    const stickyBtn = $('stickyAdd');
    stickyBtn.disabled = !available;
    stickyBtn.onclick = doAdd;
    stickyAtcObserver?.disconnect();
    bar.classList.remove('is-visible');
    stickyAtcObserver = new IntersectionObserver(([entry]) => {
      const primaryActionHasPassed = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      bar.classList.toggle('is-visible', primaryActionHasPassed);
    }, { threshold: 0.1 });
    stickyAtcObserver.observe($('dAdd'));

    loadRelated(p);
    loadReviews(p.id, { draft: reviewDraft });
  } catch (e) {
    const notFound = e?.status === 404;
    if (!notFound) console.error('Product detail load failed', e);
    const message = t(notFound ? 'product_not_found' : 'failed_load');
    stickyAtcObserver?.disconnect();
    $('stickyAtc')?.classList.remove('is-visible');
    box.innerHTML = `<div class="col-12 text-center py-5">
      <p class="text-danger mb-3" role="alert">${escapeHtml(message)}</p>
      <div class="d-flex justify-content-center gap-2">
        ${notFound ? '' : `<button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryProduct">${escapeHtml(t('retry'))}</button>`}
        <a class="btn btn-orange btn-sm" href="categories.html">${t('browse_products')}</a>
      </div>
    </div>`;
    if (!notFound) $('retryProduct')?.addEventListener('click', () => renderDetail(id));
    if (reviewsSummary) reviewsSummary.textContent = message;
    reviewsSection?.removeAttribute('aria-busy');
    $('reviewComposer')?.replaceChildren();
    $('reviewsList')?.replaceChildren();
  } finally {
    box.removeAttribute('aria-busy');
  }
}

function reviewStars(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  const label = productCopy(`${value} out of 5 stars`, `${value} étoiles sur 5`);
  return `<span class="review-stars" role="img" aria-label="${escapeHtml(label)}">${Array.from({ length: 5 }, (_, index) => `<i class="fa-${index < Math.round(value) ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`).join('')}</span>`;
}

function reviewRatingCopy(rating) {
  const value = Math.max(1, Math.min(5, Number(rating) || 5));
  const english = ['Very poor', 'Poor', 'Average', 'Good', 'Excellent'];
  const french = ['Très mauvais', 'Mauvais', 'Moyen', 'Bien', 'Excellent'];
  return productCopy(english[value - 1], french[value - 1]);
}

function reviewRatingPicker(selectedRating) {
  const rating = Math.max(1, Math.min(5, Number(selectedRating) || 5));
  return `<div class="review-rating-picker" role="group" aria-labelledby="reviewRatingLabel">
    ${[1, 2, 3, 4, 5].map(value => `<button type="button" class="review-rating-star${value <= rating ? ' is-active' : ''}" data-review-rating="${value}" aria-pressed="${value === rating}" aria-label="${escapeHtml(productCopy(`Set rating to ${value} out of 5`, `Noter ${value} sur 5`))}"><i class="fa-solid fa-star" aria-hidden="true"></i></button>`).join('')}
    <input type="hidden" id="reviewRating" value="${rating}">
    <span class="review-rating-value" aria-live="polite"><strong id="reviewRatingScore">${rating} / 5</strong><small id="reviewRatingText">${escapeHtml(reviewRatingCopy(rating))}</small></span>
  </div>`;
}

function syncReviewRatingPicker(nextRating, { focus = false } = {}) {
  const rating = Math.max(1, Math.min(5, Number(nextRating) || 5));
  const input = $('reviewRating');
  if (input) input.value = String(rating);
  document.querySelectorAll('[data-review-rating]').forEach(button => {
    const value = Number(button.dataset.reviewRating);
    button.classList.toggle('is-active', value <= rating);
    button.setAttribute('aria-pressed', String(value === rating));
  });
  if ($('reviewRatingScore')) $('reviewRatingScore').textContent = `${rating} / 5`;
  if ($('reviewRatingText')) $('reviewRatingText').textContent = reviewRatingCopy(rating);
  if (focus) document.querySelector(`[data-review-rating="${rating}"]`)?.focus({ preventScroll: true });
}

function reviewComposerHTML() {
  if (!getUser()) {
    const next = `product.html?id=${encodeURIComponent(productId)}`;
    return `<div class="review-signin"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>${productCopy('Sign in to rate and review this product.', 'Connectez-vous pour noter et commenter ce produit.')}</span><a class="btn btn-outline-orange btn-sm" href="login.html?next=${encodeURIComponent(next)}">${productCopy('Sign in', 'Se connecter')}</a></div>`;
  }
  const review = currentProductReview;
  const rating = Math.max(1, Math.min(5, Number(review?.rating) || 5));
  return `<details class="review-composer" ${review ? '' : 'open'}>
    <summary id="reviewComposerSummary">
      <span class="review-composer-summary-icon" aria-hidden="true"><i class="fa-solid ${review ? 'fa-pen-to-square' : 'fa-pen'}"></i></span>
      <span class="review-composer-summary-copy"><strong>${review ? productCopy('Edit your review', 'Modifier votre avis') : productCopy('Write a review', 'Écrire un avis')}</strong><small>${productCopy('Share an honest experience to help other shoppers.', 'Partagez une expérience sincère pour aider les autres clients.')}</small></span>
      <span class="review-composer-chevron" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
    </summary>
    <form id="reviewForm" class="review-form">
      <div class="review-form-grid">
        <div class="review-field">
          <span class="form-label" id="reviewRatingLabel">${productCopy('Your rating', 'Votre note')}</span>
          ${reviewRatingPicker(rating)}
          <span class="review-field-hint">${productCopy('Select one to five stars.', 'Sélectionnez de une à cinq étoiles.')}</span>
        </div>
        <div class="review-field">
          <label class="form-label" for="reviewTitle">${productCopy('Review title', 'Titre de l’avis')} <span class="review-field-hint">${productCopy('(optional)', '(facultatif)')}</span></label>
          <input class="form-control" id="reviewTitle" maxlength="120" placeholder="${escapeHtml(productCopy('Summarize your experience', 'Résumez votre expérience'))}" value="${escapeHtml(review?.title || '')}">
          <span class="review-field-hint">${productCopy('Up to 120 characters.', 'Jusqu’à 120 caractères.')}</span>
        </div>
        <div class="review-field review-field--body">
          <label class="form-label" for="reviewBody">${productCopy('Your review', 'Votre avis')} <span class="review-field-hint">${productCopy('(optional)', '(facultatif)')}</span></label>
          <textarea class="form-control" id="reviewBody" maxlength="2000" rows="4" placeholder="${escapeHtml(productCopy('What did you like? What should other shoppers know?', 'Qu’avez-vous apprécié ? Que devraient savoir les autres clients ?'))}">${escapeHtml(review?.body || '')}</textarea>
          <span class="review-field-hint">${productCopy('Please avoid sharing personal information.', 'Évitez de partager des informations personnelles.')}</span>
        </div>
      </div>
      <div class="review-form-actions">
        <button type="submit" class="btn btn-orange" id="reviewSubmit"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> ${review ? productCopy('Save changes', 'Enregistrer') : productCopy('Publish review', 'Publier l’avis')}</button>
        ${review ? `<button type="button" class="btn btn-outline-danger" id="reviewDelete">${productCopy('Delete', 'Supprimer')}</button>` : ''}
      </div>
      <div class="alert alert-danger small" id="reviewError" role="alert" hidden></div>
    </form>
  </details>`;
}

function renderReviews(payload) {
  const summary = $('reviewsSummary');
  const composer = $('reviewComposer');
  const list = $('reviewsList');
  if (!summary || !composer || !list) return;
  const count = safeNonNegativeCount(payload.summary?.count);
  const averageValue = Number(payload.summary?.average);
  const average = Number.isFinite(averageValue) ? Math.max(0, Math.min(5, averageValue)) : 0;
  summary.innerHTML = count
    ? `<span class="review-score">${reviewStars(average)}<span class="review-score-line"><strong class="review-score-value">${average.toFixed(1)}</strong><span class="review-score-count">${count} ${productCopy(count === 1 ? 'review' : 'reviews', 'avis')}</span></span></span>`
    : `<span class="review-summary-empty"><strong>${productCopy('No customer reviews yet', 'Aucun avis client pour le moment')}</strong><span>${productCopy('Share your experience and help other shoppers decide.', 'Partagez votre expérience pour aider les autres clients.')}</span></span>`;
  composer.innerHTML = reviewComposerHTML();
  const reviews = payload.reviews || [];
  list.innerHTML = reviews.length ? reviews.map(review => `<article class="review-card">
    <div class="review-card-head"><div>${reviewStars(review.rating)}${review.title ? `<strong>${escapeHtml(review.title)}</strong>` : ''}</div><time datetime="${escapeHtml(review.createdAt)}">${new Date(review.createdAt).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB')}</time></div>
    <div class="review-author">${escapeHtml(review.author)}${review.verifiedPurchase ? `<span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${productCopy('Verified purchase', 'Achat vérifié')}</span>` : ''}</div>
    ${review.body ? `<p>${escapeHtml(review.body)}</p>` : ''}
  </article>`).join('') : '';
  bindReviewComposer();
}

function setReviewPending(pending) {
  const form = $('reviewForm');
  if (!form) return;
  form.toggleAttribute('aria-busy', pending);
  [...form.elements].forEach(control => { control.disabled = pending; });
}

function showReviewError(message = '') {
  const box = $('reviewError');
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

function reviewMatchesInput(review, input) {
  if (!review) return false;
  return Number(review.rating) === Number(input.rating) &&
    String(review.title || '') === String(input.title || '') &&
    String(review.body || '') === String(input.body || '');
}

function focusReviewTarget(target) {
  const element = target === 'composer' ? $('reviewComposerSummary') : $('reviewsHeading');
  if (!element) return;
  requestAnimationFrame(() => element.focus({ preventScroll: true }));
}

function bindReviewComposer() {
  const ratingButtons = [...document.querySelectorAll('[data-review-rating]')];
  ratingButtons.forEach(button => {
    button.addEventListener('click', () => syncReviewRatingPicker(button.dataset.reviewRating));
    button.addEventListener('keydown', event => {
      const current = Number($('reviewRating')?.value || 5);
      const next = event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? Math.min(5, current + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? Math.max(1, current - 1)
          : event.key === 'Home'
            ? 1
            : event.key === 'End'
              ? 5
              : null;
      if (next === null) return;
      event.preventDefault();
      syncReviewRatingPicker(next, { focus: true });
    });
  });
  $('reviewForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    showReviewError();
    setReviewPending(true);
    const input = {
      rating: Number($('reviewRating').value),
      title: $('reviewTitle').value.trim() || null,
      body: $('reviewBody').value.trim() || null
    };
    const draft = captureReviewDraft();
    const editedReviewId = currentProductReview?.id || null;
    const authContext = captureAuthenticatedRequest();
    try {
      if (currentProductReview) await StoreAPI.reviews.update(currentProductReview.id, input);
      else await StoreAPI.reviews.createForProduct(productId, input);
      if (!isAuthenticatedRequestCurrent(authContext)) return;
      toast(productCopy('Your review was saved.', 'Votre avis a été enregistré.'));
      await loadReviews(productId, { focusTarget: 'composer' });
    } catch (error) {
      if (handleStoreUnauthorized(error)) return;
      if (!isAuthenticatedRequestCurrent(authContext)) return;
      console.error('Review save failed', error);
      const reconciled = await loadReviews(productId, { focusTarget: 'composer', draft });
      if (!reconciled || !isAuthenticatedRequestCurrent(authContext)) return;
      const authoritativeSave = reviewMatchesInput(currentProductReview, input) &&
        (!editedReviewId || String(currentProductReview.id) === String(editedReviewId));
      if (authoritativeSave) {
        toast(productCopy('Your review was saved.', 'Votre avis a été enregistré.'));
      } else {
        showReviewError(t('api_error'));
        setReviewPending(false);
      }
    }
  });
  $('reviewDelete')?.addEventListener('click', async () => {
    if (!currentProductReview || !window.confirm(productCopy('Delete your review?', 'Supprimer votre avis ?'))) return;
    setReviewPending(true);
    const draft = captureReviewDraft();
    const authContext = captureAuthenticatedRequest();
    try {
      await StoreAPI.reviews.remove(currentProductReview.id);
      if (!isAuthenticatedRequestCurrent(authContext)) return;
      currentProductReview = null;
      toast(productCopy('Your review was deleted.', 'Votre avis a été supprimé.'));
      await loadReviews(productId, { focusTarget: 'composer' });
    } catch (error) {
      if (handleStoreUnauthorized(error)) return;
      if (!isAuthenticatedRequestCurrent(authContext)) return;
      console.error('Review deletion failed', error);
      const reconciled = await loadReviews(productId, {
        focusTarget: 'composer',
        draft,
        restoreDraftWhenMissing: false
      });
      if (!reconciled || !isAuthenticatedRequestCurrent(authContext)) return;
      if (!currentProductReview) {
        toast(productCopy('Your review was deleted.', 'Votre avis a été supprimé.'));
      } else {
        showReviewError(t('api_error'));
        setReviewPending(false);
      }
    }
  });
}

function captureReviewDraft() {
  const form = $('reviewForm');
  if (!form) return null;
  return {
    rating: $('reviewRating')?.value || '5',
    title: $('reviewTitle')?.value || '',
    body: $('reviewBody')?.value || '',
    open: document.querySelector('.review-composer')?.open !== false
  };
}

function restoreReviewDraft(draft) {
  if (!draft || !$('reviewForm')) return;
  syncReviewRatingPicker(draft.rating);
  if ($('reviewTitle')) $('reviewTitle').value = draft.title;
  if ($('reviewBody')) $('reviewBody').value = draft.body;
  const details = document.querySelector('.review-composer');
  if (details) details.open = Boolean(draft.open);
}

async function loadReviews(id, { focusTarget = '', draft = null, restoreDraftWhenMissing = true } = {}) {
  const requestSequence = ++productReviewRequestSequence;
  const section = $('reviewsSection');
  const summary = $('reviewsSummary');
  if (!section || !summary) return;
  const heading = $('reviewsHeading');
  if (heading) heading.textContent = productCopy('Customer reviews', 'Avis des clients');
  summary.textContent = productCopy('Loading reviews…', 'Chargement des avis…');
  section.setAttribute('aria-busy', 'true');
  const authContext = getUser() ? captureAuthenticatedRequest() : null;
  try {
    const publicRequest = StoreAPI.reviews.listForProduct(id, { page: 1, limit: 20 });
    const mineRequest = getUser()
      ? StoreAPI.reviews.listMine({ page: 1, limit: 1, product_id: String(id) })
      : Promise.resolve({ reviews: [] });
    const [payload, mine] = await Promise.all([publicRequest, mineRequest]);
    if (requestSequence !== productReviewRequestSequence) return false;
    if (authContext && !isAuthenticatedRequestCurrent(authContext)) return false;
    currentReviewsPayload = payload;
    currentProductReview = (mine.reviews || []).find(review => String(review.productId) === String(id)) || null;
    renderReviews(payload);
    if (currentProductReview || restoreDraftWhenMissing) restoreReviewDraft(draft);
    if (focusTarget) focusReviewTarget(focusTarget);
    return true;
  } catch (error) {
    if (handleStoreUnauthorized(error)) return false;
    if (requestSequence !== productReviewRequestSequence) return false;
    if (authContext && !isAuthenticatedRequestCurrent(authContext)) return false;
    console.error('Review load failed', error);
    summary.textContent = t('api_error');
    $('reviewComposer').innerHTML = '';
    $('reviewsList').innerHTML = `<div class="review-load-error">
      <button type="button" class="btn btn-outline-orange btn-sm state-action" id="retryReviews" aria-describedby="reviewsSummary">${escapeHtml(t('retry'))}</button>
    </div>`;
    const retry = $('retryReviews');
    retry?.addEventListener('click', () => loadReviews(id, { focusTarget: 'heading' }));
    if (focusTarget) requestAnimationFrame(() => retry?.focus({ preventScroll: true }));
    return false;
  } finally {
    if (requestSequence === productReviewRequestSequence) section.removeAttribute('aria-busy');
  }
}

// Related products stay within the same category. Fewer relevant items are
// better than padding the section with unrelated catalogue products.
async function loadRelated(product) {
  const section = $('relatedSection');
  const box = $('relatedProducts');
  if (!section || !box) return;

  try {
    const categoryId = typeof product.category === 'object'
      ? product.category.id
      : (product.category || product.category_id);
    if (!categoryId) { section.style.display = 'none'; return; }
    const data = await fetchProducts(1, categoryId, '');
    let list = (data.results || []).filter(p => String(p.id) !== String(product.id));
    list = list.slice(0, 4);

    if (list.length === 0) {
      section.style.display = 'none';
      return;
    }

    box.innerHTML = list.map(cardHTML).join('');
    bindCards(box);
    section.style.display = 'block';
  } catch {
    section.style.display = 'none';
  }
}

if (productId) document.addEventListener('DOMContentLoaded', () => whenStoreReady(() => renderDetail(productId)));

window.addEventListener('am:langchange', () => {
  if (productId) renderDetail(productId, { reviewDraft: captureReviewDraft() });
});

function syncDetailWishlistButton() {
  if (!productId) return;
  const button = $('dWish');
  if (!button) return;
  const saved = wishlist.includes(String(productId));
  button.classList.toggle('active', saved);
  button.setAttribute('aria-pressed', String(saved));
  const icon = button.querySelector('i');
  if (icon) icon.className = `fa-${saved ? 'solid' : 'regular'} fa-heart`;
  const label = button.querySelector('span');
  if (label) label.textContent = t(saved ? 'remove_wish' : 'add_wish');
}

window.addEventListener('am:account-resources-recovered', event => {
  if (!event.detail?.resources?.includes('wishlist')) return;
  syncDetailWishlistButton();
});
window.addEventListener('am:guest-commerce-changed', syncDetailWishlistButton);

window.addEventListener('am:session-expired', () => {
  productReviewRequestSequence += 1;
  currentProductReview = null;
  const wishHadFocus = $('dWish') === document.activeElement;
  const composerHadFocus = $('reviewComposer')?.contains(document.activeElement) === true;
  if (currentReviewsPayload) renderReviews(currentReviewsPayload);
  else if ($('reviewComposer')) $('reviewComposer').innerHTML = reviewComposerHTML();

  syncDetailWishlistButton();
  if (productId) loadReviews(productId);
  if (wishHadFocus || composerHadFocus) {
    requestAnimationFrame(() => {
      const target = wishHadFocus ? $('dWish') : $('reviewComposer')?.querySelector('a, button, summary');
      (target || $('reviewsHeading'))?.focus({ preventScroll: true });
    });
  }
});
