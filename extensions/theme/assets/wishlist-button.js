/**
 * Wishlist heart button + storefront injection.
 *
 * Responsibilities (all driven by the App Embed, so the storefront works with
 * zero theme editing):
 *   1. Bind every `.wishlist-heart` (the product app block's heart, and injected
 *      card hearts) to toggle the wishlist.
 *   2. Inject a wishlist link + counter into the theme header that opens the drawer.
 *   3. Inject a heart onto product cards; resolve the numeric product/variant id
 *      lazily via the storefront `/products/{handle}.js` endpoint (no backend change).
 *
 * Relies on window.__wishlist_stock (proxyBase + settings) set by the App Embed Block.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', settings: {} };
  const on = (key) => CFG().settings && CFG().settings[key] !== false; // default ON unless explicitly false

  const handleToIds = new Map(); // productHandle -> { productId, variantId }
  let scanScheduled = false;

  /* ---------- Guest-login policy (Issue #2) ----------
     wsRequiresLogin mirrors the shop's "Require login for wishlist" setting; wsLoggedIn is
     whether a customer is signed in. Both are seeded synchronously from the App Embed so the
     heart can be gated on the very first tap, then reconciled from the server's wishlist
     response (which is the real authority — the POST guard returns 401 login_required). */
  let wsLoggedIn = !!(CFG().settings && CFG().settings.customerLoggedIn) || !!CFG().customerEmail;
  let wsRequiresLogin = false;

  /* ---------- Lightweight toast (dependency-free, theme-agnostic) ----------
     Used to prompt guests to sign in. A single reused node; auto-dismisses. */
  let wsToastTimer = null;
  function showToast(html) {
    let toast = document.getElementById('ws-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ws-toast';
      toast.className = 'ws-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.innerHTML = html;
    // Force reflow so re-triggering the transition works on a reused node.
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    if (wsToastTimer) clearTimeout(wsToastTimer);
    wsToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4000);
  }

  function promptLogin() {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    showToast(
      'Please sign in to save items ' +
      `<a href="/account/login?return_url=${returnUrl}">Sign in</a>`,
    );
  }

  /* ---------- Guest token ---------- */
  function getGuestToken() {
    let t = localStorage.getItem('wishlist_guest_token');
    if (!t) {
      t = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      localStorage.setItem('wishlist_guest_token', t);
    }
    return t;
  }

  /* ---------- Resolve a product handle -> numeric ids (cached + in-flight deduped) ---------- */
  const inflightHandle = new Map(); // productHandle -> Promise<ids|null>
  function resolveHandle(handle) {
    if (!handle) return Promise.resolve(null);
    if (handleToIds.has(handle)) return Promise.resolve(handleToIds.get(handle));
    if (inflightHandle.has(handle)) return inflightHandle.get(handle);
    const p = (async () => {
      try {
        const resp = await fetch(`/products/${handle}.js`);
        if (!resp.ok) return null;
        const prod = await resp.json();
        const ids = {
          productId: String(prod.id),
          variantId: prod.variants && prod.variants[0] ? String(prod.variants[0].id) : '',
        };
        handleToIds.set(handle, ids);
        return ids;
      } catch {
        return null;
      } finally {
        inflightHandle.delete(handle);
      }
    })();
    inflightHandle.set(handle, p);
    return p;
  }

  /* ---------- Ensure a heart has ids (resolving from its handle if needed) ---------- */
  async function ensureIds(btn) {
    if (btn.dataset.productId) {
      return { productId: btn.dataset.productId, variantId: btn.dataset.variantId || '' };
    }
    const ids = await resolveHandle(btn.dataset.productHandle);
    if (ids) {
      btn.dataset.productId = ids.productId;
      if (!btn.dataset.variantId && ids.variantId) btn.dataset.variantId = ids.variantId;
    }
    return ids;
  }

  /* ---------- Header counter (single canonical #ws-header-count node) ----------
     The count is cached in localStorage so the header badge can paint instantly on
     the next page load — before the wishlist fetch returns — instead of popping in
     a beat later. refreshHeartStates() then reconciles it against the server. */
  const COUNT_CACHE_KEY = 'wishlist_count';
  function cachedCount() {
    try {
      const n = parseInt(localStorage.getItem(COUNT_CACHE_KEY) || '', 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }
  function applyCount(el, v) {
    el.textContent = String(v);
    el.dataset.count = String(v);
  }
  function setCount(n) {
    const v = Math.max(0, n | 0);
    try { localStorage.setItem(COUNT_CACHE_KEY, String(v)); } catch { /* ignore */ }
    const el = document.getElementById('ws-header-count');
    if (el) applyCount(el, v);
  }
  function getCount() {
    const el = document.getElementById('ws-header-count');
    if (!el) return 0;
    const n = parseInt(el.dataset.count || el.textContent || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }

  /* ---------- Reflect a heart's in/out state (the filled look is driven by aria-pressed) ---------- */
  function setHeartState(btn, inList) {
    btn.setAttribute('aria-pressed', inList ? 'true' : 'false');
    btn.classList.toggle('is-in-wishlist', !!inList);
  }

  /* ---------- Fetch the wishlist once, then mark every heart on the page ----------
     Uses the DB-only fast path (enrich=0): heart state needs product ids/handles + count,
     NOT titles/images/prices — so we skip the Shopify Admin GraphQL round-trip that the
     enriched response makes. A short-TTL promise cache coalesces the bursts of enhance()
     calls the MutationObserver fires (facet filtering, pagination, quick-add) into one
     request instead of one per mutation. */
  let heartFetch = null; // { at: epochMs, promise }
  const HEART_TTL = 1500;
  function fetchHeartData() {
    const now = Date.now();
    if (heartFetch && now - heartFetch.at < HEART_TTL) return heartFetch.promise;
    const cfg = CFG();
    const params = new URLSearchParams({ guest_token: getGuestToken(), enrich: '0' });
    const promise = fetch(`${cfg.proxyBase}/wishlist?${params}`)
      .then((resp) => resp.json())
      .catch(() => null);
    heartFetch = { at: now, promise };
    return promise;
  }

  async function refreshHeartStates() {
    try {
      const data = await fetchHeartData();
      if (!data || !data.ok || !Array.isArray(data.items)) return;

      // Reconcile the login policy from the authoritative server response.
      if (typeof data.requiresLogin === 'boolean') wsRequiresLogin = data.requiresLogin;
      if (typeof data.loggedIn === 'boolean') wsLoggedIn = data.loggedIn;

      const ids = new Set(data.items.map((i) => String(i.productId)));
      const handles = new Set(data.items.map((i) => i.handle).filter(Boolean));

      document.querySelectorAll('.wishlist-heart').forEach((btn) => {
        const inList =
          (btn.dataset.productId && ids.has(String(btn.dataset.productId))) ||
          (btn.dataset.productHandle && handles.has(btn.dataset.productHandle));
        btn.setAttribute('aria-pressed', inList ? 'true' : 'false');
        btn.classList.toggle('is-in-wishlist', !!inList);
      });

      setCount(data.count !== undefined ? data.count : data.items.length);
    } catch {
      /* silent */
    }
  }

  /* ---------- One add/remove round-trip for the button's target state ----------
     add=true  -> POST                 (adds the product)
     add=false -> POST + _method=delete (removes it; variantId is omitted so a
                  product-level heart always clears, matching how state is shown). */
  async function sendWishlist(btn, add) {
    const cfg = CFG();
    const ids = await ensureIds(btn);
    if (!ids || !ids.productId) return null;

    const payload = { productId: ids.productId, guestToken: getGuestToken() };
    if (add) {
      payload.variantId = btn.dataset.variantId || ids.variantId || null;
      payload.handle = btn.dataset.productHandle || null;
    } else {
      payload._method = 'delete';
    }

    const resp = await fetch(`${cfg.proxyBase}/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.json();
  }

  /* ---------- Reconcile the server to the heart's optimistic state ----------
     The click handler flips the UI instantly; this runs in the background and
     converges to whatever the shopper last intended. Rapid taps are coalesced so
     two quick clicks never fire two overlapping races against the same row. */
  async function syncButton(btn) {
    if (btn.__wsSyncing) { btn.__wsDirty = true; return; }
    btn.__wsSyncing = true;
    try {
      do {
        btn.__wsDirty = false;
        const desired = btn.classList.contains('is-in-wishlist');
        let data = null;
        try {
          data = await sendWishlist(btn, desired);
        } catch (err) {
          console.error('Wishlist error', err);
        }

        if (btn.__wsDirty) continue; // clicked again mid-flight — send the newer intent

        if (data && data.ok) {
          heartFetch = null; // state changed — force the next read to be fresh
          setHeartState(btn, !!data.inWishlist);
          if (data.count !== undefined) setCount(data.count);
          if (window.__wishlistStock && window.__wishlistStock.renderDrawer) {
            window.__wishlistStock.renderDrawer();
          }
        } else {
          // Failed. A 401 login_required means the shop requires sign-in and this shopper
          // isn't authenticated — record the policy and prompt them.
          if (data && data.code === 'login_required') {
            wsRequiresLogin = true;
            wsLoggedIn = false;
            promptLogin();
          }
          // Undo the optimistic flip, resync count from a fresh read.
          setHeartState(btn, !desired);
          heartFetch = null;
          refreshHeartStates();
        }
      } while (btn.__wsDirty);
    } finally {
      btn.__wsSyncing = false;
    }
  }

  /* ---------- Click: flip instantly (optimistic), reconcile in the background ---------- */
  function onHeartClick(btn) {
    const next = !btn.classList.contains('is-in-wishlist');
    // Guest gate (Issue #2): when the shop requires login, don't even optimistically add —
    // prompt sign-in instead. Removal stays allowed. The server 401 is the backstop for the
    // race where the policy flag hasn't loaded yet.
    if (next && wsRequiresLogin && !wsLoggedIn) {
      promptLogin();
      return;
    }
    setHeartState(btn, next);
    setCount(getCount() + (next ? 1 : -1));
    // Pop the heart on an intentional add (not on passive state refreshes).
    if (next) {
      btn.classList.add('ws-just-added');
      setTimeout(() => btn.classList.remove('ws-just-added'), 340);
    }
    syncButton(btn);
  }

  /* ---------- Bind a single heart (idempotent) ---------- */
  function bindHeart(btn) {
    if (btn.__wishlistBound) return;
    btn.__wishlistBound = true;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't let Dawn's whole-card link handle the tap
      // A heart marked as a drawer trigger opens the drawer instead of toggling.
      if (btn.dataset.openDrawer) {
        if (window.__wishlistStock) window.__wishlistStock.openDrawer();
        return;
      }
      onHeartClick(btn);
    });
    // Warm the numeric id from the handle on first hover/focus, so the click's
    // request has nothing left to resolve — kills the first-tap delay on cards.
    if (!btn.dataset.productId && btn.dataset.productHandle) {
      const warm = () => { ensureIds(btn); };
      btn.addEventListener('pointerenter', warm, { once: true });
      btn.addEventListener('focus', warm, { once: true });
    }
  }

  /* ---------- Capture-phase guard for the heart tap ----------
     Themes (Dawn included) often make the whole product card one big link via an
     invisible `.card__heading a::after` overlay. That overlay can paint above the
     injected heart and swallow the tap — the shopper clicks the heart but the card
     link navigates to the product page instead of toggling the wishlist.

     This listener runs in the CAPTURE phase (before the link's own handling) and
     checks whether the click landed *geometrically* inside a heart. If so it honors
     the heart and cancels the navigation — independent of z-index / stacking quirks,
     so it works no matter how the theme layers the card. */
  let cardClickGuardInstalled = false;
  function installCardClickGuard() {
    if (cardClickGuardInstalled) return;
    cardClickGuardInstalled = true;
    document.addEventListener(
      'click',
      (e) => {
        // Heart already got the click — its own handler will toggle; don't double-fire.
        if (e.target && e.target.closest && e.target.closest('.wishlist-heart')) return;

        const x = e.clientX;
        const y = e.clientY;
        if (!x && !y) return; // keyboard/synthetic click: let the focused element handle it

        const hearts = document.querySelectorAll('.wishlist-heart');
        for (const btn of hearts) {
          const r = btn.getBoundingClientRect();
          if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            e.preventDefault();
            e.stopImmediatePropagation(); // stop the card link from navigating
            if (btn.dataset.openDrawer) {
              if (window.__wishlistStock) window.__wishlistStock.openDrawer();
            } else {
              onHeartClick(btn);
            }
            return;
          }
        }
      },
      true, // capture — beat the theme's link handler and the default navigation
    );
  }

  /* ---------- Injection: header link + counter (opens the drawer) ---------- */
  function injectHeaderLink() {
    if (document.getElementById('ws-header-link')) return; // already present
    const host =
      document.querySelector('.header__icons') ||
      document.querySelector('[class*="header__icons"]');
    if (!host) return;

    const link = document.createElement('a');
    // Navigate to the full wishlist page (configurable via the App Embed; default
    // /pages/wishlist). No longer a drawer trigger.
    link.href = CFG().settings.wishlistPageUrl || '/pages/wishlist';
    link.id = 'ws-header-link';
    link.className = 'ws-header-link header__icon header__icon--summary link focus-inset';
    link.setAttribute('aria-label', 'My Wishlist');
    link.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z"/>' +
      '</svg>';

    // Reuse the single canonical counter node from the App Embed (hidden, sr-only)
    // by moving it into the link and making it visible — avoids a duplicate id.
    let counter = document.getElementById('ws-header-count');
    if (!counter) {
      counter = document.createElement('span');
      counter.id = 'ws-header-count';
      counter.dataset.count = '0';
    }
    // Seed from the last known count so the badge appears immediately on load,
    // instead of only after the wishlist fetch completes. Only seed when the node
    // is still at its initial 0 so we never stomp a fresher value.
    const cc = cachedCount();
    if (cc !== null && (!counter.dataset.count || counter.dataset.count === '0')) {
      applyCount(counter, cc);
    }
    counter.classList.remove('ws-sr-only');
    counter.classList.add('ws-count');
    link.appendChild(counter);

    // Sit just before the cart icon when we can find it, else at the end.
    const cart =
      host.querySelector('#cart-icon-bubble') ||
      host.querySelector('a[href$="/cart"], a[href*="/cart?"]');
    if (cart && cart.parentElement === host) host.insertBefore(link, cart);
    else host.appendChild(link);
  }

  /* ---------- Injection: hearts on product cards ---------- */
  function ensureCardStyles() {
    if (document.getElementById('ws-card-heart-style')) return;
    const style = document.createElement('style');
    style.id = 'ws-card-heart-style';
    // z-index must clear Dawn's whole-card link overlay (.card__heading a::after,
    // z-index:1) so the tap lands on the heart instead of opening the product page.
    // Positioning props are !important so no theme rule — or a missing positioning
    // context — can drop the heart out of the corner and into the card's text flow.
    style.textContent = `
      .card-wrapper, .card, .ws-heart-host { position: relative; }

      .ws-card-heart {
        position: absolute !important;
        top: 10px !important;
        right: 10px !important;
        left: auto !important;
        bottom: auto !important;
        z-index: 5;
        width: 36px;
        height: 36px;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.9);
        -webkit-backdrop-filter: blur(6px);
        backdrop-filter: blur(6px);
        border: 1px solid rgba(0, 0, 0, 0.06);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-4px) scale(0.9);
        animation: ws-heart-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                    box-shadow 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
      }

      @keyframes ws-heart-in {
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .card-wrapper:hover .ws-card-heart,
      .card:hover .ws-card-heart { box-shadow: 0 5px 16px rgba(0, 0, 0, 0.22); }

      .ws-card-heart:hover { transform: scale(1.1); background: #fff; }
      .ws-card-heart:active { transform: scale(0.92); }

      .ws-card-heart .wishlist-heart {
        cursor: pointer;
        background: none;
        border: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #33373d;
        border-radius: 50%;
      }

      /* The chip owns the hover motion now; neutralize the base heart's scale/bg. */
      .ws-card-heart .wishlist-heart:hover {
        transform: none;
        background: none;
        color: var(--ws-primary, #e74c3c);
      }

      /* Saved state: red heart + a soft red chip tint. */
      .ws-card-heart .wishlist-heart[aria-pressed="true"] { color: var(--ws-primary, #e74c3c); }
      .ws-card-heart:has(.wishlist-heart[aria-pressed="true"]) {
        background: rgba(231, 76, 60, 0.12);
        border-color: rgba(231, 76, 60, 0.28);
      }

      /* Pop only on an intentional add (class toggled by the click handler). */
      .wishlist-heart.ws-just-added svg { animation: ws-heart-pop 0.32s ease; }
      @keyframes ws-heart-pop {
        0% { transform: scale(1); }
        45% { transform: scale(1.35); }
        100% { transform: scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .ws-card-heart { animation: none; opacity: 1; transform: none; transition: none; }
        .ws-card-heart:hover, .ws-card-heart:active { transform: none; }
        .wishlist-heart.ws-just-added svg { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function handleFromCard(card) {
    const link = card.querySelector('a[href*="/products/"]');
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Pick the box the heart should pin to: the product image/media wrapper, so the
  // chip sits in the image's top-right corner rather than beside the title/price.
  // Falls back to the image's own wrapper, then the card itself.
  function cardHeartHost(card) {
    const media =
      card.querySelector('.card__inner') ||
      card.querySelector('.card__media') ||
      card.querySelector('.media');
    if (media && media.querySelector('img')) return media;
    const img = card.querySelector('img');
    const wrap = img && img.closest('a, figure, div');
    if (wrap && wrap !== card && card.contains(wrap)) return wrap;
    return card;
  }

  function injectCardHearts() {
    ensureCardStyles();

    // Collect each product card once. Prefer Dawn's `.card-wrapper`; fall back to
    // standalone `.card` only when it isn't already inside a `.card-wrapper`, so a
    // nested `.card-wrapper > .card` never receives two hearts.
    const cards = new Set();
    document.querySelectorAll('.card-wrapper').forEach((c) => cards.add(c));
    document.querySelectorAll('.card').forEach((c) => {
      if (!c.closest('.card-wrapper')) cards.add(c);
    });

    cards.forEach((card) => {
      const host = cardHeartHost(card);

      // A heart already in this card is either ours from a previous scan, or one the
      // theme still renders server-side (the old pre-extension integration placed a
      // `.wishlist-heart` in the card's text flow — which is why it showed up at the
      // bottom instead of the corner). If it isn't already inside our corner chip,
      // relocate it into one so the top-right position + effects apply uniformly.
      const existing = card.querySelector('.wishlist-heart');
      if (existing) {
        if (existing.closest('.ws-card-heart')) return; // already chipped — nothing to do
        if (!existing.dataset.productId && !existing.dataset.productHandle) {
          const h = handleFromCard(card);
          if (h) existing.dataset.productHandle = h;
        }
        host.classList.add('ws-heart-host');
        const chip = document.createElement('div');
        chip.className = 'ws-card-heart';
        host.appendChild(chip);
        chip.appendChild(existing); // move the stray/theme heart into the corner chip
        return;
      }

      const handle = handleFromCard(card);
      if (!handle) return;

      // Mount over the image and make that box a positioning context for the chip.
      host.classList.add('ws-heart-host');

      const wrap = document.createElement('div');
      wrap.className = 'ws-card-heart';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wishlist-heart';
      btn.dataset.productHandle = handle;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z" stroke="currentColor" stroke-width="1.6"/>' +
        '</svg><span class="ws-sr-only">Add to wishlist</span>';
      wrap.appendChild(btn);
      host.appendChild(wrap);
    });
  }

  /* ---------- Injection: product-page heart + notify (no manual block needed) ----------
     The "Wishlist Button" app block renders the PDP heart + back-in-stock notify, but a
     merchant has to place it by hand in the theme editor. To make the app work on enable
     alone, inject the same pair here whenever we're on a product page and the block isn't
     already present — heart always, notify only when the current variant is unavailable. */
  function pdpHandle() {
    const m = location.pathname.match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function mainProductForm() {
    const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'));
    if (!forms.length) return null;
    // Prefer the real product form (in the main content, not a related-product
    // quick-add inside a card).
    return (
      forms.find((f) => !f.closest('.card, .card-wrapper') && f.closest('#MainContent, main, .product')) ||
      forms.find((f) => !f.closest('.card, .card-wrapper')) ||
      forms[0]
    );
  }

  function currentVariantId(form) {
    const fromUrl = new URLSearchParams(location.search).get('variant');
    if (fromUrl) return fromUrl;
    const input = form && form.querySelector('[name="id"]');
    return input && input.value ? input.value : '';
  }

  // Availability of the selected variant: prefer the storefront product data; fall back
  // to the theme's add-to-cart button being disabled (Dawn disables it when sold out).
  function variantAvailable(product, vid, form) {
    if (product && Array.isArray(product.variants) && vid) {
      const v = product.variants.find((x) => String(x.id) === String(vid));
      if (v) return !!v.available;
    }
    const addBtn = form && form.querySelector('[name="add"], .product-form__submit, button[type="submit"]');
    if (addBtn && addBtn.disabled) return false;
    return true;
  }

  function notifyMarkup(vid, pid) {
    const label = (CFG().settings && CFG().settings.notifyButtonText) || 'Notify me when available';
    return (
      `<div class="back-in-stock" data-variant-id="${vid}" data-product-id="${pid}">` +
      '<button class="notify-me" type="button">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
      `${label}</button></div>`
    );
  }

  // When the shopper switches variant, keep ids in sync and add/remove the notify block.
  function updatePdpVariant(product, form, wrap) {
    const heart = wrap.querySelector('.wishlist-heart');
    const pid = heart ? heart.dataset.productId || '' : '';
    const vid = currentVariantId(form);
    if (heart && vid) heart.dataset.variantId = vid;

    const bis = wrap.querySelector('.back-in-stock');
    if (variantAvailable(product, vid, form)) {
      if (bis) bis.remove();
    } else if (!bis) {
      wrap.insertAdjacentHTML('beforeend', notifyMarkup(vid, pid));
    } else {
      bis.dataset.variantId = vid;
    }
  }

  let pdpDone = false;
  async function injectProductPage() {
    if (pdpDone) return;
    const handle = pdpHandle();
    if (!handle) return; // not a product page
    // Respect a manually-placed block; never double up.
    if (document.querySelector('.ws-product-block')) { pdpDone = true; return; }
    if (document.getElementById('ws-pdp')) { pdpDone = true; return; }
    const form = mainProductForm();
    if (!form) return; // form not in the DOM yet — a later re-scan will retry
    pdpDone = true;

    // Storefront product data for reliable per-variant availability (non-fatal).
    let product = null;
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (resp.ok) product = await resp.json();
    } catch { /* fall back to the button-disabled heuristic */ }

    const pid = product ? String(product.id) : '';
    const vid =
      currentVariantId(form) ||
      (product && product.variants && product.variants[0] ? String(product.variants[0].id) : '');

    const wrap = document.createElement('div');
    wrap.className = 'ws-pdp';
    wrap.id = 'ws-pdp';
    wrap.dataset.productHandle = handle;
    wrap.innerHTML =
      '<button class="wishlist-heart" type="button"' +
      (pid ? ` data-product-id="${pid}"` : '') +
      (vid ? ` data-variant-id="${vid}"` : '') +
      ` data-product-handle="${handle}" aria-pressed="false">` +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z" stroke="currentColor" stroke-width="1.4"/>' +
      '</svg><span class="ws-sr-only">Add to wishlist</span></button>';

    if (!variantAvailable(product, vid, form)) {
      wrap.insertAdjacentHTML('beforeend', notifyMarkup(vid, pid));
    }

    const anchor = form.closest('product-form') || form;
    anchor.insertAdjacentElement('afterend', wrap);

    // Bind the new heart + reflect its saved state.
    const heart = wrap.querySelector('.wishlist-heart');
    if (heart) bindHeart(heart);
    refreshHeartStates();

    // Re-evaluate when the shopper changes variant (Dawn updates [name=id] then).
    if (!form.__wsPdpBound) {
      form.__wsPdpBound = true;
      form.addEventListener('change', () => {
        setTimeout(() => updatePdpVariant(product, form, wrap), 60);
      });
    }
  }

  /* ---------- Enhance: inject + bind + refresh (debounced-safe) ---------- */
  function enhance() {
    if (on('headerLink')) injectHeaderLink();
    if (on('cardHearts')) injectCardHearts();
    if (on('productButton')) injectProductPage();
    document.querySelectorAll('.wishlist-heart').forEach(bindHeart);
    refreshHeartStates();
  }

  function scheduleEnhance() {
    if (scanScheduled) return;
    scanScheduled = true;
    // Coalesce bursts of DOM mutations (facet filtering, pagination, quick-add).
    setTimeout(() => {
      scanScheduled = false;
      enhance();
    }, 150);
  }

  function init() {
    installCardClickGuard();
    enhance();

    // Re-run when the theme editor re-renders a section, or the storefront swaps
    // the product grid (Dawn facets/pagination) or adds cards dynamically.
    document.addEventListener('shopify:section:load', scheduleEnhance);
    const grid =
      document.getElementById('ProductGridContainer') || document.querySelector('main') || document.body;
    if (window.MutationObserver && grid) {
      new MutationObserver(scheduleEnhance).observe(grid, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
