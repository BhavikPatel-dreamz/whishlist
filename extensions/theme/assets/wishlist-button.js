/**
 * Wishlist heart button + storefront injection (Wishlist extension only).
 *
 * Responsibilities (all driven by the Wishlist App Embed, so the storefront works
 * with zero theme editing):
 *   1. Bind every `.wishlist-heart` to toggle the wishlist.
 *   2. Inject a wishlist link + counter into the theme header that opens the page.
 *   3. Inject a heart onto product cards; resolve the numeric product/variant id
 *      lazily via the storefront `/products/{handle}.js` endpoint.
 *   4. Inject a heart onto product pages when the block isn't manually placed.
 *
 * Back-in-stock notify buttons/modal are handled by the separate
 * "Back-in-Stock" extension. The Shopify app-embed toggle is the activation
 * gate; UIConfig must not be a second gate because Shopify does not send
 * theme-editor toggle changes through the app proxy.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', settings: {} };
  const on = (key) => CFG().settings && CFG().settings[key] !== false; // default ON unless explicitly false

  const handleToIds = new Map(); // productHandle -> { productId, variantId }
  let scanScheduled = false;

  /* ---------- Guest-login policy ---------- */
  let wsLoggedIn = !!(CFG().settings && CFG().settings.customerLoggedIn) || !!CFG().customerEmail;
  let wsRequiresLogin = false;

  /* ---------- Lightweight toast ---------- */
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
  const inflightHandle = new Map();
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

  /* ---------- Header counter ---------- */
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

  /* ---------- Heart state ---------- */
  function setHeartState(btn, inList) {
    btn.setAttribute('aria-pressed', inList ? 'true' : 'false');
    btn.classList.toggle('is-in-wishlist', !!inList);
  }

  let heartFetch = null;
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

        if (btn.__wsDirty) continue;

        if (data && data.ok) {
          heartFetch = null;
          setHeartState(btn, !!data.inWishlist);
          if (data.count !== undefined) setCount(data.count);
          if (window.__wishlistStock && window.__wishlistStock.renderDrawer) {
            window.__wishlistStock.renderDrawer();
          }
        } else {
          if (data && data.code === 'login_required') {
            wsRequiresLogin = true;
            wsLoggedIn = false;
            promptLogin();
          }
          setHeartState(btn, !desired);
          heartFetch = null;
          refreshHeartStates();
        }
      } while (btn.__wsDirty);
    } finally {
      btn.__wsSyncing = false;
    }
  }

  function onHeartClick(btn) {
    const next = !btn.classList.contains('is-in-wishlist');
    if (next && wsRequiresLogin && !wsLoggedIn) {
      promptLogin();
      return;
    }
    setHeartState(btn, next);
    setCount(getCount() + (next ? 1 : -1));
    if (next) {
      btn.classList.add('ws-just-added');
      setTimeout(() => btn.classList.remove('ws-just-added'), 340);
    }
    syncButton(btn);
  }

  function bindHeart(btn) {
    if (btn.__wishlistBound) return;
    btn.__wishlistBound = true;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.openDrawer) {
        if (window.__wishlistStock) window.__wishlistStock.openDrawer();
        return;
      }
      onHeartClick(btn);
    });
    if (!btn.dataset.productId && btn.dataset.productHandle) {
      const warm = () => { ensureIds(btn); };
      btn.addEventListener('pointerenter', warm, { once: true });
      btn.addEventListener('focus', warm, { once: true });
    }
  }

  /* ---------- Capture-phase guard for the heart tap ---------- */
  let cardClickGuardInstalled = false;
  function installCardClickGuard() {
    if (cardClickGuardInstalled) return;
    cardClickGuardInstalled = true;
    document.addEventListener(
      'click',
      (e) => {
        if (e.target && e.target.closest && e.target.closest('.wishlist-heart')) return;

        const x = e.clientX;
        const y = e.clientY;
        if (!x && !y) return;

        const hearts = document.querySelectorAll('.wishlist-heart');
        for (const btn of hearts) {
          const r = btn.getBoundingClientRect();
          if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (btn.dataset.openDrawer) {
              if (window.__wishlistStock) window.__wishlistStock.openDrawer();
            } else {
              onHeartClick(btn);
            }
            return;
          }
        }
      },
      true,
    );
  }

  /* ---------- Injection: header link + counter ---------- */
  function wishlistIconMarkup(size) {
    const s = CFG().settings || {};
    const iconType = s.iconType || 'heart';
    const imageUrl = s.iconImage || '';
    const dimension = size || 22;

    if (iconType === 'image' && imageUrl) {
      return `<img src="${imageUrl}" alt="Wishlist" width="${dimension}" height="${dimension}" style="width:${dimension}px;height:${dimension}px;" />`;
    }

    const paths = {
      heart: '<path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z"/>',
      star: '<path d="m12 3 2.8 5.67 6.26.91-4.53 4.41 1.07 6.23L12 17.28l-5.6 2.94 1.07-6.23-4.53-4.41 6.26-.91L12 3z"/>',
      bookmark: '<path d="M6 3h12v18l-6-3.5L6 21V3z"/>',
    };
    return `<svg width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[iconType] || paths.heart}</svg>`;
  }

  function renderHeaderIconMarkup() {
    const s = CFG().settings || {};
    const size = Math.max(14, Number(s.buttonSize) || 20);
    return wishlistIconMarkup(size);
  }

  function injectHeaderLink() {
    if (document.getElementById('ws-header-link')) return;
    const host =
      document.querySelector('.header__icons') ||
      document.querySelector('[class*="header__icons"]');
    if (!host) return;

    const link = document.createElement('a');
    link.href = CFG().settings.wishlistPageUrl || '/pages/wishlist';
    link.id = 'ws-header-link';
    link.className = 'ws-header-link header__icon header__icon--summary link focus-inset';
    link.setAttribute('aria-label', 'My Wishlist');
    link.innerHTML = renderHeaderIconMarkup();

    let counter = document.getElementById('ws-header-count');
    if (!counter) {
      counter = document.createElement('span');
      counter.id = 'ws-header-count';
      counter.dataset.count = '0';
    }
    const cc = cachedCount();
    if (cc !== null && (!counter.dataset.count || counter.dataset.count === '0')) {
      applyCount(counter, cc);
    }
    counter.classList.remove('ws-sr-only');
    counter.classList.add('ws-count');
    link.appendChild(counter);

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

      .ws-card-heart .wishlist-heart:hover {
        transform: none;
        background: none;
        color: var(--ws-primary, #e74c3c);
      }

      .ws-card-heart .wishlist-heart[aria-pressed="true"] { color: var(--ws-primary, #e74c3c); }
      .ws-card-heart:has(.wishlist-heart[aria-pressed="true"]) {
        background: rgba(231, 76, 60, 0.12);
        border-color: rgba(231, 76, 60, 0.28);
      }

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

    const cards = new Set();
    document.querySelectorAll('.card-wrapper').forEach((c) => cards.add(c));
    document.querySelectorAll('.card').forEach((c) => {
      if (!c.closest('.card-wrapper')) cards.add(c);
    });

    cards.forEach((card) => {
      const host = cardHeartHost(card);
      const existing = card.querySelector('.wishlist-heart');
      if (existing) {
        if (existing.closest('.ws-card-heart')) return;
        if (!existing.dataset.productId && !existing.dataset.productHandle) {
          const h = handleFromCard(card);
          if (h) existing.dataset.productHandle = h;
        }
        host.classList.add('ws-heart-host');
        const chip = document.createElement('div');
        chip.className = 'ws-card-heart';
        host.appendChild(chip);
        chip.appendChild(existing);
        return;
      }

      const handle = handleFromCard(card);
      if (!handle) return;

      host.classList.add('ws-heart-host');

      const wrap = document.createElement('div');
      wrap.className = 'ws-card-heart';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wishlist-heart';
      btn.dataset.productHandle = handle;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = wishlistIconMarkup(20) + '<span class="ws-sr-only">Add to wishlist</span>';
      wrap.appendChild(btn);
      host.appendChild(wrap);
    });
  }

  /* ---------- Injection: product-page heart (no notify — that's the BIS ext) ---------- */
  function pdpHandle() {
    const m = location.pathname.match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function mainProductForm() {
    const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'));
    if (!forms.length) return null;
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

  function productPageScope(form) {
    return (
      form.closest('.shopify-section') ||
      form.closest('section') ||
      form.closest('main') ||
      document.body
    );
  }

  let pdpBoundForm = null;
  async function injectProductPage() {
    if (!on('productButton')) return;
    const handle = pdpHandle();
    if (!handle) return;
    if (document.querySelector('.ws-product-block')) return;
    const form = mainProductForm();
    if (!form) return;
    if (pdpBoundForm) return;

    const scope = productPageScope(form);

    // Theme section events can fire while the product JSON request is pending.
    // Reuse the first existing PDP heart instead of creating another one.
    const existingPdpHearts = Array.from(scope.querySelectorAll('.ws-pdp .wishlist-heart'));
    if (existingPdpHearts.length) {
      existingPdpHearts.slice(1).forEach((heart) => {
        const wrapper = heart.closest('.ws-pdp');
        if (wrapper) wrapper.remove();
      });
      bindHeart(existingPdpHearts[0]);
      pdpBoundForm = form;
      return;
    }

    // If the theme or a merchant has already placed a wishlist button on the
    // product page, avoid injecting another one to prevent duplicate hearts on
    // the PDP.
    if (scope.querySelector('.ws-pdp .wishlist-heart, .ws-product-block .wishlist-heart, form[action*="/cart/add"] .wishlist-heart')) {
      pdpBoundForm = form;
      return;
    }

    // Reserve this form before awaiting the product lookup. This prevents
    // concurrent MutationObserver callbacks from inserting duplicate hearts.
    pdpBoundForm = form;

    let product = null;
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (resp.ok) product = await resp.json();
    } catch { /* non-fatal */ }

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
      wishlistIconMarkup(24) + '<span class="ws-sr-only">Add to wishlist</span></button>';

    const anchor = form.closest('product-form') || form;
    anchor.insertAdjacentElement('afterend', wrap);

    const heart = wrap.querySelector('.wishlist-heart');
    if (heart) bindHeart(heart);
    refreshHeartStates();

    if (!form.__wsWishlistBound) {
      form.__wsWishlistBound = true;
      form.addEventListener('change', () => {
        setTimeout(() => {
          const h = wrap.querySelector('.wishlist-heart');
          const nv = currentVariantId(form);
          if (h && nv) h.dataset.variantId = nv;
        }, 60);
      });
    }
  }

  /* ---------- Enhance: inject + bind + refresh ---------- */
  function enhance() {
    if (on('headerLink')) injectHeaderLink();
    if (on('cardHearts')) injectCardHearts();
    injectProductPage();
    document.querySelectorAll('.wishlist-heart').forEach(bindHeart);
    refreshHeartStates();
  }

  function scheduleEnhance() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      enhance();
    }, 150);
  }

  function boot() {
    const start = () => {
      installCardClickGuard();
      enhance();

      document.addEventListener('shopify:section:load', scheduleEnhance);
      const grid =
        document.getElementById('ProductGridContainer') || document.querySelector('main') || document.body;
      if (window.MutationObserver && grid) {
        new MutationObserver(scheduleEnhance).observe(grid, { childList: true, subtree: true });
      }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  boot();
})();
