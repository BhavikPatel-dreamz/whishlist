/**
 * Wishlist Drawer & Page – client-side rendering.
 * Relies on window.__wishlist_stock.proxyBase set by the App Embed Block.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', settings: {} };

  /* ---------- Guest token ---------- */
  function getGuestToken() {
    let t = localStorage.getItem('wishlist_guest_token');
    if (!t) {
      t = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      localStorage.setItem('wishlist_guest_token', t);
    }
    return t;
  }

  /* ---------- Header counter (kept in sync + cached for an instant paint next load) ----------
     Mirrors wishlist-button.js by writing the same localStorage key, so the badge on
     the next page load shows the right number before the wishlist fetch returns. */
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

  /* ---------- Client-side enrichment (avoids Admin GraphQL round-trip) ----------
     Uses the fast public /products/{handle}.js storefront endpoint to resolve
     title, image, price, and availability for each item. This is dramatically
     faster than the server-side enriched path which makes a GraphQL call per item. */
  const productCache = new Map();
  async function enrichItem(item) {
    if (item.title && item.url) return item;
    const handle = item.handle;
    if (!handle) return item;
    if (productCache.has(handle)) {
      const cached = productCache.get(handle);
      return cached ? applyProductData(item, cached) : item;
    }
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (!resp.ok) { productCache.set(handle, null); return item; }
      const prod = await resp.json();
      productCache.set(handle, prod);
      return applyProductData(item, prod);
    } catch {
      productCache.set(handle, null);
      return item;
    }
  }

  function applyProductData(item, prod) {
    const variant = (prod.variants || []).find(v => String(v.id) === String(item.variantId)) || (prod.variants || [])[0];
    let price = item.price || '';
    if (variant && variant.price != null) {
      const num = parseFloat(variant.price);
      if (!isNaN(num)) {
        try {
          const currency = (typeof Shopify !== 'undefined' && Shopify.currency && Shopify.currency.active) || 'USD';
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
      price,
      available: variant ? variant.available : prod.available,
    };
  }

  async function enrichItems(items) {
    return Promise.all(items.map(enrichItem));
  }

  /* ---------- Remove from wishlist ----------
     Product-level delete (variantId intentionally omitted): the backend then clears
     every row for this product, so the × always removes the card. Sending the
     *displayed* variantId can 0-match when the stored row used a different or blank
     variant (enrich falls back to variants[0]) — which is exactly why some items
     animated away but "couldn't be deleted" and reappeared on the next render. */
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

  /* ---------- HTML builders ---------- */
  function buildProductUrl(item) {
    if (item.url) return item.url;
    if (item.handle) return `/products/${item.handle}${item.variantId ? `?variant=${item.variantId}` : ''}`;
    if (item.productId) return `/products/${item.productId}`;
    return '#';
  }

  function drawerItemHTML(item) {
    const image = item.image
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" />`
      : '';
    const variant = item.variantTitle ? `<p class="ws-item__variant">${item.variantTitle}</p>` : '';
    const price = item.price ? `<p class="ws-item__price">${item.price}</p>` : '';
    const cartBtn = item.available
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId}">Out of Stock</button>`;
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
          <p class="ws-item__title"><a href="${link}">${item.title || 'Product'}</a></p>
          ${variant}
          ${price}
          <div class="ws-item__actions">${cartBtn}</div>
        </div>
      </div>`;
  }

  function pageCardHTML(item, index) {
    const image = item.image
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" />`
      : '';
    const price = item.price ? `<p class="ws-page-card__price">${item.price}</p>` : '';
    const cartBtn = item.available
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId}">Out of Stock</button>`;
    const link = buildProductUrl(item);
    const hasLink = link !== '#';
    const imageBox = hasLink
      ? `<a class="ws-page-card__image" href="${link}">${image}</a>`
      : `<div class="ws-page-card__image">${image}</div>`;
    // Stagger the card fade-in for a polished cascade on load.
    const delay = `animation-delay:${Math.min((index || 0) * 60, 360)}ms`;

    return `
      <div class="ws-page-card" data-product-id="${item.productId}" data-variant-id="${item.variantId || ''}" style="${delay}">
        <button class="ws-page-card__remove" data-action="remove" aria-label="Remove from wishlist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${imageBox}
        <div class="ws-page-card__body">
          <p class="ws-page-card__title"><a href="${link}">${item.title || 'Product'}</a></p>
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

    if (empty) empty.style.display = 'none';
    body.innerHTML = items.map(drawerItemHTML).join('');
    if (count) count.textContent = `(${items.length})`;
    setHeaderCount(items.length);

    bindDrawerActions(body, items);
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
          if (typeof fetch === 'function') {
            fetch('/cart.js').then(r => r.json()).then(c => {
              document.dispatchEvent(new CustomEvent('cart:change', { detail: { cart: c } }));
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
        const variantId = btn.dataset.variantId;
        const bis = document.querySelector(`.back-in-stock[data-variant-id="${variantId}"]`);
        if (bis) {
          const notifyBtn = bis.querySelector('.notify-me');
          if (notifyBtn) notifyBtn.click();
        }
      });
    });

    // Make the drawer item info area clickable to navigate to the product page.
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

  /* ---------- Render Page ---------- */
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

    // Client-side enrichment: resolve product data using the fast storefront API
    // instead of the server-side Admin GraphQL round-trip.
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
          card.style.transform = 'scale(0.9)';
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
          if (typeof fetch === 'function') {
            fetch('/cart.js').then(r => r.json()).then(c => {
              document.dispatchEvent(new CustomEvent('cart:change', { detail: { cart: c } }));
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
        const variantId = btn.dataset.variantId;
        const bis = document.querySelector(`.back-in-stock[data-variant-id="${variantId}"]`);
        if (bis) {
          const notifyBtn = bis.querySelector('.notify-me');
          if (notifyBtn) notifyBtn.click();
        }
      });
    });

    // Make the entire card body clickable to navigate to the product page.
    container.querySelectorAll('.ws-page-card__body').forEach((body) => {
      body.addEventListener('click', (e) => {
        // Don't navigate when clicking buttons or existing links.
        if (e.target.closest('button') || e.target.closest('a')) return;
        const card = body.closest('.ws-page-card');
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
  // The header link points at a real page (App Embed "Wishlist page URL", default
  // /pages/wishlist). If the merchant hasn't placed the "Wishlist Page" block there,
  // inject the same markup so the page still renders. Idempotent + safe on any page.
  function autoMountPage() {
    const configured = (CFG().settings && CFG().settings.wishlistPageUrl) || '/pages/wishlist';
    const norm = (p) => {
      try { p = new URL(p, window.location.origin).pathname; } catch (e) { /* already a path */ }
      return (p.replace(/\/+$/, '') || '/').toLowerCase();
    };
    const cur = norm(window.location.pathname);
    const want = norm(configured); // always starts with "/", so endsWith stays boundary-safe
    if (cur !== want && !cur.endsWith(want)) return;

    // Block already placed on the page -> its markup is present; nothing to inject.
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
      '<div class="ws-page__grid" id="ws-page-grid"></div>' +
      '</div>';
    host.appendChild(mount);
  }

  /* ---------- Event wiring ---------- */
  function init() {
    // Drawer triggers (heart buttons with data-open-drawer)
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-drawer]');
      if (trigger) {
        e.preventDefault();
        openDrawer();
      }
    });

    // Close drawer
    const closeBtn = document.getElementById('ws-drawer-close');
    const overlay = document.getElementById('ws-drawer-overlay');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    // Render page if on wishlist page (auto-mount the markup first, so a blank
    // /pages/wishlist still renders even without the Wishlist Page block).
    autoMountPage();
    if (document.getElementById('ws-wishlist-page')) {
      renderPage();
    }

    // No eager renderDrawer() here: it used to make a full *enriched* wishlist fetch (a
    // Shopify Admin GraphQL round-trip) on every page load just to populate a closed drawer.
    // The drawer now renders lazily on open (openDrawer -> renderDrawer), and the header
    // count is kept current by wishlist-button.js's cheap enrich=0 refresh, which always runs
    // from the same App Embed. This removes one blocking GraphQL fetch from every page.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose for other scripts
  window.__wishlistStock = { openDrawer, closeDrawer, renderDrawer, renderPage, fetchWishlist };
})();
