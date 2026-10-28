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
    const saved = CFG().uiConfig?.productCardConfig?.backInStockSettings || {};
    const advanced = s.advancedSettings === true;
    const buttonColor = advanced
      ? s.buttonColor || '#080707'
      : /^#[0-9a-f]{6}$/i.test(saved.buttonColor || '')
        ? saved.buttonColor
        : s.buttonColor || '#e74c3c';
    return {
      launchType: (advanced ? s.launchType : saved.launchType) === 'inline' ? 'inline' : 'modal',
      placement: ['right', 'left'].includes(advanced ? s.placement : saved.placement) ? (advanced ? s.placement : saved.placement) : 'next',
      buttonType: (advanced ? s.buttonType : saved.buttonType) || 'iconText',
      notifyButtonText: (advanced ? s.notifyButtonText : saved.buttonText) || s.notifyButtonText || 'Notify me when available',
      notifyModalTitle: (advanced ? s.notifyModalTitle : saved.formHeading) || s.notifyModalTitle || 'Get notified when this is back',
      textSize: Number.isFinite(Number(advanced ? s.buttonSize : saved.textSize)) ? Math.min(40, Math.max(8, Number(advanced ? s.buttonSize : saved.textSize))) : Number(s.buttonSize) || 14,
      radius: Number.isFinite(Number(advanced ? s.borderRadius : saved.radius)) ? Math.min(50, Math.max(0, Number(advanced ? s.borderRadius : saved.radius))) : Number(s.borderRadius) || 8,
      buttonColor,
      buttonBackground: advanced
        ? (s.buttonStyle === 'outlined' ? 'transparent' : buttonColor)
        : Object.keys(saved).length
          ? buttonColor
          : s.buttonStyle === 'filled' ? s.buttonColor : 'transparent',
      textColor: advanced && /^#[0-9a-f]{6}$/i.test(s.textColor || '')
        ? s.textColor
        : !advanced && /^#[0-9a-f]{6}$/i.test(saved.textColor || '')
          ? saved.textColor
          : s.buttonStyle === 'filled' ? '#ffffff' : s.buttonColor || '#e74c3c',
      emailPlaceholder: (advanced ? s.emailPlaceholder : saved.emailPlaceholder) || s.emailPlaceholder || 'Enter your email address',
      emailButton: (advanced ? s.emailButton : saved.emailButton) || s.emailButton || 'Notify Me',
      smsPlaceholder: (advanced ? s.smsPlaceholder : saved.smsPlaceholder) || s.smsPlaceholder || '+1 234 567 890',
      confirmation: (advanced ? s.confirmation : saved.confirmation) || '',
      confirmationTextColor: /^#[0-9a-f]{6}$/i.test(saved.confirmationTextColor || '')
        ? saved.confirmationTextColor
        : '',
      confirmationBannerColor: /^#[0-9a-f]{6}$/i.test(saved.confirmationBannerColor || '')
        ? saved.confirmationBannerColor
        : '',
      productButton: s.productButton !== false,
      iconType: s.iconType || 'bell',
      iconImage: s.iconImage || '',
    };
  };

  let featureConfigReady = false;
  const isEnabled = () => CFG().uiConfig?.productCardConfig?.backInStockEnabled !== false;

  // In the theme editor only: surface that the feature is switched off in the app,
  // so the embed preview does not look silently broken.
  function syncDisabledNotice(enabled) {
    const existing = document.getElementById('ws-bis-disabled-notice');
    if (enabled || !window.Shopify?.designMode) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const notice = document.createElement('div');
    notice.id = 'ws-bis-disabled-notice';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#1f1f1f;color:#fff;padding:10px 16px;border-radius:8px;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;';
    notice.textContent = 'Back-in-stock alerts are turned off in the app. Enable them under Configurations → Back in Stock Configuration.';
    document.body.appendChild(notice);
  }

  function applyFeatureState() {
    if (!featureConfigReady) return;
    const enabled = isEnabled();
    document.documentElement.toggleAttribute('data-ws-bis-disabled', !enabled);
    syncDisabledNotice(enabled);
    if (enabled) {
      injectProductPage();
      return;
    }
    closeModal();
    document.getElementById('ws-bis-pdp')?.remove();
    pdpDone = false;
  }

  async function loadFeatureConfig() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${CFG().proxyBase}/ui-config`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json();
      if (data?.ok && data.config) {
        CFG().uiConfig = data.config;
        CFG().smsEnabled = data.smsEnabled === true;
      }
    } catch {
      // Keep existing embed behavior if the app proxy is temporarily unavailable.
    } finally {
      clearTimeout(timeout);
      featureConfigReady = true;
      applyCustomizerSettings();
      applyFeatureState();
    }
  }

  function applyCustomizerSettings() {
    const settings = SETTINGS();
    const root = document.documentElement;
    root.style.setProperty('--ws-bis-primary', settings.buttonColor);
    root.style.setProperty('--ws-bis-button-bg', settings.buttonBackground);
    root.style.setProperty('--ws-bis-button-text', settings.textColor);
    root.style.setProperty('--ws-bis-font-size', `${settings.textSize}px`);
    root.style.setProperty('--ws-bis-radius', `${settings.radius}px`);
    if (settings.confirmationBannerColor) root.style.setProperty('--ws-bis-confirm-bg', settings.confirmationBannerColor);
    if (settings.confirmationTextColor) root.style.setProperty('--ws-bis-confirm-text', settings.confirmationTextColor);

    const title = document.querySelector('#ws-bis-modal .ws-modal__title');
    const email = document.querySelector('#ws-bis-modal input[name="email"]');
    const phone = document.querySelector('#ws-bis-modal input[name="phone"]');
    const submit = document.getElementById('ws-bis-submit');
    if (title) title.textContent = settings.notifyModalTitle;
    if (email) email.placeholder = settings.emailPlaceholder;
    if (phone) phone.placeholder = settings.smsPlaceholder;
    if (submit) submit.textContent = settings.emailButton;
  }

  // Liquid registers the Shopify embed and supplies its settings; the interactive
  // modal itself belongs to JavaScript so it is not coupled to a theme's DOM.
  function ensureModal() {
    const existing = document.getElementById('ws-bis-modal');
    if (existing) return existing;
    const modal = document.createElement('div');
    modal.className = 'ws-modal-overlay';
    modal.id = 'ws-bis-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="ws-modal" role="dialog" aria-modal="true" aria-label="Back in stock notification">
        <div class="ws-modal__header"><h3 class="ws-modal__title">Get notified when this is back</h3><button class="ws-modal__close" id="ws-bis-close" type="button" aria-label="Close">&times;</button></div>
        <div class="ws-modal__body" id="ws-bis-form-body">
          <div class="ws-modal__tabs" role="tablist" aria-label="Notification method"><button class="ws-modal__tab is-active" id="ws-bis-email-tab" type="button" role="tab" aria-selected="true" aria-controls="ws-bis-form">Email</button><button class="ws-modal__tab" id="ws-bis-sms-tab" type="button" role="tab" aria-selected="false" aria-controls="ws-bis-form">SMS</button></div>
          <p class="ws-modal__intro" id="ws-bis-intro">Get notified via email when this product is back in stock</p><p class="ws-modal__msg" id="ws-bis-msg" role="alert" style="display:none"></p>
          <form class="ws-modal__form" id="ws-bis-form"><input type="hidden" name="variantId" value=""><input type="hidden" name="productId" value=""><input type="hidden" name="channel" value="email"><div class="ws-hp" aria-hidden="true"><label for="ws-bis-website">Website</label><input type="text" name="website" id="ws-bis-website" tabindex="-1" autocomplete="off"></div><div class="ws-modal__field" id="ws-bis-email-field"><label class="ws-sr-only" for="ws-bis-email">Email address *</label><input type="email" name="email" id="ws-bis-email" required autocomplete="email"></div><div class="ws-modal__field ws-modal__phone-field" id="ws-bis-phone-field" hidden><label class="ws-sr-only" for="ws-bis-phone">Phone number *</label><input type="tel" name="phone" id="ws-bis-phone" autocomplete="tel"></div><button class="ws-btn ws-btn--primary ws-modal__submit" id="ws-bis-submit" type="submit">Email Me</button></form>
          <p class="ws-modal__disclaimer" id="ws-bis-disclaimer">We will send you an email once the product becomes available. Your email address will not be shared with anyone else.</p>
        </div>
        <div class="ws-modal__success" id="ws-bis-success" style="display:none"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><h3 id="ws-bis-success-title">You're on the list!</h3><p id="ws-bis-success-msg">We'll email you when this is back in stock.</p><button class="ws-btn ws-btn--small ws-btn--danger" id="ws-bis-unsub" type="button" style="display:none">Unsubscribe</button></div>
      </div>`;
    document.body.appendChild(modal);
    applyCustomizerSettings();
    return modal;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

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

  function configureInlineChannel(form) {
    const channel = form.querySelector('select[name="channel"]')?.value || 'email';
    const sms = channel === 'sms';
    const emailField = form.querySelector('[data-channel-field="email"]');
    const phoneField = form.querySelector('[data-channel-field="sms"]');
    const emailInput = form.querySelector('input[name="email"]');
    const phoneInput = form.querySelector('input[name="phone"]');
    const submit = form.querySelector('.ws-bis-inline-submit');
    if (emailField) emailField.hidden = sms;
    if (phoneField) phoneField.hidden = !sms;
    if (emailInput) emailInput.required = !sms;
    if (phoneInput) phoneInput.required = sms;
    if (submit) submit.textContent = sms ? 'Text Me' : SETTINGS().emailButton;
  }

  function setNotificationChannel(channel) {
    const sms = channel === 'sms';
    const emailTab = document.getElementById('ws-bis-email-tab');
    const smsTab = document.getElementById('ws-bis-sms-tab');
    const tabs = document.querySelector('#ws-bis-modal .ws-modal__tabs');
    const emailField = document.getElementById('ws-bis-email-field');
    const emailInput = document.getElementById('ws-bis-email');
    const channelInput = document.querySelector('#ws-bis-form input[name="channel"]');
    const phoneField = document.getElementById('ws-bis-phone-field');
    const phoneInput = document.getElementById('ws-bis-phone');
    const form = document.getElementById('ws-bis-form');
    const intro = document.getElementById('ws-bis-intro');
    const disclaimer = document.getElementById('ws-bis-disclaimer');
    const submit = document.getElementById('ws-bis-submit');

    if (emailTab) {
      emailTab.classList.toggle('is-active', !sms);
      emailTab.setAttribute('aria-selected', String(!sms));
    }
    if (smsTab) {
      smsTab.hidden = CFG().smsEnabled !== true;
      smsTab.classList.toggle('is-active', sms);
      smsTab.setAttribute('aria-selected', String(sms));
    }
    if (tabs) tabs.classList.toggle('has-sms', CFG().smsEnabled === true);
    if (emailField) emailField.hidden = sms;
    if (phoneField) phoneField.hidden = !sms;
    if (form) form.classList.toggle('is-sms', sms);
    if (channelInput) channelInput.value = sms ? 'sms' : 'email';
    if (emailInput) {
      emailInput.required = !sms;
      if (sms) emailInput.value = '';
    }
    if (phoneInput) {
      phoneInput.required = sms;
      if (!sms) phoneInput.value = '';
    }
    if (intro) intro.textContent = sms
      ? 'Get notified by SMS when this product is back in stock'
      : 'Get notified via email when this product is back in stock';
    if (disclaimer) disclaimer.textContent = sms
      ? 'We will text you once the product becomes available. Your phone number will not be shared with anyone else.'
      : 'We will send you an email once the product becomes available. Your email address will not be shared with anyone else.';
    if (submit) submit.textContent = sms ? 'Text Me' : SETTINGS().emailButton;
  }

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

  async function openModal(container) {
    if (!featureConfigReady || !isEnabled()) return;
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
    setNotificationChannel('email');

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

  async function submitForm(form = document.getElementById('ws-bis-form'), options = {}) {
    const cfg = CFG();
    if (!form) return;
    const inline = Boolean(options.inline);
    const feedback = options.feedback || document.getElementById('ws-bis-msg');
    const submitBtn = options.button || document.getElementById('ws-bis-submit');
    if (feedback) {
      feedback.textContent = '';
      feedback.classList.remove('is-success');
      feedback.style.display = 'none';
    }
    if (!inline) clearMsg();

    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    const selectedChannel = String(body.channel || 'email');
    body.guestToken = getGuestToken();
    if (selectedChannel === 'email') {
      try {
        void window.wsTrack?.('ALERT_SUBSCRIBE_CLICK', {
          productId: body.productId || undefined,
          variantId: body.variantId || undefined,
          channel: selectedChannel,
          source: 'pdp',
        });
      } catch { /* tracking is non-fatal */ }
    }

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
        const productId = body.productId || (document.getElementById('ws-bis-form')?.querySelector('input[name="productId"]') || {}).value || '';
        const variantId = body.variantId || (document.getElementById('ws-bis-form')?.querySelector('input[name="variantId"]') || {}).value || '';
        try {
          await window.wsTrack?.('ALERT_SUBSCRIBE', {
            productId: productId || undefined,
            variantId: variantId || undefined,
            channel: body.channel || undefined,
            source: 'pdp',
          });
        } catch { /* tracking is non-fatal */ }
        const message = /confirm/i.test(data.message || '')
          ? data.message
          : SETTINGS().confirmation || data.message || "We'll email you when this is back in stock.";
        if (inline) {
          if (feedback) {
            feedback.textContent = message;
            feedback.classList.add('is-success');
            feedback.style.display = '';
          }
        } else {
          showSuccess("You're on the list!", message, { canUnsubscribe: Boolean(body.email || body.phone) });
        }
      } else if (data.code === 'already_available') {
        if (inline && feedback) {
          feedback.textContent = data.message || "Good news — it's in stock right now.";
          feedback.style.display = '';
        } else showMsg(data.message || "Good news — it's in stock right now.");
      } else {
        if (inline && feedback) {
          feedback.textContent = data.message || 'Unable to sign you up. Please try again.';
          feedback.style.display = '';
        } else showMsg(data.message || 'Unable to sign you up. Please try again.');
      }
    } catch (err) {
      console.error('Stock alert error', err);
      if (inline && feedback) {
        feedback.textContent = 'Something went wrong. Please try again.';
        feedback.style.display = '';
      } else showMsg('Something went wrong. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = selectedChannel === 'sms' || document.getElementById('ws-bis-sms-tab')?.getAttribute('aria-selected') === 'true'
          ? 'Text Me'
          : SETTINGS().emailButton;
      }
    }
  }

  async function unsubscribe() {
    const cfg = CFG();
    const modal = document.getElementById('ws-bis-modal');
    if (!modal) return;
    const vid = (modal.querySelector('input[name="variantId"]') || {}).value;
    const isSms = document.getElementById('ws-bis-sms-tab')?.getAttribute('aria-selected') === 'true';
    const email = modal.querySelector('input[name="email"]')?.value.trim() || '';
    const phone = modal.querySelector('input[name="phone"]')?.value.trim() || '';
    const contact = isSms ? phone : (email || CFG().customerEmail || '');
    if (!vid || !contact) { showForm(); return; }

    const unsubBtn = document.getElementById('ws-bis-unsub');
    if (unsubBtn) { unsubBtn.disabled = true; unsubBtn.innerHTML = '<span class="ws-spinner"></span>'; }

    try {
      await fetch(`${cfg.proxyBase}/stock-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _method: 'delete', variantId: vid, channel: isSms ? 'sms' : 'email', email, phone, guestToken: getGuestToken() }),
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
    const root = document.querySelector('#MainContent, main') || document;
    const forms = Array.from(root.querySelectorAll('form'))
      .filter((form) => !form.closest('.card, .card-wrapper'));
    const cartForm = forms.find((form) =>
      form.matches('form[action*="/cart/add"], form[data-type="add-to-cart-form"]') ||
      form.querySelector('[name="add"]'),
    );
    if (cartForm) return cartForm;

    const quoteButton = Array.from(root.querySelectorAll('button, a, [role="button"]'))
      .find((element) => /request\s+(a\s+)?quote/i.test(element.textContent || ''));
    if (quoteButton) return quoteButton.closest('form') || quoteButton.parentElement;

    return forms.find((form) =>
      form.querySelector('[name="id"], [name="variant_id"], select[name*="option"], input[type="radio"][name*="option"]'),
    ) || root.querySelector('.product__info-container, .product-information, .product__info');
  }

  function currentVariantId(form, product) {
    const fromUrl = new URLSearchParams(location.search).get('variant');
    if (fromUrl) return fromUrl;
    const root = document.querySelector('#MainContent, main') || document;
    const input = (form && form.querySelector('[name="id"], [name="variant_id"]')) ||
      root.querySelector('[name="id"], [name="variant_id"]');
    if (input && input.value) return input.value;

    if (product && Array.isArray(product.variants)) {
      const pickers = root.querySelectorAll('variant-selects, variant-radios, [data-variant-picker]');
      for (const picker of pickers) {
        const groups = picker.querySelectorAll('fieldset, .product-form__input');
        const optionValues = Array.from(groups).map((group) => {
          const select = group.querySelector('select');
          const checked = group.querySelector('input[type="radio"]:checked');
          const active = group.querySelector('[aria-checked="true"], [aria-pressed="true"], [data-selected="true"]');
          return select?.value || checked?.value || active?.dataset.value || active?.textContent?.trim() || '';
        }).filter(Boolean);
        if (!optionValues.length) continue;
        const variant = product.variants.find((candidate) =>
          optionValues.every((value, index) => String(candidate.options?.[index]) === value),
        );
        if (variant) return String(variant.id);
      }
    }

    return '';
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

  // When a variant is out of stock the theme's own "Sold out" / Add to cart /
  // Buy now controls are redundant next to the notify button, so hide them
  // while the notify button is shown and restore them when stock returns.
  function toggleThemeBuyButtons(form, unavailable) {
    if (!form) return;
    const root =
      form.closest('product-form') ||
      form.closest('.product-form') ||
      form.closest('.product') ||
      form.closest('#MainContent, main') ||
      form;
    const selectors = [
      '[name="add"]',
      '.product-form__submit',
      '.shopify-payment-button',
      '[data-shopify="payment-button"]',
      '.buy-now',
      '.dynamic-checkout__content',
    ];
    selectors.forEach((sel) => {
      root.querySelectorAll(sel).forEach((el) => {
        if (el.closest('.back-in-stock') || el.closest('#ws-bis-pdp')) return;
        if (el.__wsBisWasHidden === undefined) {
          el.__wsBisWasHidden = el.style.display || '';
        }
        el.style.display = unavailable ? 'none' : el.__wsBisWasHidden;
      });
    });
  }

  function notifyMarkup(vid, pid) {
    const settings = SETTINGS();
    const label = escapeHtml(settings.notifyButtonText);
    const placementClass = `back-in-stock--${settings.placement}`;
    if (settings.launchType === 'inline') {
      const channelSelector = CFG().smsEnabled === true
        ? '<label class="ws-bis-inline-label">Notification method<select name="channel"><option value="email">Email</option><option value="sms">SMS</option></select></label>'
        : '<input type="hidden" name="channel" value="email" />';
      return (
        `<div class="back-in-stock ${placementClass} ws-bis-inline" data-variant-id="${vid}" data-product-id="${pid}">` +
        '<form class="ws-bis-inline-form">' +
        `<input type="hidden" name="variantId" value="${vid}" /><input type="hidden" name="productId" value="${pid}" />` +
        channelSelector +
        '<div class="ws-hp" aria-hidden="true"><label>Website</label><input type="text" name="website" tabindex="-1" autocomplete="off" /></div>' +
        `<label class="ws-bis-inline-label" data-channel-field="email">Email *<input type="email" name="email" placeholder="${escapeHtml(settings.emailPlaceholder)}" required autocomplete="email" /></label>` +
        (CFG().smsEnabled === true
          ? `<label class="ws-bis-inline-label" data-channel-field="sms" hidden>Phone *<input type="tel" name="phone" placeholder="${escapeHtml(settings.smsPlaceholder)}" autocomplete="tel" /></label>`
          : '') +
        `<button class="ws-bis-inline-submit" type="submit">${escapeHtml(settings.emailButton)}</button>` +
        '<p class="ws-bis-inline-feedback" role="status" style="display:none"></p>' +
        '</form></div>'
      );
    }
    return (
      `<div class="back-in-stock ${placementClass}" data-variant-id="${vid}" data-product-id="${pid}">` +
      `<button class="notify-me" type="button" aria-label="${label}">` +
      `<span class="ws-bis-button-icon ${settings.buttonType === 'text' ? 'is-hidden' : ''}">${notifyIconMarkup()}</span>` +
      `<span class="ws-bis-button-label ${settings.buttonType === 'icon' ? 'is-hidden' : ''}">${label}</span>` +
      '</button></div>'
    );
  }

  let pdpDone = false;
  let pdpWrapper = null;
  let pdpRetryTimer = null;
  async function injectProductPage() {
    if (pdpDone && (!pdpWrapper || pdpWrapper.isConnected)) return;
    if (pdpDone) {
      pdpDone = false;
      pdpWrapper = null;
    }
    if (!featureConfigReady || !isEnabled() || !SETTINGS().productButton) return;
    const handle = pdpHandle();
    if (!handle) return;
    const form = mainProductForm();
    if (!form) return;
    pdpDone = true;

    // A block may already be manually placed on the product page; in that case
    // keep it (don't inject a duplicate button) but still hide the theme's own
    // Sold out / Buy now controls while the variant is unavailable.
    const placed = document.querySelector('.back-in-stock');

    let product = null;
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (resp.ok) product = await resp.json();
    } catch { /* non-fatal */ }

    const vid =
      currentVariantId(form, product) ||
      (product && product.variants && product.variants[0] ? String(product.variants[0].id) : '');
    const pid = product ? String(product.id) : '';

    const wrap = document.createElement('div');
    wrap.className = 'ws-pdp';
    wrap.id = 'ws-bis-pdp';
    const unavailable = variantUnavailable(product, vid, form);
    if (unavailable && !placed) {
      wrap.insertAdjacentHTML('beforeend', notifyMarkup(vid, pid));
    }
    toggleThemeBuyButtons(form, unavailable);

    if (!placed) {
      const anchor = (form.closest('product-form') || form);
      anchor.insertAdjacentElement('afterend', wrap);
      pdpWrapper = wrap;
    }

    const pickerRoot = document.querySelector('#MainContent, main') || document;
    if (!pickerRoot.__wsBisBound) {
      pickerRoot.__wsBisBound = true;
      pickerRoot.addEventListener('change', () => {
        setTimeout(() => {
          const v = currentVariantId(form, product);
          const off = variantUnavailable(product, v, form);
          toggleThemeBuyButtons(form, off);
          if (placed) return;
          const bis = wrap.querySelector('.back-in-stock');
          if (!off) {
            if (bis) bis.remove();
          } else if (!bis) {
            wrap.insertAdjacentHTML('beforeend', notifyMarkup(v, product ? String(product.id) : ''));
          } else {
            bis.dataset.variantId = v;
          }
        }, 60);
      });
    }
  }

  function scheduleProductPageRetry() {
    if (pdpDone && (!pdpWrapper || pdpWrapper.isConnected)) return;
    if (pdpRetryTimer) clearTimeout(pdpRetryTimer);
    pdpRetryTimer = setTimeout(() => {
      pdpRetryTimer = null;
      void injectProductPage();
    }, 100);
  }

  function watchProductPage() {
    if (!pdpHandle() || !window.MutationObserver) return;
    const root = document.querySelector('#MainContent, main') || document.body;
    new MutationObserver(scheduleProductPageRetry).observe(root, {
      childList: true,
      subtree: true,
    });
  }

  /* ---------- Initialize (gated on the per-store config) ---------- */
  function init() {
    // The embed and the section block can both render the modal markup; keep only
    // the first instance so IDs stay unique and the overlay isn't doubled.
    const modals = document.querySelectorAll('#ws-bis-modal');
    if (modals.length > 1) {
      for (let i = 1; i < modals.length; i++) modals[i].remove();
    }
    ensureModal();

    document.addEventListener('click', (e) => {
      if (!featureConfigReady || !isEnabled()) return;
      const button = e.target.closest && e.target.closest('.notify-me');
      if (!button) return;
      const container = button.closest('.back-in-stock');
      if (!container) return;
      e.preventDefault();
      openModal(container);
    });

    document.addEventListener('submit', (e) => {
      const form = e.target.closest && e.target.closest('.ws-bis-inline-form');
      if (!form) return;
      e.preventDefault();
      submitForm(form, {
        inline: true,
        button: form.querySelector('button[type="submit"]'),
        feedback: form.querySelector('.ws-bis-inline-feedback'),
      });
    });

    document.addEventListener('change', (e) => {
      const select = e.target.closest && e.target.closest('.ws-bis-inline-form select[name="channel"]');
      if (select) configureInlineChannel(select.form);
    });

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

    const emailTab = document.getElementById('ws-bis-email-tab');
    const smsTab = document.getElementById('ws-bis-sms-tab');
    if (emailTab) emailTab.addEventListener('click', () => setNotificationChannel('email'));
    if (smsTab) smsTab.addEventListener('click', () => setNotificationChannel('sms'));

    const modalForm = document.getElementById('ws-bis-form');
    if (modalForm) modalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitForm(modalForm);
    });

    const unsubBtn = document.getElementById('ws-bis-unsub');
    if (unsubBtn) unsubBtn.addEventListener('click', unsubscribe);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Cooperative hook: the separate Wishlist extension fires this for out-of-stock
    // saved items so the same modal opens here.
    document.addEventListener('ws:open-bis', (e) => {
      if (!featureConfigReady || !isEnabled()) return;
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
    document.addEventListener('shopify:section:load', scheduleProductPageRetry);
    watchProductPage();
  }

  function boot() {
    const start = () => {
      document.addEventListener('wishlist:config-updated', applyFeatureState);
      document.addEventListener('wishlist:config-ready', applyFeatureState);
      init();
      void loadFeatureConfig();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  boot();
})();
