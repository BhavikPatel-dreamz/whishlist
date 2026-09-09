/**
 * Back-in-Stock – notify button + modal form behaviour.
 *
 * Responsibilities (all driven by the Back-in-Stock App Embed):
 *   1. Render the global subscribe modal ("Notify me when available").
 *   2. Inject a "Notify me" button onto an out-of-stock product page when the
 *      app block isn't manually placed (and keep it in sync on variant change).
 *   3. Listen for `ws:open-bis` custom events so the separate Wishlist extension
 *      can open the same modal for an out-of-stock saved item.
 *
 * The Shopify app-embed toggle is the activation gate. UIConfig must not be a
 * second gate because Shopify does not send theme-editor toggle changes through
 * the app proxy.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', bisSettings: {}, customerEmail: '' };

  const SETTINGS = () => {
    const s = CFG().bisSettings || {};
    return {
      notifyButtonText: s.notifyButtonText || 'Notify me when available',
      notifyModalTitle: s.notifyModalTitle || 'Get notified when this is back',
      productButton: s.productButton !== false,
      iconType: s.iconType || 'bell',
      iconImage: s.iconImage || '',
    };
  };

  function notifyIconMarkup() {
    const s = SETTINGS();
    if (s.iconType === 'none') return '';
    if (s.iconType === 'image' && s.iconImage) {
      return `<img src="${s.iconImage}" alt="" width="16" height="16" />`;
    }
    const icon = s.iconType === 'clock'
      ? '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>'
      : '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>';
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  }

  /* ---------- Guest token (shared with wishlist) ---------- */
  function getGuestToken() {
    let t = localStorage.getItem('wishlist_guest_token');
    if (!t) {
      t = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      localStorage.setItem('wishlist_guest_token', t);
    }
    return t;
  }

  /* ---------- Inline message inside the form body ---------- */
  function showMsg(text) {
    const msg = document.getElementById('ws-bis-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.style.display = text ? '' : 'none';
  }
  function clearMsg() { showMsg(''); }

  /* ---------- Form / success view toggle ---------- */
  function showForm() {
    const formBody = document.getElementById('ws-bis-form-body');
    const actions = document.getElementById('ws-bis-actions');
    const success = document.getElementById('ws-bis-success');
    if (formBody) formBody.style.display = '';
    if (actions) actions.style.display = '';
    if (success) success.style.display = 'none';
  }
  function showSuccess(title, message, opts) {
    const formBody = document.getElementById('ws-bis-form-body');
    const actions = document.getElementById('ws-bis-actions');
    const success = document.getElementById('ws-bis-success');
    const titleEl = document.getElementById('ws-bis-success-title');
    const msgEl = document.getElementById('ws-bis-success-msg');
    const unsub = document.getElementById('ws-bis-unsub');
    if (formBody) formBody.style.display = 'none';
    if (actions) actions.style.display = 'none';
    if (success) success.style.display = '';
    if (titleEl && title) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message || '';
    if (unsub) unsub.style.display = opts && opts.canUnsubscribe ? '' : 'none';
  }

  function currentEmail(modal) {
    const cfg = CFG();
    const input = modal && modal.querySelector('input[name="email"]');
    return (input && input.value.trim()) || cfg.customerEmail || '';
  }

  async function openModal(container) {
    const vid = container.dataset.variantId;
    const modal = document.getElementById('ws-bis-modal');
    if (!modal) return;

    const vidInput = modal.querySelector('input[name="variantId"]');
    if (vidInput) vidInput.value = vid;
    const pidInput = modal.querySelector('input[name="productId"]');
    if (pidInput && container.dataset.productId) pidInput.value = container.dataset.productId;

    showForm();
    clearMsg();
    const form = document.getElementById('ws-bis-form');
    if (form) form.reset();

    const cfg = CFG();
    const emailInput = modal.querySelector('input[name="email"]');
    if (emailInput && cfg.customerEmail) emailInput.value = cfg.customerEmail;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const el = modal.querySelector('input[name="email"]');
      if (el) el.focus();
    }, 200);

    const email = cfg.customerEmail;
    if (email && vid) {
      try {
        const params = new URLSearchParams({ variantId: vid, email });
        const resp = await fetch(`${cfg.proxyBase}/stock-alert?${params}`);
        const data = await resp.json();
        if (modal.classList.contains('is-open') && vidInput && vidInput.value === String(vid)) {
          if (data.ok && data.subscribed) {
            showSuccess(
              "You're already on the list",
              "We'll email you the moment this is back in stock.",
              { canUnsubscribe: true },
            );
          }
        }
      } catch {
        /* non-fatal: fall back to the form */
      }
    }
  }

  function closeModal() {
    const modal = document.getElementById('ws-bis-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  async function submitForm() {
    const cfg = CFG();
    const form = document.getElementById('ws-bis-form');
    if (!form) return;
    clearMsg();

    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    body.guestToken = getGuestToken();

    const submitBtn = document.getElementById('ws-bis-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="ws-spinner"></span> Submitting...';
    }

    try {
      const resp = await fetch(`${cfg.proxyBase}/stock-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (data.ok) {
        showSuccess(
          "You're on the list!",
          data.message || "We'll email you when this is back in stock.",
          { canUnsubscribe: Boolean(body.email) },
        );
      } else if (data.code === 'already_available') {
        showMsg(data.message || "Good news — it's in stock right now.");
      } else {
        showMsg(data.message || 'Unable to sign you up. Please try again.');
      }
    } catch (err) {
      console.error('Stock alert error', err);
      showMsg('Something went wrong. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Notify Me';
      }
    }
  }

  async function unsubscribe() {
    const cfg = CFG();
    const modal = document.getElementById('ws-bis-modal');
    if (!modal) return;
    const vid = (modal.querySelector('input[name="variantId"]') || {}).value;
    const email = currentEmail(modal);
    if (!vid || !email) { showForm(); return; }

    const unsubBtn = document.getElementById('ws-bis-unsub');
    if (unsubBtn) { unsubBtn.disabled = true; unsubBtn.innerHTML = '<span class="ws-spinner"></span>'; }

    try {
      await fetch(`${cfg.proxyBase}/stock-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _method: 'delete', variantId: vid, email, guestToken: getGuestToken() }),
      });
    } catch (err) {
      console.error('Unsubscribe error', err);
    } finally {
      if (unsubBtn) { unsubBtn.disabled = false; unsubBtn.textContent = 'Unsubscribe'; }
    }
    showForm();
    clearMsg();
    showMsg("You've been removed from this alert.");
  }

  /* ---------- PDP injection (notify only, when block isn't placed) ---------- */
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

  function variantUnavailable(product, vid, form) {
    if (product && Array.isArray(product.variants) && vid) {
      const v = product.variants.find((x) => String(x.id) === String(vid));
      if (v) return !v.available;
    }
    const addBtn = form && form.querySelector('[name="add"], .product-form__submit, button[type="submit"]');
    if (addBtn && addBtn.disabled) return true;
    return false;
  }

  function notifyMarkup(vid, pid) {
    const label = SETTINGS().notifyButtonText;
    return (
      `<div class="back-in-stock" data-variant-id="${vid}" data-product-id="${pid}">` +
      '<button class="notify-me" type="button">' +
      notifyIconMarkup() +
      `${label}</button></div>`
    );
  }

  function updatePdpVariant(product, form, wrap) {
    const vid = currentVariantId(form);
    const pid = (product && String(product.id)) || '';
    const bis = wrap.querySelector('.back-in-stock');
    if (!variantUnavailable(product, vid, form)) {
      if (bis) bis.remove();
    } else if (!bis) {
      wrap.insertAdjacentHTML('beforeend', notifyMarkup(vid, pid));
    } else {
      bis.dataset.variantId = vid;
      bis.dataset.productId = pid;
    }
  }

  let pdpDone = false;
  async function injectProductPage() {
    if (pdpDone || !SETTINGS().productButton) return;
    const handle = pdpHandle();
    if (!handle) return;
    if (document.querySelector('.back-in-stock')) { pdpDone = true; return; }
    const form = mainProductForm();
    if (!form) return;
    pdpDone = true;

    let product = null;
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (resp.ok) product = await resp.json();
    } catch { /* non-fatal */ }

    const vid =
      currentVariantId(form) ||
      (product && product.variants && product.variants[0] ? String(product.variants[0].id) : '');
    const pid = product ? String(product.id) : '';

    if (!variantUnavailable(product, vid, form)) return;

    const wrap = document.createElement('div');
    wrap.className = 'ws-pdp';
    wrap.id = 'ws-bis-pdp';
    wrap.insertAdjacentHTML('beforeend', notifyMarkup(vid, pid));

    const anchor = (form.closest('product-form') || form);
    anchor.insertAdjacentElement('afterend', wrap);

    if (!form.__wsBisBound) {
      form.__wsBisBound = true;
      form.addEventListener('change', () => {
        setTimeout(() => updatePdpVariant(product, form, wrap), 60);
      });
    }
  }

  /* ---------- Initialize (gated on the per-store config) ---------- */
  function init() {
    if (document.querySelector('.back-in-stock') || SETTINGS().productButton) {
      document.addEventListener('click', (e) => {
        const button = e.target.closest && e.target.closest('.notify-me');
        if (!button) return;
        const container = button.closest('.back-in-stock');
        if (!container) return;
        e.preventDefault();
        openModal(container);
      });
    }

    const closeBtn = document.getElementById('ws-bis-close');
    const cancelBtn = document.getElementById('ws-bis-cancel');
    const modal = document.getElementById('ws-bis-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    const submitBtn = document.getElementById('ws-bis-submit');
    if (submitBtn) submitBtn.addEventListener('click', submitForm);

    const unsubBtn = document.getElementById('ws-bis-unsub');
    if (unsubBtn) unsubBtn.addEventListener('click', unsubscribe);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    const emailInput = document.getElementById('ws-bis-email');
    if (emailInput) {
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitForm();
        }
      });
    }

    // Cooperative hook: the separate Wishlist extension fires this for out-of-stock
    // saved items so the same modal opens here.
    document.addEventListener('ws:open-bis', (e) => {
      const detail = (e.detail || {});
      if (!detail.variantId) return;
      const container =
        document.querySelector(`.back-in-stock[data-variant-id="${detail.variantId}"]`) ||
        wrapVariantContainer(detail.variantId, detail.productId);
      if (container) openModal(container);
    });

    function wrapVariantContainer(variantId, productId) {
      const host = document.body;
      const tmp = document.createElement('div');
      tmp.className = 'back-in-stock';
      tmp.dataset.variantId = variantId;
      tmp.dataset.productId = productId || '';
      tmp.style.display = 'none';
      host.appendChild(tmp);
      return tmp;
    }

    // Product-page auto-injection of the notify button on out-of-stock variants.
    document.addEventListener('DOMContentLoaded', injectProductPage);
    if (document.readyState !== 'loading') injectProductPage();
    document.addEventListener('shopify:section:load', injectProductPage);
  }

  function boot() {
    const start = () => {
      init();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  boot();
})();
