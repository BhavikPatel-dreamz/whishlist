/**
 * Wishlist heart button – toggle + drawer trigger.
 * Relies on window.__wishlist_stock.proxyBase set by the App Embed Block.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', settings: {} };

  function getGuestToken() {
    let t = localStorage.getItem('wishlist_guest_token');
    if (!t) {
      t = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      localStorage.setItem('wishlist_guest_token', t);
    }
    return t;
  }

  async function checkStatus(btn) {
    const cfg = CFG();
    const productId = btn.dataset.productId;
    if (!productId) return;
    try {
      const params = new URLSearchParams({ guest_token: getGuestToken() });
      const resp = await fetch(`${cfg.proxyBase}/wishlist?${params}`);
      const data = await resp.json();
      if (data.ok && Array.isArray(data.items)) {
        const inList = data.items.some((i) => String(i.productId) === String(productId));
        btn.setAttribute('aria-pressed', inList ? 'true' : 'false');
        btn.classList.toggle('is-in-wishlist', inList);
      }
    } catch { /* silent */ }
  }

  async function toggleWishlist(btn) {
    const cfg = CFG();
    const productId = btn.dataset.productId;
    const variantId = btn.dataset.variantId;
    if (!productId) return;

    const payload = { productId, variantId, guestToken: getGuestToken() };

    try {
      const resp = await fetch(`${cfg.proxyBase}/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.ok) {
        btn.setAttribute('aria-pressed', data.inWishlist ? 'true' : 'false');
        btn.classList.toggle('is-in-wishlist', data.inWishlist);
        // Update header count
        const headerCount = document.getElementById('ws-header-count');
        if (headerCount && data.count !== undefined) {
          headerCount.textContent = String(data.count);
          headerCount.dataset.count = String(data.count);
        }
        // Notify drawer to re-render if open
        if (window.__wishlistStock && data.inWishlist) {
          window.__wishlistStock.renderDrawer();
        }
      }
    } catch (err) {
      console.error('Wishlist error', err);
    }
  }

  function init() {
    document.querySelectorAll('.wishlist-heart').forEach((btn) => {
      if (btn.__wishlistBound) return;
      btn.__wishlistBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        // If drawer trigger, open drawer instead of toggling
        if (btn.dataset.openDrawer) {
          if (window.__wishlistStock) window.__wishlistStock.openDrawer();
          return;
        }
        toggleWishlist(btn);
      });
      // Check initial status
      checkStatus(btn);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
