/**
 * Wishlist Drawer & Page – client-side rendering (Wishlist extension only).
 * Relies on window.__wishlist_stock.proxyBase set by the Wishlist App Embed.
 *
 * The standalone wishlist page renders saved products in a horizontal (row)
 * layout. Which fields are shown (title, price, SKU, image) is controlled by the
 * per-store UIConfig productCardConfig fetched from the proxy API.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', settings: {} };

  let uiConfig = null; // { extensionActive, productCardConfig } from /ui-config

  function fetchConfig() {
    const cfg = CFG();
    return fetch(`${cfg.proxyBase}/ui-config`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.ok && data.config) {
          uiConfig = data.config;
          window.__wishlist_stock.uiConfig = uiConfig;
        }
      })
      .catch(() => null);
  }

  /* Card display options, merged over defaults. Applied to the wishlist page. */
  function cardCfg() {
    const c = (uiConfig && uiConfig.productCardConfig) || {};
    return {
      displayTitle: c.displayTitle !== false,
      displayPrice: c.displayPrice !== false,
      displaySKU: !!c.displaySKU,
      displayImage: c.displayImage !== false,
    };
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

  /* ---------- Header counter ---------- */
  function setHeaderCount(n) {
    const v = Math.max(0, n | 0);
    try { localStorage.setItem('wishlist_count', String(v)); } catch { /* ignore */ }
    const el = document.getElementById('ws-header-count');
    if (el) { el.textContent = String(v); el.dataset.count = String(v); }
  }

  /* ---------- Fetch wishlist (fast DB-only path) ---------- */
  async function fetchWishlist() {
    const cfg = CFG();
    const params = new URLSearchParams({ guest_token: getGuestToken(), enrich: '0' });
    try {
      const resp = await fetch(`${cfg.proxyBase}/wishlist?${params}`);
      const data = await resp.json();
      if (!data.ok) return [];
      return data.items || [];
    } catch {
      return [];
    }
  }

  /* ---------- Client-side enrichment via /products/{handle}.js ---------- */
  const productCache = new Map();
  async function enrichItem(item) {
    if (item.title && item.url && typeof item.available !== 'undefined') return item;
    const handle = item.handle;
    if (!handle) {
      return { ...item, available: item.available !== undefined ? item.available : true };
    }
    if (productCache.has(handle)) {
      const cached = productCache.get(handle);
      return cached ? applyProductData(item, cached) : { ...item, available: true };
    }
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (!resp.ok) { productCache.set(handle, null); return { ...item, available: true }; }
      const prod = await resp.json();
      productCache.set(handle, prod);
      return applyProductData(item, prod);
    } catch {
      productCache.set(handle, null);
      return { ...item, available: true };
    }
  }

  function applyProductData(item, prod) {
    const variants = prod.variants || [];
    let variant = variants.find((v) => String(v.id) === String(item.variantId));
    if (!variant) {
      variant = variants.find((v) => v.available) || variants[0];
    }
    let price = item.price || '';
    if (variant && variant.price != null) {
      const num = parseFloat(variant.price);
      if (!isNaN(num)) {
        try {
          // `Shopify` is the storefront's global (currency/locale); not a module import.
          // eslint-disable-next-line no-undef
          const currency = (typeof Shopify !== 'undefined' && Shopify.currency && Shopify.currency.active) || 'USD';
          // eslint-disable-next-line no-undef
          price = new Intl.NumberFormat(Shopify.locale || 'en', { style: 'currency', currency }).format(num);
        } catch {
          price = `$${num.toFixed(2)}`;
        }
      }
    }
    return {
      ...item,
      title: prod.title || item.title,
      handle: prod.handle || item.handle,
      url: `/products/${prod.handle || item.handle}${variant ? `?variant=${variant.id}` : ''}`,
      image: (variant && variant.featured_image) ? variant.featured_image.src : (prod.images && prod.images[0] ? prod.images[0].src : item.image || ''),
      variantTitle: variant && variant.title !== 'Default Title' ? variant.title : item.variantTitle || null,
      variantId: variant ? String(variant.id) : item.variantId,
      price,
      sku: variant ? variant.sku || null : item.sku || null,
      available: variant ? variant.available !== false : prod.available !== false,
    };
  }

  async function enrichItems(items) {
    return Promise.all(items.map(enrichItem));
  }

  /* ---------- Remove from wishlist (product-level) ---------- */
  async function removeItem(productId) {
    const cfg = CFG();
    try {
      const resp = await fetch(`${cfg.proxyBase}/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _method: 'DELETE',
          productId,
          guestToken: getGuestToken(),
        }),
      });
      return (await resp.json()).ok;
    } catch {
      return false;
    }
  }

  /* ---------- Move to cart ---------- */
  async function moveToCart(variantId) {
    if (!variantId) return false;
    try {
      const resp = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /* ---------- Notify for an out-of-stock item ----------
     Prefer clicking an existing .notify-me button; otherwise fire a
     `ws:open-bis` event that the Back-in-Stock embed listens for. */
  function requestNotify(variantId, productId) {
    const bis = document.querySelector(`.back-in-stock[data-variant-id="${variantId}"]`);
    if (bis) {
      const notifyBtn = bis.querySelector('.notify-me');
      if (notifyBtn) { notifyBtn.click(); return; }
    }
    document.dispatchEvent(new CustomEvent('ws:open-bis', { detail: { variantId, productId } }));
  }

  /* ---------- HTML builders ---------- */
  function buildProductUrl(item) {
    if (item.url) return item.url;
    if (item.handle) return `/products/${item.handle}${item.variantId ? `?variant=${item.variantId}` : ''}`;
    if (item.productId) return `/products/${item.productId}`;
    return '#';
  }

  function drawerItemHTML(item) {
    const cfg = cardCfg();
    const image = item.image && cfg.displayImage
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" />`
      : '';
    const variant = item.variantTitle ? `<p class="ws-item__variant">${item.variantTitle}</p>` : '';
    const sku = item.sku && cfg.displaySKU ? `<p class="ws-item__sku">SKU: ${item.sku}</p>` : '';
    const price = item.price && cfg.displayPrice ? `<p class="ws-item__price">${item.price}</p>` : '';
    const cartBtn = item.available
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId}" data-product-id="${item.productId}">Out of Stock</button>`;
    const link = buildProductUrl(item);
    const hasLink = link !== '#';
    const imageBox = hasLink
      ? `<a class="ws-item__image" href="${link}">${image}</a>`
      : `<div class="ws-item__image">${image}</div>`;

    return `
      <div class="ws-item" data-product-id="${item.productId}" data-variant-id="${item.variantId || ''}">
        <button class="ws-item__remove" data-action="remove" aria-label="Remove from wishlist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${imageBox}
        <div class="ws-item__info">
          ${cfg.displayTitle ? `<p class="ws-item__title"><a href="${link}">${item.title || 'Product'}</a></p>` : ''}
          ${variant}
          ${sku}
          ${price}
          <div class="ws-item__actions">${cartBtn}</div>
        </div>
      </div>`;
  }

  function pageCardHTML(item, index) {
    const cfg = cardCfg();
    const image = item.image && cfg.displayImage
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" />`
      : '';
    const variant = item.variantTitle ? `<p class="ws-page-card__variant">${item.variantTitle}</p>` : '';
    const sku = item.sku && cfg.displaySKU ? `<p class="ws-page-card__sku">SKU: ${item.sku}</p>` : '';
    const price = item.price && cfg.displayPrice ? `<p class="ws-page-card__price">${item.price}</p>` : '';
    const cartBtn = item.available
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId}" data-product-id="${item.productId}">Out of Stock</button>`;
    const link = buildProductUrl(item);
    const hasLink = link !== '#';
    const imageBox = hasLink
      ? `<a class="ws-page-card__image" href="${link}">${image}</a>`
      : `<div class="ws-page-card__image">${image}</div>`;
    const delay = `animation-delay:${Math.min((index || 0) * 60, 360)}ms`;

    return `
      <div class="ws-page-card ws-page-card--row" data-product-id="${item.productId}" data-variant-id="${item.variantId || ''}" style="${delay}">
        <button class="ws-page-card__remove" data-action="remove" aria-label="Remove from wishlist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${imageBox}
        <div class="ws-page-card__body">
          ${cfg.displayTitle ? `<p class="ws-page-card__title"><a href="${link}">${item.title || 'Product'}</a></p>` : ''}
          ${variant}
          ${sku}
          ${price}
          <div class="ws-page-card__actions">${cartBtn}</div>
        </div>
      </div>`;
  }

  /* ---------- Render Drawer ---------- */
  async function renderDrawer() {
    const items = await fetchWishlist();
    const body = document.getElementById('ws-drawer-items');
    const empty = document.getElementById('ws-drawer-empty');
    const count = document.getElementById('ws-drawer-count');
    if (!body) return;

    if (items.length === 0) {
      body.innerHTML = '';
      if (empty) empty.style.display = '';
      if (count) count.textContent = '';
      setHeaderCount(0);
      return;
    }

    const enriched = await enrichItems(items);

    if (empty) empty.style.display = 'none';
    body.innerHTML = enriched.map(drawerItemHTML).join('');
    if (count) count.textContent = `(${enriched.length})`;
    setHeaderCount(enriched.length);

    bindDrawerActions(body, enriched);
  }

  function bindDrawerActions(container, items) {
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.ws-item');
        const ok = await removeItem(card.dataset.productId);
        if (ok) renderDrawer();
      });
    });

    container.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.innerHTML = '<span class="ws-spinner"></span>';
        const ok = await moveToCart(btn.dataset.variantId);
        if (ok) {
          btn.textContent = 'Added!';
          setTimeout(() => renderDrawer(), 800);
          // notify app of move-to-cart for metrics
          try {
            const card = btn.closest('.ws-item');
            const cfg = CFG();
            if (card && cfg && typeof fetch === 'function') {
              fetch(`${cfg.proxyBase}/wishlist-event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'move_to_cart', productId: card.dataset.productId }),
              }).catch(() => { });
            }
          } catch (e) { }
          if (typeof fetch === 'function') {
            fetch('/cart.js').then((r) => r.json()).then((cart) => {
              document.dispatchEvent(new CustomEvent('cart:change', { detail: { cart } }));
            }).catch(() => { });
          }
        } else {
          btn.textContent = 'Error';
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-action="notify"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDrawer();
        requestNotify(btn.dataset.variantId, btn.dataset.productId);
      });
    });

    container.querySelectorAll('.ws-item__info').forEach((info) => {
      info.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const link = info.querySelector('.ws-item__title a');
        if (link && link.href && link.href !== '#') {
          window.location.href = link.href;
        }
      });
      info.style.cursor = 'pointer';
    });
  }

  /* ---------- Render Page (horizontal rows) ---------- */
  async function renderPage() {
    const grid = document.getElementById('ws-page-grid');
    const empty = document.getElementById('ws-page-empty');
    const count = document.getElementById('ws-page-count');
    if (!grid) return;

    if (empty) empty.style.display = 'none';
    grid.innerHTML =
      '<div class="ws-page__loading" role="status" aria-live="polite">' +
      '<span class="ws-spinner ws-spinner--lg" aria-hidden="true"></span>' +
      '<span class="ws-page__loading-text">Loading your wishlist…</span>' +
      '</div>';

    const items = await fetchWishlist();

    if (items.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = '';
      if (count) count.textContent = '';
      setHeaderCount(0);
      return;
    }

    const enriched = await enrichItems(items);

    if (empty) empty.style.display = 'none';
    grid.innerHTML = enriched.map(pageCardHTML).join('');
    if (count) count.textContent = `${enriched.length} item${enriched.length === 1 ? '' : 's'}`;
    setHeaderCount(enriched.length);

    bindPageActions(grid, enriched);
  }

  function bindPageActions(container, items) {
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.ws-page-card');
        const ok = await removeItem(card.dataset.productId);
        if (ok) {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.98)';
          setTimeout(() => renderPage(), 250);
        }
      });
    });

    container.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.innerHTML = '<span class="ws-spinner"></span>';
        const ok = await moveToCart(btn.dataset.variantId);
        if (ok) {
          btn.textContent = 'Added!';
          // notify app of move-to-cart for metrics
          try {
            const card = btn.closest('.ws-page-card');
            const cfg = CFG();
            if (card && cfg && typeof fetch === 'function') {
              fetch(`${cfg.proxyBase}/wishlist-event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'move_to_cart', productId: card.dataset.productId }),
              }).catch(() => { });
            }
          } catch (e) { }
          if (typeof fetch === 'function') {
            fetch('/cart.js').then((r) => r.json()).then((cart) => {
              document.dispatchEvent(new CustomEvent('cart:change', { detail: { cart } }));
            }).catch(() => { });
          }
        } else {
          btn.textContent = 'Error';
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-action="notify"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestNotify(btn.dataset.variantId, btn.dataset.productId);
      });
    });

    container.querySelectorAll('.ws-page-card__body').forEach((body) => {
      body.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const link = body.querySelector('.ws-page-card__title a');
        if (link && link.href && link.href !== '#') {
          window.location.href = link.href;
        }
      });
      body.style.cursor = 'pointer';
    });
  }

  /* ---------- Drawer open / close ---------- */
  function openDrawer() {
    const overlay = document.getElementById('ws-drawer-overlay');
    const drawer = document.getElementById('ws-drawer');
    if (overlay) overlay.classList.add('is-open');
    if (drawer) { drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); }
    renderDrawer();
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    const overlay = document.getElementById('ws-drawer-overlay');
    const drawer = document.getElementById('ws-drawer');
    if (overlay) overlay.classList.remove('is-open');
    if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
  }

  /* ---------- Auto-mount page markup on the wishlist page ---------- */
  function autoMountPage() {
    const configured = (CFG().settings && CFG().settings.wishlistPageUrl) || '/pages/wishlist';
    const norm = (p) => {
      try { p = new URL(p, window.location.origin).pathname; } catch (e) { /* already a path */ }
      return (p.replace(/\/+$/, '') || '/').toLowerCase();
    };
    const cur = norm(window.location.pathname);
    const want = norm(configured);
    if (cur !== want && !cur.endsWith(want)) return;

    if (document.getElementById('ws-wishlist-page')) return;

    const host =
      document.getElementById('MainContent') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.body;
    if (!host) return;

    const mount = document.createElement('div');
    mount.className = 'ws-page-mount';
    mount.innerHTML =
      '<div class="ws-page" id="ws-wishlist-page">' +
      '<div class="ws-page__header">' +
      '<span class="ws-page__count" id="ws-page-count"></span>' +
      '</div>' +
      '<div class="ws-page__empty" id="ws-page-empty" style="display:none;">' +
      '<svg class="ws-page__empty-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
      '<h2>Your wishlist is empty</h2>' +
      '<p>Browse our products and save items you love.</p>' +
      '<a href="/collections/all" class="ws-btn ws-btn--primary">Browse Products</a>' +
      '</div>' +
      '<div class="ws-page__grid ws-page__grid--rows" id="ws-page-grid"></div>' +
      '</div>';
    host.appendChild(mount);
  }

  /* ---------- Event wiring ---------- */
  function init() {
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-drawer]');
      if (trigger) {
        e.preventDefault();
        openDrawer();
      }
    });

    const closeBtn = document.getElementById('ws-drawer-close');
    const overlay = document.getElementById('ws-drawer-overlay');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    autoMountPage();
    if (document.getElementById('ws-wishlist-page')) {
      renderPage();
    }
  }

  function boot() {
    const start = () => {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => fetchConfig().then(start));
    } else {
      fetchConfig().then(start);
    }
  }

  boot();

  // Expose for other scripts
  window.__wishlistStock = { openDrawer, closeDrawer, renderDrawer, renderPage, fetchWishlist };
})();