/**
 * Back-in-Stock – modal form behaviour.
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

  // Inline message inside the form body — replaces the old blocking alert() popups.
  function showMsg(text) {
    const msg = document.getElementById('ws-bis-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.style.display = text ? '' : 'none';
  }
  function clearMsg() { showMsg(''); }

  // Toggle between the form view and the success/"already subscribed" view.
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
    // Offer Unsubscribe only when we know the email (so the DELETE can be keyed).
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

    // Update hidden fields for this variant
    const vidInput = modal.querySelector('input[name="variantId"]');
    if (vidInput) vidInput.value = vid;
    const pidInput = modal.querySelector('input[name="productId"]');
    if (pidInput && container.dataset.productId) pidInput.value = container.dataset.productId;

    // Reset to a clean form state
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

    // Focus first input
    setTimeout(() => {
      const el = modal.querySelector('input[name="email"]');
      if (el) el.focus();
    }, 200);

    // If we already know the shopper's email, pre-check whether they're on the list so the
    // modal reflects live subscription state instead of always showing a blank form.
    const email = cfg.customerEmail;
    if (email && vid) {
      try {
        const params = new URLSearchParams({ variantId: vid, email });
        const resp = await fetch(`${cfg.proxyBase}/stock-alert?${params}`);
        const data = await resp.json();
        // Only act if the modal is still open on the same variant.
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
        // Not an error — the item is purchasable right now. Tell them inline.
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
    // Back to the form so they can re-subscribe if they change their mind.
    showForm();
    clearMsg();
    showMsg("You've been removed from this alert.");
  }

  function init() {
    // Open the modal on any "Notify me" click — delegated on the document so it also
    // covers notify buttons injected after load (the PDP auto-injection and its
    // variant-change re-renders), not just the ones present at DOMContentLoaded.
    document.addEventListener('click', (e) => {
      const button = e.target.closest && e.target.closest('.notify-me');
      if (!button) return;
      const container = button.closest('.back-in-stock');
      if (!container) return;
      e.preventDefault();
      openModal(container);
    });

    // Close modal
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

    // Submit
    const submitBtn = document.getElementById('ws-bis-submit');
    if (submitBtn) submitBtn.addEventListener('click', submitForm);

    // Unsubscribe (shown only in the "already on the list" / success state)
    const unsubBtn = document.getElementById('ws-bis-unsub');
    if (unsubBtn) unsubBtn.addEventListener('click', unsubscribe);

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Enter key on email field
    const emailInput = document.getElementById('ws-bis-email');
    if (emailInput) {
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitForm();
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
