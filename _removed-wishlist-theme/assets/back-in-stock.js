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

  function openModal(container) {
    const vid = container.dataset.variantId;
    const modal = document.getElementById('ws-bis-modal');
    if (!modal) return;

    // Update hidden fields for this variant
    const vidInput = modal.querySelector('input[name="variantId"]');
    if (vidInput) vidInput.value = vid;

    // Reset form state
    const formBody = document.getElementById('ws-bis-form-body');
    const actions = document.getElementById('ws-bis-actions');
    const success = document.getElementById('ws-bis-success');
    if (formBody) formBody.style.display = '';
    if (actions) actions.style.display = '';
    if (success) success.style.display = 'none';

    const form = document.getElementById('ws-bis-form');
    if (form) form.reset();

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Focus first input
    setTimeout(() => {
      const emailInput = modal.querySelector('input[name="email"]');
      if (emailInput) emailInput.focus();
    }, 200);
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
        const formBody = document.getElementById('ws-bis-form-body');
        const actions = document.getElementById('ws-bis-actions');
        const success = document.getElementById('ws-bis-success');
        const successMsg = document.getElementById('ws-bis-success-msg');

        if (formBody) formBody.style.display = 'none';
        if (actions) actions.style.display = 'none';
        if (success) success.style.display = '';
        if (successMsg) successMsg.textContent = data.message || "We'll email you when this is back in stock.";
      } else {
        alert(data.message || 'Unable to sign you up. Please try again.');
      }
    } catch (err) {
      console.error('Stock alert error', err);
      alert('Something went wrong. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Notify Me';
      }
    }
  }

  function init() {
    // Open modal on "Notify me" button click
    document.querySelectorAll('.back-in-stock').forEach((container) => {
      const button = container.querySelector('.notify-me');
      if (!button) return;
      button.addEventListener('click', (e) => {
        e.preventDefault();
        openModal(container);
      });
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
