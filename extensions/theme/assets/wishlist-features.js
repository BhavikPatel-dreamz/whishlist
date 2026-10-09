/* Merchant-controlled wishlist behavior shared by buttons, pages and drawers. */
(function () {
  if (window.__wishlistFeatures) return;
  const cfg = () => window.__wishlist_stock || {};
  const settings = () => cfg().uiConfig?.productCardConfig || {};
  const DEFAULT_LIST = 'My Wishlist';
  let guestToken;
  function guest() {
    if (guestToken) return guestToken;
    try { guestToken = localStorage.getItem('wishlist_guest_token'); } catch { /* memory fallback */ }
    if (!guestToken) {
      guestToken = crypto.randomUUID();
      try { localStorage.setItem('wishlist_guest_token', guestToken); } catch { /* memory fallback */ }
    }
    return guestToken;
  }
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
  }
  async function request(path, body) {
    const response = await fetch(`${cfg().proxyBase || '/apps/wishlist-stock/api'}/${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestToken: guest(), ...body }),
    } : undefined);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update your wishlist. Please try again.');
    return data;
  }
  function button(label, action) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'ws-btn ws-btn--small'; node.textContent = label;
    node.addEventListener('click', action);
    return node;
  }
  function notice(message, actionLabel, action, position = 'bottom-right') {
    document.getElementById('ws-feature-notice')?.remove();
    const box = document.createElement('div');
    box.id = 'ws-feature-notice'; box.className = 'ws-feature-notice';
    box.dataset.position = position; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    const text = document.createElement('p'); text.textContent = message; box.append(text);
    if (actionLabel) box.append(button(actionLabel, async (event) => {
      event.currentTarget.disabled = true;
      try { await action(); box.remove(); } catch (error) { text.textContent = error.message; event.currentTarget.disabled = false; }
    }));
    const close = button('Dismiss', () => box.remove()); box.append(close);
    document.body.append(box);
    // Actionable notices stay visible until dismissed, including Undo.
    if (!actionLabel) setTimeout(() => box.remove(), 7000);
  }
  let lists = [DEFAULT_LIST];
  let activeList = '';
  let listsRequest;
  const multi = () => settings().wishlistMode === 'multi';
  async function loadLists() {
    if (!multi()) return [DEFAULT_LIST];
    if (!listsRequest) listsRequest = request(`wishlist-lists?guest_token=${encodeURIComponent(guest())}`)
      .then((data) => { lists = data.lists; return lists; }).finally(() => { listsRequest = null; });
    return listsRequest;
  }
  function changed() {
    document.dispatchEvent(new CustomEvent('wishlist:changed'));
  }
  function refreshViews() {
    window.__wishlistStock?.renderPage();
    if (document.getElementById('ws-drawer')?.classList.contains('is-open')) window.__wishlistStock?.renderDrawer();
  }
  let pendingChoice = false;
  async function chooseList() {
    if (!multi()) return DEFAULT_LIST;
    if (pendingChoice) return null;
    pendingChoice = true;
    try {
      await loadLists();
      return await new Promise((resolve) => {
        const previous = document.activeElement;
        const dialog = document.createElement('dialog'); dialog.className = 'ws-feature-dialog';
        dialog.setAttribute('aria-labelledby', 'ws-list-choice-title');
        const heading = document.createElement('h2'); heading.id = 'ws-list-choice-title'; heading.textContent = 'Save to wishlist';
        const label = document.createElement('label'); label.textContent = 'Choose a wishlist';
        const select = document.createElement('select');
        lists.forEach((name) => select.add(new Option(name, name)));
        select.value = activeList || DEFAULT_LIST; label.append(select);
        const newLabel = document.createElement('label'); newLabel.textContent = 'Or create a new wishlist';
        const input = document.createElement('input'); input.maxLength = 60; input.placeholder = 'For example, Holiday'; newLabel.append(input);
        const status = document.createElement('p'); status.setAttribute('role', 'alert');
        let result = null;
        dialog.append(heading, label, newLabel, status, button('Save here', async (event) => {
          const name = input.value.trim() || select.value;
          event.currentTarget.disabled = true;
          try {
            if (input.value.trim()) lists = (await request('wishlist-lists', { operation: 'create', name })).lists;
            result = name; dialog.close();
          } catch (error) { status.textContent = error.message; event.currentTarget.disabled = false; }
        }), button('Cancel', () => dialog.close()));
        const footer = document.createElement('div'); footer.className = 'ws-dialog-actions';
        const controls = Array.from(dialog.querySelectorAll(':scope > button'));
        controls[0]?.classList.add('ws-btn--primary');
        footer.append(...controls.reverse()); dialog.append(footer);
        dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); resolve(result); }, { once: true });
        document.body.append(dialog); dialog.showModal();
      });
    } finally { pendingChoice = false; }
  }
  function manage(operation) {
    if (document.getElementById('ws-manage-list')) return;
    const name = activeList;
    if (operation !== 'create' && !name) return;
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'ws-manage-list'; dialog.className = 'ws-feature-dialog ws-manage-dialog';
    dialog.setAttribute('aria-labelledby', 'ws-manage-title');
    const header = document.createElement('div'); header.className = 'ws-dialog-heading';
    const heading = document.createElement('h2'); heading.id = 'ws-manage-title';
    heading.textContent = operation === 'create' ? 'Create a wishlist' : operation === 'rename' ? 'Rename wishlist' : 'Delete wishlist?';
    const close = button('×', () => dialog.close()); close.className = 'ws-dialog-close'; close.setAttribute('aria-label', 'Close dialog');
    header.append(heading, close);
    const description = document.createElement('p'); description.className = 'ws-dialog-description';
    description.textContent = operation === 'delete' ? `“${name}” will be deleted. Your saved items will move to My Wishlist.` : 'Give your collection a name that makes it easy to find.';
    const form = document.createElement('form');
    const label = document.createElement('label'); label.textContent = 'Wishlist name';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 60; input.required = true;
    input.placeholder = 'For example, Holiday favorites'; input.value = operation === 'rename' ? name : ''; label.append(input);
    const status = document.createElement('p'); status.className = 'ws-dialog-error'; status.setAttribute('role', 'alert');
    const footer = document.createElement('div'); footer.className = 'ws-dialog-actions';
    const cancel = button('Cancel', () => dialog.close());
    const submit = button(operation === 'create' ? 'Create wishlist' : operation === 'rename' ? 'Save name' : 'Delete wishlist', () => { });
    submit.type = 'submit'; submit.classList.add(operation === 'delete' ? 'ws-btn--danger' : 'ws-btn--primary');
    footer.append(cancel, submit);
    if (operation !== 'delete') form.append(label);
    form.append(status, footer); dialog.append(header, description, form);
    let saving = false;
    dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (saving) return;
      const value = input.value.trim();
      if (operation !== 'delete' && !value) { status.textContent = 'Enter a wishlist name.'; input.focus(); return; }
      if (operation === 'rename' && value === name) { dialog.close(); return; }
      saving = true;[submit, cancel, close, input].forEach((control) => { control.disabled = true; });
      const original = submit.textContent; submit.textContent = operation === 'delete' ? 'Deleting…' : 'Saving…'; status.textContent = '';
      try {
        lists = (await request('wishlist-lists', { operation, name: operation === 'create' ? value : name, newName: operation === 'rename' ? value : undefined })).lists;
        activeList = operation === 'delete' ? DEFAULT_LIST : value;
        dialog.close(); changed();
      } catch (error) { status.textContent = error.message; }
      finally { saving = false;[submit, cancel, close, input].forEach((control) => { control.disabled = false; }); submit.textContent = original; }
    });
    dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); else document.querySelector('.ws-list-toolbar select')?.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal();
    (operation === 'delete' ? cancel : input).focus();
    if (operation === 'rename') input.select();
  }
  async function toolbar(host) {
    if (!host) return;
    const panel = host.querySelector('[data-panel="wishlist"]') || host;
    let bar = host.querySelector('.ws-list-toolbar');
    let share = host.querySelector('[data-ws-share-trigger]');
    if (!multi()) {
      if (share && bar?.contains(share)) panel.prepend(share);
      bar?.remove(); return;
    }
    try { await loadLists(); } catch (error) { notice(error.message); return; }
    if (!multi()) return;
    bar = host.querySelector('.ws-list-toolbar') || bar;
    share = host.querySelector('[data-ws-share-trigger]') || share;
    if (activeList && !lists.includes(activeList)) activeList = '';
    if (!bar) { bar = document.createElement('div'); bar.className = 'ws-list-toolbar'; }
    if (bar.parentElement !== panel) panel.prepend(bar);
    bar.replaceChildren();
    const selector = document.createElement('div'); selector.className = 'ws-list-toolbar__selector';
    const label = document.createElement('label');
    const caption = document.createElement('span'); caption.textContent = 'Your wishlists'; label.append(caption);
    const select = document.createElement('select'); select.add(new Option('All wishlists', ''));
    lists.forEach((name) => select.add(new Option(name, name))); select.value = activeList;
    select.addEventListener('change', () => { activeList = select.value; changed(); }); label.append(select); selector.append(label);
    const actions = document.createElement('div'); actions.className = 'ws-list-toolbar__actions';
    if (activeList && activeList !== DEFAULT_LIST) {
      const rename = button('Rename', () => manage('rename')); rename.classList.add('ws-list-action');
      const remove = button('Delete list', () => manage('delete')); remove.classList.add('ws-list-action', 'ws-list-action--danger');
      actions.append(rename, remove);
    }
    const create = button('+ New wishlist', () => manage('create')); create.classList.add('ws-btn--primary'); actions.append(create);
    if (share) {
      const shareMenu = document.createElement('div'); shareMenu.className = 'ws-share-menu';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ws-share-menu-trigger';
      trigger.setAttribute('aria-label', 'Open wishlist share options');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = '<span aria-hidden="true">⋯</span>';
      const menu = document.createElement('div');
      menu.className = 'ws-share-menu-panel';
      menu.hidden = true;
      share.classList.add('ws-share-menu-item');
      share.hidden = true;
      menu.appendChild(share);
      trigger.addEventListener('click', () => {
        const isOpen = !menu.hidden;
        menu.hidden = isOpen;
        trigger.setAttribute('aria-expanded', String(!isOpen));
      });
      document.addEventListener('click', (event) => {
        if (!shareMenu.contains(event.target)) {
          menu.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
        }
      }, { capture: true });
      shareMenu.append(trigger, menu);
      actions.append(shareMenu);
    }
    bar.append(selector, actions);
    const heading = host.querySelector('.ws-page__section-head h2');
    if (heading) heading.textContent = activeList || 'All wishlists';
    document.dispatchEvent(new CustomEvent('wishlist:toolbar-ready'));
  }
  function decorate(container) {
    if (!container || !multi()) return;
    container.querySelectorAll('.ws-item, .ws-page-card').forEach((card) => {
      card.querySelector('.ws-move-list')?.remove();
    });
  }

  let started = false;
  let nudgeTimer;
  let productRun = 0;
  const viewed = new Set();
  async function productFeatures() {
    const run = ++productRun;
    clearTimeout(nudgeTimer);
    if (!cfg().uiConfig || window.Shopify?.designMode) return;
    const match = location.pathname.match(/\/products\/([^/]+)/);
    if (!match) return;
    const handle = decodeURIComponent(match[1]);
    const c = settings();
    if (!c.smartSave && !c.wishlistNudge) return;
    try {
      const data = await request(`wishlist?enrich=0&guest_token=${encodeURIComponent(guest())}`);
      if (run !== productRun) return;
      cfg().customerLoggedIn = data.loggedIn;
      const alreadySaved = data.items.some((item) => item.handle === handle);
      if (c.wishlistNudge && !alreadySaved && !read(`ws-nudge:${handle}`, false)) {
        nudgeTimer = setTimeout(() => {
          if (!settings().wishlistNudge || document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return;
          const heart = document.querySelector('.ws-pdp .wishlist-heart, .ws-product-block .wishlist-heart');
          if (!heart || heart.getAttribute('aria-pressed') === 'true') return;
          write(`ws-nudge:${handle}`, true);
          notice('Love this product? Save it to your wishlist and come back to it later.', 'Save to wishlist', () => heart.click());
        }, 12000);
      }
      if (!c.smartSave || (c.smartSaveLoggedInOnly !== false && !data.loggedIn) || (data.requiresLogin && !data.loggedIn)) return;
      const key = `ws-visits:${data.loggedIn ? cfg().customerId || 'customer' : guest()}:${handle}`;
      const previous = read(key, {});
      // A settings refresh may change the threshold without another page visit.
      // Re-evaluate eligibility, but only count this page once per shopper.
      const visits = Math.min(100, (Number(previous.visits) || 0) + (viewed.has(key) ? 0 : 1));
      viewed.add(key);
      write(key, { ...previous, visits });
      const threshold = Math.min(100, Math.max(1, Number(c.smartSaveVisits) || 5));
      if (alreadySaved || previous.dismissed || visits < threshold) return;
      const response = await fetch(`/products/${encodeURIComponent(handle)}.js`);
      if (!response.ok) return;
      const product = await response.json();
      if (run !== productRun) return;
      const selectedVariant = new URLSearchParams(location.search).get('variant') || document.querySelector('form[action*="/cart/add"] [name="id"]')?.value;
      const variant = String((product.variants?.find((item) => String(item.id) === selectedVariant) || product.variants?.[0])?.id || '');
      if (!variant) return;
      if (!settings().smartSave) return;
      const result = await request('wishlist', { productId: String(product.id), variantId: variant, handle, listName: DEFAULT_LIST });
      if (!result.created) return;
      clearTimeout(nudgeTimer); changed();
      const position = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(c.smartSavePosition) ? c.smartSavePosition : 'top-left';
      notice('Saved to your wishlist because you viewed this product several times.', 'Undo', async () => {
        await request('wishlist', { _method: 'DELETE', productId: String(product.id), variantId: variant, itemId: result.item.id });
        write(key, { visits, dismissed: true }); changed();
      }, position);
    } catch (error) {
      // Keep shopping usable, but make failed feature requests diagnosable.
      console.warn('[Wishlist] Product features could not run:', error.message);
    }
  }
  function saved() {
    if (settings().loginNudge && !cfg().customerLoggedIn && !read('ws-login-nudge', false)) {
      write('ws-login-nudge', true);
      notice('Sign in to keep your wishlist in your account and access it on other devices.', 'Sign in', () => {
        location.assign(`/account/login?return_url=${encodeURIComponent(location.pathname + location.search)}`);
      });
    } else if (settings().boostEngagement && !read('ws-engagement', false)) {
      write('ws-engagement', true);
      notice('Your favorites are saved. Open your wishlist any time to compare them and add them to your cart.');
    }
  }
  function tips() {
    document.querySelectorAll('.wishlist-heart').forEach((heart) => {
      if (settings().boostEngagement) {
        if (!heart.hasAttribute('title')) { heart.title = 'Save your favorites to revisit later'; heart.dataset.wsTip = 'true'; }
      } else if (heart.dataset.wsTip) { heart.removeAttribute('title'); delete heart.dataset.wsTip; }
    });
  }
  function boot() {
    if (started || !cfg().uiConfig) return;
    started = true; productFeatures(); tips();
  }
  document.addEventListener('wishlist:ready', boot);
  document.addEventListener('wishlist:config-updated', () => {
    if (started) { productFeatures(); tips(); }
    else boot();
  });
  // Catch up when assets load after the ready event, or config succeeds on retry.
  document.addEventListener('wishlist:config-ready', boot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('wishlist:item-added', saved);
  document.addEventListener('wishlist:changed', refreshViews);
  window.__wishlistFeatures = {
    guest, chooseList, toolbar, decorate, notice, changed, tips,
    selectedList: () => multi() ? activeList : '',
    filter: (items) => multi() && activeList ? items.filter((item) => (item.listName || DEFAULT_LIST) === activeList) : items,
  };
})();
