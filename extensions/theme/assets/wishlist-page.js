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
  let configRequest = null;
  let initialized = false;

  function fetchConfig() {
    if (configRequest) return configRequest;
    const cfg = CFG();
    document.documentElement.setAttribute('data-ws-config-pending', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    configRequest = fetch(`${cfg.proxyBase}/ui-config`, { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json())
      .then(async (data) => {
        if (data && data.ok && data.config) {
          const changed = JSON.stringify(uiConfig) !== JSON.stringify(data.config);
          uiConfig = data.config;
          window.__wishlist_stock.uiConfig = uiConfig;
          window.__wishlist_stock.configSettled = true;
          const pageUrl = uiConfig.themeSettings && uiConfig.themeSettings.wishlistPageUrl;
          if (!CFG().settings?.pageSelected && !CFG().settings?.pageUrlConfigured && typeof pageUrl === 'string' && /^\/pages\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/?$/.test(pageUrl)) {
            window.__wishlist_stock.settings = window.__wishlist_stock.settings || {};
            window.__wishlist_stock.settings.wishlistPageUrl = pageUrl === '/pages/wishlist'
              ? cfg.proxyBase.replace(/\/api\/?$/, '') + '/wishlist' : pageUrl;
            const headerLink = document.getElementById('ws-header-link');
            if (headerLink) headerLink.setAttribute('href', window.__wishlist_stock.settings.wishlistPageUrl);
          }
          const launcher = {};
          for (const key of ['launchFrom', 'floatingPosition', 'pageType', 'showCount', 'icon', 'iconType', 'iconImage']) {
            const value = uiConfig.productCardConfig?.[key];
            if (value !== undefined) launcher[key] = value;
          }
          cfg.launcherConfig = launcher;
          try {
            sessionStorage.setItem('ws-launcher-config:v1', JSON.stringify({ settings: launcher, pageUrl: cfg.settings?.wishlistPageUrl }));
          } catch { /* Navigation still works when storage is disabled. */ }
          applyThemeFromConfig();
          applyPageSettings();
          if (changed) {
            document.dispatchEvent(new CustomEvent('wishlist:config-updated'));
            if (initialized) {
              autoMountPage();
              ensureSavedLaterPanel();
              await Promise.all([
                document.getElementById('ws-wishlist-page') ? renderPage() : null,
                document.getElementById('ws-drawer')?.classList.contains('is-open') ? renderDrawer() : null,
              ]);
            }
          }
        }
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timeout);
        cfg.configSettled = true;
        document.dispatchEvent(new CustomEvent('wishlist:config-ready'));
        document.documentElement.removeAttribute('data-ws-config-pending');
        configRequest = null;
      });
    return configRequest;
  }

  /* Card display options, merged over defaults. Applied to the wishlist page. */
  function applyPageSettings() {
    const c = uiConfig?.productCardConfig || {};
    document.querySelectorAll('.ws-page__notice, #ws-drawer-footer').forEach((notice) => {
      notice.hidden = Boolean(CFG().customerLoggedIn) || c.loginNudge !== true;
      notice.style.display = notice.hidden ? 'none' : '';
    });
    if (c.pageTitle) {
      document.querySelectorAll('.ws-drawer__title, .ws-page__section-head h2').forEach((heading) => {
        const text = Array.from(heading.childNodes).find((node) => node.nodeType === 3);
        if (text) text.textContent = c.pageTitle + ' ';
        else heading.prepend(document.createTextNode(c.pageTitle + ' '));
      });
    }
    const drawer = document.getElementById('ws-drawer');
    if (drawer) {
      drawer.dataset.position = CFG().settings?.drawerPosition || 'right';
      drawer.classList.toggle('ws-drawer--modal', c.pageType === 'modal');
      if (c.pageTitle) drawer.setAttribute('aria-label', c.pageTitle);
    }
  }

  function cardCfg() {
    const c = (uiConfig && uiConfig.productCardConfig) || {};
    return {
      displayTitle: c.displayTitle !== false,
      displayPrice: c.displayPrice !== false,
      displaySKU: !!c.displaySKU,
      displayImage: c.displayImage !== false,
    };
  }

  /* Theme settings from the API, applied as CSS custom properties. */
  function applyThemeFromConfig() {
    const current = (uiConfig && uiConfig.productCardConfig) || {};
    const legacyTheme = current.theme || {};
    const merged = {
      ...(uiConfig && uiConfig.themeSettings ? uiConfig.themeSettings : {}),
      ...(legacyTheme && typeof legacyTheme === 'object' ? legacyTheme : {}),
      ...(current.primaryColor ? { primaryColor: current.primaryColor } : {}),
      ...(current.secondaryColor ? { backgroundColor: current.secondaryColor } : {}),
      ...(current.textColor ? { textColor: current.textColor } : {}),
      ...(current.borderColor ? { borderColor: current.borderColor } : {}),
      ...(current.borderRadius != null ? { borderRadius: current.borderRadius } : {}),
      ...(current.buttonStyle ? { buttonStyle: current.buttonStyle } : {}),
    };

    if (!merged || typeof merged !== 'object') return;

    // Advanced embed styling is an explicit override of saved app styling.
    if (CFG().settings?.advancedSettings) return;

    const root = document.documentElement;
    if (merged.primaryColor) root.style.setProperty('--ws-primary', merged.primaryColor);
    if (merged.backgroundColor) root.style.setProperty('--ws-bg', merged.backgroundColor);
    if (merged.textColor) root.style.setProperty('--ws-text', merged.textColor);
    if (merged.mutedTextColor) root.style.setProperty('--ws-text-muted', merged.mutedTextColor);
    if (merged.borderColor) root.style.setProperty('--ws-border', merged.borderColor);
    if (merged.borderRadius != null) root.style.setProperty('--ws-radius', merged.borderRadius + 'px');
  }

  /* ---------- Guest token ---------- */
  function getGuestToken() {
    if (window.__wishlistFeatures) return window.__wishlistFeatures.guest();
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
    document.querySelectorAll('#ws-header-count, #ws-floating-count, [data-ws-menu-count]').forEach((el) => {
      el.textContent = String(v); el.dataset.count = String(v);
    });
  }

  /* ---------- Fetch wishlist ---------- */
  async function fetchWishlist({ enriched = true } = {}) {
    const cfg = CFG();
    const params = new URLSearchParams({ guest_token: getGuestToken() });
    if (enriched) params.set('enrich', '1');
    else params.set('enrich', '0');
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
          listName: window.__wishlistFeatures?.selectedList() || undefined,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        document.dispatchEvent(new CustomEvent('wishlist:item-removed'));
      }
      return data.ok;
    } catch {
      return false;
    }
  }

  function normalizeVariantId(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const fromGid = raw.includes('gid://shopify/ProductVariant/')
      ? raw.split('/').filter(Boolean).pop()
      : null;
    const digits = (fromGid || raw).match(/\d+/g);
    const candidate = digits ? digits[digits.length - 1] : null;
    if (!candidate) return null;

    const numeric = Number.parseInt(candidate, 10);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  async function resolveVariantId(variantId, productHandle) {
    const normalized = normalizeVariantId(variantId);
    if (normalized) return normalized;
    if (!productHandle) return null;

    try {
      const resp = await fetch(`/products/${encodeURIComponent(productHandle)}.js`);
      if (!resp.ok) return null;
      const product = await resp.json();
      const firstVariant = product && product.variants && product.variants[0];
      if (!firstVariant) return null;
      return normalizeVariantId(firstVariant.id);
    } catch {
      return null;
    }
  }

  async function moveToCart(variantId, productHandle) {
    const resolvedVariantId = await resolveVariantId(variantId, productHandle);
    if (!resolvedVariantId) return false;

    try {
      const resp = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        // Shopify carries line-item properties through checkout into the order
        // webhook, letting the admin report attribute this purchase to Wishlist.
        body: JSON.stringify({
          items: [{
            id: resolvedVariantId,
            quantity: 1,
            properties: { _wishlist_stock: 'true' },
          }],
        }),
      });

      const data = await resp.clone().json().catch(() => null);
      if (!resp.ok) {
        console.warn('Wishlist add-to-cart failed', data || resp.statusText);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Wishlist add-to-cart request failed', error);
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
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId || ''}" data-product-handle="${item.handle || ''}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId || ''}" data-product-id="${item.productId}">Out of Stock</button>`;
    const link = buildProductUrl(item);
    const hasLink = link !== '#';
    const imageBox = hasLink
      ? `<a class="ws-item__image" href="${link}">${image}</a>`
      : `<div class="ws-item__image">${image}</div>`;

    return `
      <div class="ws-item" data-product-id="${item.productId}" data-variant-id="${item.variantId || ''}">
        <button class="ws-item__remove" data-action="remove" aria-label="Remove from wishlist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m-8 0v13.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5V6m-8 0h8"/></svg>
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
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId || ''}" data-product-handle="${item.handle || ''}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId || ''}" data-product-id="${item.productId}">Out of Stock</button>`;
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
    const allItems = await fetchWishlist({ enriched: true });
    const body = document.getElementById('ws-drawer-items');
    const empty = document.getElementById('ws-drawer-empty');
    const count = document.getElementById('ws-drawer-count');
    if (!body) return;
    await window.__wishlistFeatures?.toolbar(document.getElementById('ws-drawer-body'));
    const items = window.__wishlistFeatures?.filter(allItems) || allItems;

    if (items.length === 0) {
      body.innerHTML = '';
      if (empty) empty.style.display = '';
      if (count) count.textContent = '';
      setHeaderCount(allItems.length);
      return;
    }

    if (empty) empty.style.display = 'none';
    body.innerHTML = items.map(drawerItemHTML).join('');
    if (count) count.textContent = `(${items.length})`;
    setHeaderCount(allItems.length);

    bindDrawerActions(body, items);

    const enriched = await enrichItems(items);
    if (enriched.length !== items.length) {
      body.innerHTML = enriched.map(drawerItemHTML).join('');
      bindDrawerActions(body, enriched);
    } else {
      for (let i = 0; i < enriched.length; i += 1) {
        const card = body.querySelectorAll('.ws-item')[i];
        if (!card || !enriched[i]) continue;

        const nextHtml = drawerItemHTML(enriched[i]);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = nextHtml;
        const replacement = wrapper.firstElementChild;
        if (replacement) card.replaceWith(replacement);
      }
      // Replacing cards removes the listeners bound to their old elements.
      bindDrawerActions(body, enriched);
    }
  }

  function bindDrawerActions(container, items) {
    window.__wishlistFeatures?.decorate(container);
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
        const ok = await moveToCart(btn.dataset.variantId, btn.dataset.productHandle);
        if (ok) {
          btn.textContent = 'Added!';
          if (window.location.pathname !== '/cart') {
            window.location.assign('/cart');
          }
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
  function trackPageView() {
    if (window.Shopify && window.Shopify.designMode) return;
    if (window.__wsWishlistPageViewTracked) return;
    window.__wsWishlistPageViewTracked = true;
    fetch(`${CFG().proxyBase}/wishlist-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'page_view' }),
      keepalive: true,
    }).catch(() => { /* Analytics must not interrupt the wishlist. */ });
  }

  let pageRenderVersion = 0;

  async function renderPage() {
    const page = document.getElementById('ws-wishlist-page');
    const grid = document.getElementById('ws-page-grid');
    const empty = document.getElementById('ws-page-empty');
    const count = document.getElementById('ws-page-count');
    if (!page || !grid) return;
    const version = ++pageRenderVersion;
    trackPageView();
    try {
      // Prepare controls and products together; reveal the complete layout once.
      const [allItems] = await Promise.all([
        fetchWishlist({ enriched: true }),
        window.__wishlistFeatures?.toolbar(page),
      ]);
      if (version !== pageRenderVersion) return;
      const items = await enrichItems(window.__wishlistFeatures?.filter(allItems) || allItems);
      if (version !== pageRenderVersion) return;
      grid.innerHTML = items.map(pageCardHTML).join('');
      if (empty) empty.style.display = items.length ? 'none' : '';
      if (count) count.textContent = items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : '';
      setHeaderCount(allItems.length);
      bindPageActions(grid, items);
    } catch {
      if (version !== pageRenderVersion) return;
      if (empty) empty.style.display = 'none';
      grid.innerHTML = '<p role="alert">Your wishlist could not be loaded. Please try again.</p>';
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'ws-btn'; retry.textContent = 'Try again';
      retry.addEventListener('click', renderPage); grid.append(retry);
    } finally {
      if (version === pageRenderVersion) {
        page.setAttribute('data-ws-page-ready', 'true');
        page.setAttribute('aria-busy', 'false');
      }
    }
  }

  function bindPageActions(container, items) {
    window.__wishlistFeatures?.decorate(container);
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const card = btn.closest('.ws-page-card');
        if (!card) return;
        btn.disabled = true;
        const ok = await removeItem(card.dataset.productId);
        if (ok) {
          // Removal is product-level, so remove every visible variant as well.
          // Do not leave an invisible card occupying space while refetching.
          container.querySelectorAll('.ws-page-card').forEach((item) => {
            if (item.dataset.productId === card.dataset.productId) item.remove();
          });
          const remaining = container.querySelectorAll('.ws-page-card').length;
          const count = document.getElementById('ws-page-count');
          const empty = document.getElementById('ws-page-empty');
          if (count) count.textContent = remaining ? `${remaining} item${remaining === 1 ? '' : 's'}` : '';
          if (empty) empty.style.display = remaining ? 'none' : '';
          renderPage();
        } else {
          btn.disabled = false;
          window.__wishlistFeatures?.notice('Could not remove this product. Please try again.');
        }
      });
    });

    container.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.innerHTML = '<span class="ws-spinner"></span>';
        const ok = await moveToCart(btn.dataset.variantId, btn.dataset.productHandle);
        if (ok) {
          btn.textContent = 'Added!';
          if (window.location.pathname !== '/cart') {
            window.location.assign('/cart');
          }
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
    const toggle = document.getElementById('ws-drawer-toggle');
    if (overlay) overlay.classList.add('is-open');
    if (drawer) { drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); }
    if (toggle) {
      toggle.classList.add('is-open');
      toggle.setAttribute('aria-label', 'Close wishlist');
    }
    renderDrawer();
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    const overlay = document.getElementById('ws-drawer-overlay');
    const drawer = document.getElementById('ws-drawer');
    const toggle = document.getElementById('ws-drawer-toggle');
    if (overlay) overlay.classList.remove('is-open');
    if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
    if (toggle) {
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-label', 'Open wishlist');
    }
    document.body.style.overflow = '';
  }

  function savedLaterPanelMarkup() {
    return '<div class="ws-page__panel" data-panel="saved-later">' +
      '<div class="ws-saved-heading"><h2>Saved for Later</h2><span id="ws-saved-later-count"></span></div>' +
      '<p class="ws-saved-browser-note">Saved in this browser. Move an item back to your cart whenever you’re ready.</p>' +
      '<div id="ws-saved-later-items" class="ws-saved-grid"></div>' +
      '<div id="ws-saved-later-empty" class="ws-save-later"><h3>No items saved for later yet</h3>' +
      '<p>Save items when removing them from your cart, or use the Save for later link when available.</p></div></div>';
  }

  function ensureSavedLaterPanel() {
    const page = document.getElementById('ws-wishlist-page');
    if (!page) return;
    if (!page.querySelector('.ws-page__tabs')) {
      const panel = document.createElement('div');
      panel.className = 'ws-page__panel is-active';
      panel.dataset.panel = 'wishlist';
      panel.append(...Array.from(page.childNodes));
      page.appendChild(panel);
      const tabs = document.createElement('div');
      tabs.className = 'ws-page__tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Wishlist views');
      tabs.innerHTML = '<button class="ws-page__tab is-active" type="button" role="tab" aria-selected="true" data-tab="wishlist">Wishlist</button><button class="ws-page__tab" type="button" role="tab" aria-selected="false" data-tab="saved-later">Saved for later</button>';
      page.prepend(tabs);
    }
    if (!page.querySelector('[data-panel="saved-later"]')) page.insertAdjacentHTML('beforeend', savedLaterPanelMarkup());
    bindPageTabs();
    if (new URLSearchParams(location.search).get('view') === 'saved-later') showPageTab('saved-later');
    document.dispatchEvent(new CustomEvent('wishlist:page-ready'));
  }

  /* ---------- Auto-mount page markup on the wishlist page ---------- */
  function showPageTab(tabName) {
    const page = document.getElementById('ws-wishlist-page');
    if (!page) return;
    page.querySelectorAll('.ws-page__tab').forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    page.querySelectorAll('.ws-page__panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.panel === tabName);
    });
  }

  function bindPageTabs() {
    const page = document.getElementById('ws-wishlist-page');
    if (!page) return;
    page.querySelectorAll('.ws-page__tab').forEach((tab) => {
      tab.onclick = () => showPageTab(tab.dataset.tab);
    });
    page.querySelectorAll('[data-go-cart]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.location.assign('/cart');
      });
    });
    page.querySelectorAll('[data-login]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.location.assign('/account/login');
      });
    });
  }

  function autoMountPage() {
    const configured = (CFG().settings && CFG().settings.wishlistPageUrl) || '/pages/wishlist';
    const norm = (p) => {
      try { p = new URL(p, window.location.origin).pathname; } catch (e) { /* already a path */ }
      return (p.replace(/\/+$/, '') || '/').toLowerCase();
    };
    const cur = norm(window.location.pathname);
    const want = norm(configured);
    const proxyMount = document.getElementById('ws-wishlist-page-root');
    const legacyWishlist = cur.endsWith('/pages/wishlist');
    const matchesWishlist = cur === want || cur.endsWith(want);
    if (CFG().settings.isNotFoundPage && (matchesWishlist || legacyWishlist)) {
      const fallback = new URL(CFG().proxyBase.replace(/\/api\/?$/, '') + '/wishlist', window.location.origin);
      // Keep the requested tab when a missing custom page falls back to the app page.
      if (new URLSearchParams(window.location.search).get('view') === 'saved-later') {
        fallback.searchParams.set('view', 'saved-later');
      }
      window.location.replace(fallback.href);
      return;
    }
    if (!proxyMount && !matchesWishlist) return;

    if (document.getElementById('ws-wishlist-page')) return;

    const host =
      proxyMount || document.getElementById('MainContent') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.body;
    if (!host) return;

    const mount = document.createElement('div');
    mount.className = 'ws-page-mount';
    mount.innerHTML = [
      '<div class="ws-page" id="ws-wishlist-page">',
      '  <div class="ws-page__tabs" role="tablist" aria-label="Wishlist views">',
      '    <button class="ws-page__tab is-active" type="button" role="tab" aria-selected="true" data-tab="wishlist">Wishlist</button>',
      '    <button class="ws-page__tab" type="button" role="tab" aria-selected="false" data-tab="saved-later">Saved for later</button>',
      '  </div>',
      '  <div class="ws-page__panel is-active" data-panel="wishlist">',
      '    <div class="ws-page__notice">',
      '      <div class="ws-page__notice-copy">',
      '        <strong>Your collections are to stay here forever!</strong>',
      '        <span>Login to save your stuff for good and access them whenever, wherever!</span>',
      '      </div>',
      '      <button class="ws-btn ws-btn--primary ws-btn--small" type="button" data-login>Login to Save →</button>',
      '    </div>',
      '    <div class="ws-page__section">',
      '      <div class="ws-page__section-head">',
      '        <h2>My Wishlist</h2>',
      '        <span id="ws-page-count"></span>',
      '      </div>',
      '      <div class="ws-page__empty" id="ws-page-empty" style="display:none;">',
      '        <svg class="ws-page__empty-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>',
      '        <h2>Your wishlist is empty</h2>',
      '        <p>Browse our products and save items you love.</p>',
      `        <a href="${CFG().settings.allProductsCollectionUrl || '/collections/all'}" class="ws-btn ws-btn--primary">Browse Products</a>`,
      '      </div>',
      '      <div class="ws-page__grid ws-page__grid--rows" id="ws-page-grid"></div>',
      '    </div>',
      '  </div>',
      savedLaterPanelMarkup(),
      '</div>'
    ].join('');
    if (CFG().customerLoggedIn) mount.querySelector('.ws-page__notice')?.remove();
    host.appendChild(mount);
  }

  function autoMountDrawerFooter() {
    if (CFG().customerLoggedIn) {
      document.getElementById('ws-drawer-footer')?.remove();
      return;
    }
    if (document.getElementById('ws-drawer-footer')) return;
    const drawer = document.getElementById('ws-drawer');
    if (!drawer) return;

    const footer = document.createElement('div');
    footer.id = 'ws-drawer-footer';
    footer.className = 'ws-drawer__footer';
    footer.innerHTML =
      '<h3 class="ws-drawer__footer-title">Your collections are to stay here forever!</h3>' +
      '<p class="ws-drawer__footer-text">Login to save your stuff for good and access them whenever, wherever.</p>' +
      '<a class="ws-drawer__footer-link" href="/account/login">Login</a>';
    drawer.appendChild(footer);
  }

  /* ---------- Event wiring ---------- */
  function init() {
    initialized = true;
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-drawer]');
      if (trigger) {
        e.preventDefault();
        const drawer = document.getElementById('ws-drawer');
        const shouldClose = drawer && drawer.classList.contains('is-open');
        if (shouldClose) {
          closeDrawer();
        } else {
          openDrawer();
        }
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
    ensureSavedLaterPanel();
    applyPageSettings();
    autoMountDrawerFooter();
    applyPageSettings();
    if (document.getElementById('ws-wishlist-page')) {
      renderPage();
    }
    document.dispatchEvent(new CustomEvent('wishlist:ready'));
  }

  function boot() {
    window.addEventListener('focus', fetchConfig);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fetchConfig();
    });
    const start = () => {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();
    };

    // Start the request immediately; start() waits for the DOM if needed.
    fetchConfig().then(start);
    window.addEventListener('pageshow', (event) => { if (event.persisted) fetchConfig(); });
  }

  boot();

  // Expose for other scripts
  window.__wishlistStock = { openDrawer, closeDrawer, renderDrawer, renderPage, fetchWishlist };
})();
