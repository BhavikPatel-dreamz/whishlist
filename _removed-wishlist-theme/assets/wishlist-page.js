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

  /* ---------- Fetch enriched wishlist ---------- */
  async function fetchWishlist() {
    const cfg = CFG();
    const params = new URLSearchParams({ guest_token: getGuestToken() });
    try {
      const resp = await fetch(`${cfg.proxyBase}/wishlist?${params}`);
      const data = await resp.json();
      if (!data.ok) return [];
      return data.items || [];
    } catch {
      return [];
    }
  }

  /* ---------- Remove from wishlist ---------- */
  async function removeItem(productId, variantId) {
    const cfg = CFG();
    try {
      const resp = await fetch(`${cfg.proxyBase}/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _method: 'DELETE',
          productId,
          variantId,
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
  function drawerItemHTML(item) {
    const image = item.image
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" />`
      : '';
    const variant = item.variantTitle ? `<p class="ws-item__variant">${item.variantTitle}</p>` : '';
    const price = item.price ? `<p class="ws-item__price">${item.price}</p>` : '';
    const cartBtn = item.available
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId}">Out of Stock</button>`;
    const link = item.url || `/products/${item.handle || ''}`;

    return `
      <div class="ws-item" data-product-id="${item.productId}" data-variant-id="${item.variantId || ''}">
        <button class="ws-item__remove" data-action="remove" aria-label="Remove from wishlist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="ws-item__image">${image}</div>
        <div class="ws-item__info">
          <p class="ws-item__title"><a href="${link}">${item.title || 'Product'}</a></p>
          ${variant}
          ${price}
          <div class="ws-item__actions">${cartBtn}</div>
        </div>
      </div>`;
  }

  function pageCardHTML(item) {
    const image = item.image
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" />`
      : '';
    const price = item.price ? `<p class="ws-page-card__price">${item.price}</p>` : '';
    const cartBtn = item.available
      ? `<button class="ws-btn ws-btn--primary ws-btn--small" data-action="add-to-cart" data-variant-id="${item.variantId}">Add to Cart</button>`
      : `<button class="ws-btn ws-btn--small" data-action="notify" data-variant-id="${item.variantId}">Out of Stock</button>`;
    const link = item.url || `/products/${item.handle || ''}`;

    return `
      <div class="ws-page-card" data-product-id="${item.productId}" data-variant-id="${item.variantId || ''}">
        <button class="ws-page-card__remove" data-action="remove" aria-label="Remove from wishlist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="ws-page-card__image">${image}</div>
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
    const headerCount = document.getElementById('ws-header-count');
    if (!body) return;

    if (items.length === 0) {
      body.innerHTML = '';
      if (empty) empty.style.display = '';
      if (count) count.textContent = '';
      if (headerCount) { headerCount.textContent = '0'; headerCount.dataset.count = '0'; }
      return;
    }

    if (empty) empty.style.display = 'none';
    body.innerHTML = items.map(drawerItemHTML).join('');
    if (count) count.textContent = `(${items.length})`;
    if (headerCount) { headerCount.textContent = String(items.length); headerCount.dataset.count = String(items.length); }

    bindDrawerActions(body, items);
  }

  function bindDrawerActions(container, items) {
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.ws-item');
        const pid = card.dataset.productId;
        const vid = card.dataset.variantId;
        const ok = await removeItem(pid, vid);
        if (ok) renderDrawer();
      });
    });

    container.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = '<span class="ws-spinner"></span>';
        const ok = await moveToCart(btn.dataset.variantId);
        if (ok) {
          btn.textContent = 'Added!';
          setTimeout(() => renderDrawer(), 800);
          // Refresh cart if Shopify section rendering is available
          if (typeof fetch === 'function') {
            fetch('/cart.js').then(r => r.json()).then(c => {
              document.dispatchEvent(new CustomEvent('cart:change', { detail: { cart: c } }));
            }).catch(() => {});
          }
        } else {
          btn.textContent = 'Error';
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-action="notify"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Close drawer, trigger back-in-stock modal on the current page
        closeDrawer();
        const variantId = btn.dataset.variantId;
        const bis = document.querySelector(`.back-in-stock[data-variant-id="${variantId}"]`);
        if (bis) {
          const notifyBtn = bis.querySelector('.notify-me');
          if (notifyBtn) notifyBtn.click();
        }
      });
    });
  }

  /* ---------- Render Page ---------- */
  async function renderPage() {
    const grid = document.getElementById('ws-page-grid');
    const empty = document.getElementById('ws-page-empty');
    const count = document.getElementById('ws-page-count');
    const headerCount = document.getElementById('ws-header-count');
    if (!grid) return;

    const items = await fetchWishlist();

    if (items.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = '';
      if (count) count.textContent = '';
      if (headerCount) { headerCount.textContent = '0'; headerCount.dataset.count = '0'; }
      return;
    }

    if (empty) empty.style.display = 'none';
    grid.innerHTML = items.map(pageCardHTML).join('');
    if (count) count.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (headerCount) { headerCount.textContent = String(items.length); headerCount.dataset.count = String(items.length); }

    bindPageActions(grid, items);
  }

  function bindPageActions(container, items) {
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.ws-page-card');
        const pid = card.dataset.productId;
        const vid = card.dataset.variantId;
        const ok = await removeItem(pid, vid);
        if (ok) {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.9)';
          setTimeout(() => renderPage(), 250);
        }
      });
    });

    container.querySelectorAll('[data-action="add-to-cart"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = '<span class="ws-spinner"></span>';
        const ok = await moveToCart(btn.dataset.variantId);
        if (ok) {
          btn.textContent = 'Added!';
          if (typeof fetch === 'function') {
            fetch('/cart.js').then(r => r.json()).then(c => {
              document.dispatchEvent(new CustomEvent('cart:change', { detail: { cart: c } }));
            }).catch(() => {});
          }
        } else {
          btn.textContent = 'Error';
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-action="notify"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variantId = btn.dataset.variantId;
        const bis = document.querySelector(`.back-in-stock[data-variant-id="${variantId}"]`);
        if (bis) {
          const notifyBtn = bis.querySelector('.notify-me');
          if (notifyBtn) notifyBtn.click();
        }
      });
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

    // Render page if on wishlist page
    if (document.getElementById('ws-wishlist-page')) {
      renderPage();
    }

    // Initial header count
    renderDrawer().then(() => {
      // drawer rendering also updates header count
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose for other scripts
  window.__wishlistStock = { openDrawer, closeDrawer, renderDrawer, renderPage, fetchWishlist };
})();
