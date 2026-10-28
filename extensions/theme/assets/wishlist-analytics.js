/**
 * Wishlist + Back-in-Stock Analytics Tracking
 *
 * Sends storefront events to the app proxy tracking endpoint so merchants can
 * see analytics in the Shopify admin. All events are best-effort: a failed
 * tracking request never breaks the shopper's experience.
 *
 * Events sent (ANALYTICS_REPORTS_SPEC.md section 5):
 *   PRODUCT_VIEW   - Product page load
 *   WISHLIST_SAVE  - Heart icon toggle (save)
 *   WISHLIST_REMOVE - Heart icon toggle (remove)
 *   WISHLIST_ADD_TO_CART - Add to cart from wishlist page
 *   WISHLIST_SHARE  - Share action
 *   WISHLIST_SHARE_VISIT - Open of a shared link
 *   ALERT_SUBSCRIBE - Back-in-stock form submit
 *   ALERT_SUBSCRIBE_CLICK - Back-in-stock Email Me submit
 */

(function () {
  const CFG = () => window.__wishlist_stock || {
    proxyBase: '/apps/wishlist-stock/api',
    shopDomain: '',
    customerId: '',
    guestToken: '',
  };

  // Shopper identity: customer id when logged in, else a first-party device id.
  function getShopperId() {
    const cfg = CFG();
    if (cfg.customerId) return String(cfg.customerId);
    const cookieToken = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('ws_shopper_id='))
      ?.slice('ws_shopper_id='.length);
    let token = cookieToken ? decodeURIComponent(cookieToken) : null;
    if (!token) token = sessionStorage.getItem('ws_shopper_id');
    if (!token) {
      token = crypto.randomUUID();
    }
    try { sessionStorage.setItem('ws_shopper_id', token); } catch { /* ignore */ }
    try {
      document.cookie = `ws_shopper_id=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    } catch { /* ignore */ }
    return token;
  }

  function getCustomerId() {
    const cfg = CFG();
    return cfg.customerId || null;
  }

  function getDevice() {
    const ua = navigator.userAgent || '';
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|opera|mini|windows ce|palm|mobi/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  async function track(event, opts = {}) {
    const cfg = CFG();
    const body = {
      event,
      shopperId: getShopperId(),
      customerId: getCustomerId(),
      productId: opts.productId ?? null,
      variantId: opts.variantId ?? null,
      channel: opts.channel ?? null,
      source: opts.source ?? null,
      device: getDevice(),
      meta: opts.meta ?? null,
    };
    try {
      await fetch(`${cfg.proxyBase}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        keepalive: true,
      });
    } catch {
      // Best-effort: never block the shopper.
    }
  }

  // Expose globally so other theme assets can call it.
  window.wsTrack = track;

  // Auto-track product page views.
  function trackProductView() {
    const cfg = CFG();
    const shopifyProductId = window.ShopifyAnalytics?.meta?.product?.id;
    const shopifyVariantId = window.ShopifyAnalytics?.meta?.selectedVariantId;
    let productId = cfg.productId || shopifyProductId || null;
    let variantId = cfg.variantId || shopifyVariantId || null;
    const el = document.querySelector('[data-ws-product-id]');
    if (el) productId = el.dataset.wsProductId || productId;
    const vEl = document.querySelector('[data-ws-variant-id]');
    if (vEl) variantId = vEl.dataset.wsVariantId || variantId;
    if (productId) {
      track('PRODUCT_VIEW', {
        productId: String(productId).split('/').pop(),
        variantId: variantId ? String(variantId).split('/').pop() : null,
        source: 'pdp',
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackProductView);
  } else {
    trackProductView();
  }
})();
