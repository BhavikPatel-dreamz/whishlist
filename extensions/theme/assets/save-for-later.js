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
  const removeSelector = 'cart-remove-button, a[href*="/cart/change"], [data-cart-remove], .cart__remove, .cart-items__remove, button[name="remove"]';
  const cartRowSelector = '.cart-items__table-row, .cart-item, [data-cart-item], [data-line-item]';

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
    dialog = document.createElement('div');
    dialog.id = 'ws-save-dialog';
    dialog.className = 'ws-modal-overlay';
    dialog.setAttribute('aria-hidden', 'true');
    dialog.innerHTML =
      '<div class="ws-modal" role="dialog" aria-modal="true" aria-labelledby="ws-save-dialog-title">' +
      '  <div class="ws-modal__header">' +
      '    <h3 class="ws-modal__title" id="ws-save-dialog-title"></h3>' +
      '    <button type="button" class="ws-modal__close" aria-label="Cancel and keep item in cart">' +
      '      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="14" y1="4" x2="4" y2="14"></line><line x1="4" y1="4" x2="14" y2="14"></line></svg>' +
      '    </button>' +
      '  </div>' +
      '  <div class="ws-modal__body">' +
      '    <div class="ws-save-dialog__content">' +
      '      <div class="ws-save-dialog__media">' +
      '        <img class="ws-save-dialog__image" alt="" hidden>' +
      '      </div>' +
      '      <div class="ws-save-dialog__info">' +
      '        <p class="ws-save-dialog__product"></p>' +
      '        <p class="ws-save-dialog__desc">You can save this item for later and move it to your cart when you\'re ready.</p>' +
      '        <label class="ws-save-permission" hidden><input type="checkbox"> Don’t show this pop-up again</label>' +
      '        <p class="ws-save-dialog-status" role="status"></p>' +
      '      </div>' +
      '    </div>' +
      '    <div class="ws-modal__actions ws-save-dialog__actions">' +
      '      <button type="button" class="ws-btn ws-save-secondary"></button>' +
      '      <button type="button" class="ws-btn ws-btn--primary ws-save-primary"></button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    const close = () => { if (busy) return; dialog.classList.remove('is-open'); dialog.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; pending = null; };
    dialog.querySelector('.ws-modal__close').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog && !busy) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialog && dialog.classList.contains('is-open') && !busy) {
        const c = dialog._close;
        if (typeof c === 'function') c();
      }
    });
    dialog.querySelector('.ws-save-primary').addEventListener('click', () => finishRemoval(true));
    dialog.querySelector('.ws-save-secondary').addEventListener('click', () => finishRemoval(false));
    document.body.appendChild(dialog);
    dialog._close = close;
    dialog._open = () => {
      dialog.classList.add('is-open');
      dialog.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };
    return dialog;
  }
  function dialogStatus(text) { const el = dialog.querySelector('.ws-save-dialog-status'); if (el) el.textContent = text || ''; }
  function lock(value) {
    busy = value;
    dialog.querySelectorAll('button, input').forEach((button) => { button.disabled = value; });
  }
  function removeReference(control) {
    const link = control.matches('a') ? control : control.querySelector('a[href]');
    const url = link ? new URL(link.href, location.href) : null;
    // Never intercept links that change a line to a nonzero quantity.
    if (url && url.searchParams.has('quantity') && url.searchParams.get('quantity') !== '0') return null;
    const row = control.closest(`[data-cart-item-key], ${cartRowSelector}`);
    const key =
      control.dataset.key ||
      control.dataset.cartItemKey ||
      row?.dataset.key ||
      row?.dataset.cartItemKey ||
      row?.dataset.lineItemKey ||
      url?.searchParams.get('id');
    const idLine = control.id.match(/(?:remove|line)[-_]?(\d+)/i)?.[1];
    let line = Number(
      control.dataset.index ||
      control.dataset.line ||
      control.dataset.lineIndex ||
      row?.dataset.index ||
      row?.dataset.line ||
      row?.dataset.lineIndex ||
      idLine ||
      url?.searchParams.get('line'),
    );
    if ((!Number.isInteger(line) || line < 1) && row) {
      const rows = Array.from(document.querySelectorAll(cartRowSelector));
      const rowIndex = rows.indexOf(row);
      if (rowIndex >= 0) line = rowIndex + 1;
    }
    const variantInput = row?.querySelector('[data-quantity-variant-id]');
    const variant =
      row?.dataset.variantId ||
      variantInput?.dataset.quantityVariantId ||
      variantInput?.value;
    if (!key && (!Number.isInteger(line) || line < 1) && !variant) return null;
    return { key, line, variant };
  }
  async function beginRemoval(control, direct = false) {
    if (busy || (dialog && dialog.classList.contains('is-open'))) return;
    const reference = removeReference(control);
    if (!reference) return;
    const view = getDialog();
    const c = settings();
    pending = null;
    view.querySelector('#ws-save-dialog-title').textContent = c.saveLaterTitle || 'Do you want to save this product for later?';
    view.querySelector('.ws-save-primary').textContent = c.saveLaterPrimary || 'Save for Later';
    view.querySelector('.ws-save-secondary').textContent = c.saveLaterSecondary || 'No, thanks';
    const prod = view.querySelector('.ws-save-dialog__product');
    if (prod) prod.textContent = '';
    const img = view.querySelector('.ws-save-dialog__image');
    if (img) { img.hidden = true; img.removeAttribute('src'); }
    const perm = view.querySelector('.ws-save-permission');
    if (perm) { perm.hidden = c.saveLaterPermission !== 'ask'; const chk = perm.querySelector('input'); if (chk) chk.checked = false; }
    dialogStatus('Loading cart item…');
    lock(true);
    if (typeof view._open === 'function') view._open(); else view.classList.add('is-open'); view.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    try {
      const cart = await cartRequest('cart.js');
      const item = reference.key
        ? cart.items.find((entry) => entry.key === reference.key || String(entry.variant_id) === reference.key)
        : Number.isInteger(reference.line) && reference.line > 0
          ? cart.items[reference.line - 1]
          : cart.items.find((entry) => String(entry.variant_id) === reference.variant);
      if (!item || (reference.variant && String(item.variant_id) !== reference.variant)) throw new Error('Your cart has changed. Close this pop-up and try again.');
      pending = { item, currency: cart.currency };
      const prod = view.querySelector('.ws-save-dialog__product');
      if (prod) prod.textContent = `${item.product_title || item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ` · ${item.variant_title}` : ''} · Qty ${item.quantity}`;
      const image = view.querySelector('.ws-save-dialog__image');
      const src = safeUrl(item.featured_image?.url || item.image || '', true);
      if (image) { if (src) { image.src = src; image.hidden = false; } else { image.hidden = true; image.removeAttribute('src'); } }
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
      const cartItem = cart.items.find((entry) => entry.key === pending.item.key);
      const item = cartItem || pending.item;
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
      if (cartItem) await cartRequest('cart/change.js', { id: cartItem.key, quantity: 0 });
      if (settings().saveLaterPermission === 'ask') {
        const chk = dialog.querySelector('.ws-save-permission input');
        if (chk && chk.checked) {
          try { localStorage.setItem(permissionKey(), '1'); } catch { /* Cart action already succeeded. */ }
        }
      }
      if (typeof dialog._close === 'function') dialog._close(); else { dialog.classList.remove('is-open'); dialog.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; pending = null; }
      if (save) {
        const opened = window.__wishlistStock?.openDrawer('saved-later');
        if (!opened) window.__wishlistStock?.showPageTab?.('saved-later');
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
    const hosts = Array.from(document.querySelectorAll('#ws-saved-later-items, #ws-drawer-saved-later-items'));
    if (!hosts.length) return;
    hosts.forEach((host) => host.replaceChildren());
    let items;
    try { items = readItems(); } catch (error) {
      hosts.forEach((host) => host.appendChild(node('p', '', message(error))));
      return;
    }
    document.querySelectorAll('#ws-saved-later-count, #ws-drawer-saved-later-count').forEach((count) => {
      count.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    });
    document.querySelectorAll('#ws-saved-later-empty, #ws-drawer-saved-later-empty').forEach((empty) => {
      empty.hidden = items.length > 0;
    });
    items.forEach((item) => hosts.forEach((host) => {
      const card = node('article', 'ws-page-card ws-page-card--row');
      if (host.id === 'ws-drawer-saved-later-items') card.classList.add('ws-drawer-saved-card');
      const link = safeUrl(item.url) || root() + 'collections/all';
      const src = safeUrl(item.image || '', true);
      if (src) {
        const imageLink = node('a', 'ws-page-card__image');
        imageLink.href = link;
        const image = node('img');
        image.src = src; image.alt = item.title || 'Saved product'; image.loading = 'lazy';
        imageLink.appendChild(image);
        card.appendChild(imageLink);
      }
      const body = node('div', 'ws-page-card__body');

      const title = node('p', 'ws-page-card__title');
      const titleLink = node('a');
      titleLink.href = link;
      titleLink.textContent = item.title || 'Saved product';
      title.appendChild(titleLink);
      body.appendChild(title);

      if (item.variantTitle && item.variantTitle !== 'Default Title') {
        body.appendChild(node('p', 'ws-page-card__variant', item.variantTitle));
      }
      body.appendChild(node('p', 'ws-page-card__sku', `Qty ${item.quantity}`));

      const price = priceText(item);
      if (price) body.appendChild(node('p', 'ws-page-card__price', price));

      const status = node('p', 'ws-saved-status'); status.setAttribute('role', 'status');
      body.appendChild(status);

      const actions = node('div', 'ws-page-card__actions');
      const move = node('button', 'ws-btn ws-btn--primary ws-btn--small', 'Move to Cart'); move.type = 'button';
      move.addEventListener('click', () => moveToCart(item, status, move));
      actions.appendChild(move);
      body.appendChild(actions);
      card.appendChild(body);

      const remove = node('button', 'ws-page-card__remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${item.title || 'product'} from saved items`);
      remove.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      remove.addEventListener('click', () => {
        if (move.disabled) return;
        try { writeItems(readItems().filter((entry) => entry.id !== item.id)); } catch (error) { status.textContent = message(error); }
      });
      card.appendChild(remove);
      host.appendChild(card);
    }));
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
      if (dialog && dialog.classList.contains('is-open') && !busy) {
        if (typeof dialog._close === 'function') dialog._close(); else { dialog.classList.remove('is-open'); dialog.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
      }
    });
    document.addEventListener('wishlist:page-ready', renderSavedItems);
    document.addEventListener('wishlist:saved-later-updated', renderSavedItems);
    window.addEventListener('storage', (event) => { if (event.key === storageKey()) renderSavedItems(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
