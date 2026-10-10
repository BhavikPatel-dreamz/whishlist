/** Cart save-for-later, scoped to this shop/browser and signed-in customer. */
(function () {
  const cfg = () => window.__wishlist_stock || {};
  const settings = () => cfg().uiConfig?.productCardConfig || {};
  const mode = () => cfg().uiConfig ? settings().saveLaterMode || 'popup' : 'disabled';
  const root = () => window.Shopify?.routes?.root || '/';
  const storageKey = () => `ws_saved_later_v1:${cfg().customerId || 'guest'}`;
  const permissionKey = () => `${storageKey()}:skip_prompt`;
  let dialog, pending, busy = false, scheduled = false;
  let moved = new Set();
  const removeSelector = 'cart-remove-button, a[href*="/cart/change"], [data-cart-remove], .cart__remove';

  function readItems() {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('Saved items could not be read. Please try again.');
    return items.filter((item) => item && typeof item.id === 'string' && /^\d+$/.test(String(item.variantId)) && Number.isInteger(item.quantity) && item.quantity > 0);
  }
  function writeItems(items) {
    localStorage.setItem(storageKey(), JSON.stringify(items));
    document.dispatchEvent(new CustomEvent('wishlist:saved-later-updated'));
  }
  function message(error) {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  }
  async function cartRequest(path, payload) {
    const response = await fetch(root() + path, payload ? {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload),
    } : { cache: 'no-store', headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || data.status >= 400) throw new Error(typeof data.description === 'string' ? data.description : 'The cart could not be updated. Please try again.');
    return data;
  }
  function safeUrl(value, image = false) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, location.href);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      return image || url.origin === location.origin ? url.href : '';
    } catch { return ''; }
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function getDialog() {
    if (dialog) return dialog;
    dialog = node('dialog', 'ws-save-dialog');
    dialog.setAttribute('aria-labelledby', 'ws-save-dialog-title');
    dialog.innerHTML = '<button type="button" class="ws-save-close" aria-label="Cancel and keep item in cart">×</button><div class="ws-save-dialog-content"><img class="ws-save-dialog-image" alt="" hidden><div><p class="ws-save-dialog-product"></p><h2 id="ws-save-dialog-title"></h2><label class="ws-save-permission" hidden><input type="checkbox"> Don’t show this pop-up again</label><p class="ws-save-dialog-status" role="status"></p><div class="ws-save-dialog-actions"><button type="button" class="ws-save-secondary"></button><button type="button" class="ws-save-primary"></button></div></div></div>';
    dialog.querySelector('.ws-save-close').addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { pending = null; });
    dialog.querySelector('.ws-save-primary').addEventListener('click', () => finishRemoval(true));
    dialog.querySelector('.ws-save-secondary').addEventListener('click', () => finishRemoval(false));
    document.body.appendChild(dialog);
    return dialog;
  }
  function dialogStatus(text) { dialog.querySelector('.ws-save-dialog-status').textContent = text; }
  function lock(value) {
    busy = value;
    dialog.querySelectorAll('button, input').forEach((button) => { button.disabled = value; });
  }
  function removeReference(control) {
    const link = control.matches('a') ? control : control.querySelector('a[href]');
    const url = link ? new URL(link.href, location.href) : null;
    // Never intercept links that change a line to a nonzero quantity.
    if (url && url.searchParams.has('quantity') && url.searchParams.get('quantity') !== '0') return null;
    const row = control.closest('.cart-item, [data-cart-item], [data-line-item]');
    const key = control.dataset.key || row?.dataset.key || url?.searchParams.get('id');
    const line = Number(control.dataset.index || control.dataset.line || url?.searchParams.get('line') || row?.dataset.index);
    if (!key && (!Number.isInteger(line) || line < 1)) return null;
    const variant = row?.querySelector('[data-quantity-variant-id]')?.dataset.quantityVariantId;
    return { key, line, variant };
  }
  async function beginRemoval(control, direct = false) {
    if (busy || dialog?.open) return;
    const reference = removeReference(control);
    if (!reference) return;
    const view = getDialog();
    const c = settings();
    pending = null;
    view.querySelector('#ws-save-dialog-title').textContent = c.saveLaterTitle || 'Do you want to save this product for later?';
    view.querySelector('.ws-save-primary').textContent = c.saveLaterPrimary || 'Save For Later';
    view.querySelector('.ws-save-secondary').textContent = c.saveLaterSecondary || 'No, thanks!';
    view.querySelector('.ws-save-dialog-product').textContent = '';
    view.querySelector('.ws-save-dialog-image').hidden = true;
    view.querySelector('.ws-save-permission').hidden = c.saveLaterPermission !== 'ask';
    view.querySelector('input').checked = false;
    dialogStatus('Loading cart item…');
    lock(true);
    view.showModal();
    try {
      const cart = await cartRequest('cart.js');
      const item = reference.key ? cart.items.find((entry) => entry.key === reference.key || String(entry.variant_id) === reference.key) : cart.items[reference.line - 1];
      if (!item || (reference.variant && String(item.variant_id) !== reference.variant)) throw new Error('Your cart has changed. Close this pop-up and try again.');
      pending = { item, currency: cart.currency };
      view.querySelector('.ws-save-dialog-product').textContent = `${item.product_title || item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ` · ${item.variant_title}` : ''} · Qty ${item.quantity}`;
      const image = view.querySelector('.ws-save-dialog-image');
      const src = safeUrl(item.featured_image?.url || item.image || '', true);
      if (src) { image.src = src; image.hidden = false; }
      dialogStatus('');
    } catch (error) {
      dialogStatus(message(error));
    } finally {
      lock(false);
      if (!pending) view.querySelectorAll('.ws-save-primary, .ws-save-secondary').forEach((button) => { button.disabled = true; });
      else if (direct) await finishRemoval(true);
    }
  }
  async function finishRemoval(save) {
    if (busy || !pending) return;
    lock(true);
    dialogStatus(save ? 'Saving item…' : 'Removing item…');
    let saved = false;
    try {
      const cart = await cartRequest('cart.js');
      const item = cart.items.find((entry) => entry.key === pending.item.key);
      if (!item || item.quantity !== pending.item.quantity) throw new Error('Your cart has changed. Close this pop-up and try again.');
      if (save) {
        const items = readItems();
        const existing = items.find((entry) => entry.cartKey === item.key);
        const properties = { ...(item.properties || {}) };
        delete properties._ws_saved_later_id;
        const record = {
          id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
          cartKey: item.key, variantId: String(item.variant_id), productId: String(item.product_id),
          quantity: item.quantity, properties, sellingPlanId: item.selling_plan_allocation?.selling_plan?.id || null,
          title: item.product_title || item.title, variantTitle: item.variant_title,
          image: item.featured_image?.url || item.image, url: item.url,
          price: item.final_price ?? item.price, currency: cart.currency || pending.currency,
          savedAt: new Date().toISOString(),
        };
        // Persist first: a storage failure must never remove the cart item.
        writeItems([...items.filter((entry) => entry.id !== record.id), record]);
        saved = true;
      }
      await cartRequest('cart/change.js', { id: item.key, quantity: 0 });
      if (settings().saveLaterPermission === 'ask' && dialog.querySelector('input').checked) {
        try { localStorage.setItem(permissionKey(), '1'); } catch { /* Cart action already succeeded. */ }
      }
      dialog.close();
      // Reload theme cart state via navigation; this works for both pages and drawers.
      if (save) {
        const url = new URL(cfg().settings?.wishlistPageUrl || '/apps/wishlist-stock/wishlist', location.href);
        url.searchParams.set('view', 'saved-later');
        location.assign(url.href);
      } else location.reload();
    } catch (error) {
      dialogStatus(`${saved ? 'Item is saved, but cart removal could not be confirmed. ' : ''}${message(error)}`);
    } finally { lock(false); }
  }

  function shouldPrompt() {
    if (mode() !== 'popup') return false;
    if (settings().saveLaterPermission !== 'ask') return true;
    try { return localStorage.getItem(permissionKey()) !== '1'; } catch { return true; }
  }
  document.addEventListener('click', (event) => {
    const inline = event.target.closest('[data-ws-save-later-inline]');
    const control = inline ? inline.__wsRemoveControl : event.target.closest(removeSelector);
    if (!control || (!inline && !shouldPrompt()) || !removeReference(control)) return;
    if (inline && mode() !== 'inline') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void beginRemoval(control, !!inline);
  }, true);

  function enhanceInline() {
    const enabled = mode() === 'inline';
    document.querySelectorAll('[data-ws-save-later-inline]').forEach((link) => {
      if (!enabled || !link.__wsRemoveControl?.isConnected) link.remove();
    });
    if (!enabled) return;
    document.querySelectorAll(removeSelector).forEach((control) => {
      if (control.closest('cart-remove-button') && control.tagName !== 'CART-REMOVE-BUTTON') return;
      if (!removeReference(control) || control.__wsInlineLink?.isConnected) return;
      const link = node('button', 'ws-save-inline', 'Save for later');
      link.type = 'button';
      link.setAttribute('data-ws-save-later-inline', '');
      link.__wsRemoveControl = control;
      control.__wsInlineLink = link;
      control.insertAdjacentElement('afterend', link);
    });
  }

  function priceText(item) {
    if (!Number.isFinite(item.price) || !item.currency) return '';
    try { return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: item.currency }).format(item.price / 100); } catch { return ''; }
  }
  async function moveToCart(item, status, button) {
    if (button.disabled || moved.has(item.id)) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="ws-spinner" aria-hidden="true"></span><span>Moving...</span>';
    if (status) status.textContent = '';
    try {
      // Check storage access before altering the cart.
      localStorage.setItem(storageKey(), JSON.stringify(readItems()));
      const cart = await cartRequest('cart.js');
      const restored = cart.items.filter((line) => line.properties?._ws_saved_later_id === item.id).reduce((sum, line) => sum + line.quantity, 0);
      if (restored < item.quantity) {
        const payload = {
          id: item.variantId, quantity: item.quantity - restored,
          properties: { ...item.properties, _ws_saved_later_id: item.id },
        };
        if (item.sellingPlanId) payload.selling_plan = item.sellingPlanId;
        await cartRequest('cart/add.js', { items: [payload] });
      }
      moved.add(item.id);
      writeItems(readItems().filter((entry) => entry.id !== item.id));
      button.textContent = 'Added';
      button.disabled = true;
      location.assign(root() + 'cart');
    } catch (error) {
      if (status) {
        status.textContent = moved.has(item.id)
          ? 'Added to cart. Could not clear this saved item; refresh to update the list.'
          : message(error);
      }
      button.textContent = originalText;
      button.disabled = false;
    } finally {
      button.removeAttribute('aria-busy');
    }
  }
  function renderSavedItems() {
    const host = document.getElementById('ws-saved-later-items');
    if (!host) return;
    host.replaceChildren();
    let items;
    try { items = readItems(); } catch (error) { host.appendChild(node('p', '', message(error))); return; }
    const count = document.getElementById('ws-saved-later-count');
    if (count) count.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    const empty = document.getElementById('ws-saved-later-empty');
    if (empty) empty.hidden = items.length > 0;
    items.forEach((item) => {
      const card = node('article', 'ws-saved-card');
      const src = safeUrl(item.image || '', true);
      if (src) {
        const image = node('img', 'ws-saved-image');
        image.src = src; image.alt = item.title || 'Saved product'; image.loading = 'lazy';
        card.appendChild(image);
      }
      const title = node('a', 'ws-saved-title', item.title || 'Saved product');
      title.href = safeUrl(item.url) || root() + 'collections/all';
      card.appendChild(title);
      card.appendChild(node('p', 'ws-saved-details', [priceText(item), item.variantTitle === 'Default Title' ? '' : item.variantTitle, `Qty ${item.quantity}`].filter(Boolean).join(' · ')));
      const status = node('p', 'ws-saved-status'); status.setAttribute('role', 'status');
      const move = node('button', 'ws-saved-move', 'Move to Cart'); move.type = 'button';
      move.addEventListener('click', () => moveToCart(item, status, move));
      const remove = node('button', 'ws-saved-remove', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${item.title || 'product'} from saved items`);
      remove.addEventListener('click', () => {
        if (move.disabled) return;
        try { writeItems(readItems().filter((entry) => entry.id !== item.id)); } catch (error) { status.textContent = message(error); }
      });
      card.append(move, remove, status);
      host.appendChild(card);
    });
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; enhanceInline(); }, 100);
  }
  function boot() {
    enhanceInline();
    renderSavedItems();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('wishlist:config-updated', () => {
      enhanceInline();
      if (dialog?.open && !busy) dialog.close();
    });
    document.addEventListener('wishlist:page-ready', renderSavedItems);
    document.addEventListener('wishlist:saved-later-updated', renderSavedItems);
    window.addEventListener('storage', (event) => { if (event.key === storageKey()) renderSavedItems(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
