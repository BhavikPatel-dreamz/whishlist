/**
 * Wishlist heart button + storefront injection (Wishlist extension only).
 *
 * Responsibilities (all driven by the Wishlist App Embed, so the storefront works
 * with zero theme editing):
 *   1. Bind every `.wishlist-heart` to toggle the wishlist.
 *   2. Inject a wishlist link + counter into the theme header that opens the page.
 *   3. Inject a heart onto product cards; resolve the numeric product/variant id
 *      lazily via the storefront `/products/{handle}.js` endpoint.
 *   4. Inject a heart onto product pages when the block isn't manually placed.
 *
 * Back-in-stock notify buttons/modal are handled by the separate
 * "Back-in-Stock" extension. The Shopify app-embed toggle is the activation
 * gate; UIConfig must not be a second gate because Shopify does not send
 * theme-editor toggle changes through the app proxy.
 */
(function () {
  const CFG = () => window.__wishlist_stock || { proxyBase: '/apps/wishlist-stock/api', settings: {} };
  const on = (key, fallback = true) => {
    const s = CFG().settings || {};
    if (key in s) return !!s[key];
    return fallback;
  };

  const savedSettings = () => {
    const saved = CFG().uiConfig?.productCardConfig || {};
    const s = CFG().settings || {};
    if (!s.advancedSettings) return saved;
    return {
      ...saved, primaryColor: s.buttonBackground || '#000000',
      secondaryColor: s.buttonText || '#ffffff', collIconColor: s.buttonColor || '#000000', collThickness: s.iconThickness ?? 1.5,
      icon: s.iconType || 'heart', iconImage: s.iconImage
    };
  };
  const query = (root, selector) => {
    try { return selector ? root.querySelector(selector) : null; } catch { return null; }
  };

  const handleToIds = new Map(); // productHandle -> { productId, variantId }
  let scanScheduled = false;

  /* ---------- Guest-login policy ---------- */
  let wsLoggedIn = !!(CFG().settings && CFG().settings.customerLoggedIn) || !!CFG().customerEmail;
  let wsRequiresLogin = false;

  /* ---------- Lightweight toast ---------- */
  let wsToastTimer = null;
  function showToast(html) {
    let toast = document.getElementById('ws-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ws-toast';
      toast.className = 'ws-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.innerHTML = html;
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    if (wsToastTimer) clearTimeout(wsToastTimer);
    wsToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4000);
  }

  document.addEventListener('wishlist:item-removed', () => {
    showToast('Removed from wishlist');
  });

  function promptLogin() {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    showToast(
      'Please sign in to save items ' +
      `<a href="/account/login?return_url=${returnUrl}">Sign in</a>`,
    );
  }

  /* ---------- Guest token ---------- */
  function getGuestToken() {
    if (window.__wishlistFeatures) return window.__wishlistFeatures.guest();
    let t = localStorage.getItem('wishlist_guest_token');
    if (!t) {
      t = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      localStorage.setItem('wishlist_guest_token', t);
    }
    return t;
  }

  /* ---------- Resolve a product handle -> numeric ids (cached + in-flight deduped) ---------- */
  const inflightHandle = new Map();
  function resolveHandle(handle) {
    if (!handle) return Promise.resolve(null);
    if (handleToIds.has(handle)) return Promise.resolve(handleToIds.get(handle));
    if (inflightHandle.has(handle)) return inflightHandle.get(handle);
    const p = (async () => {
      try {
        const resp = await fetch(`/products/${handle}.js`);
        if (!resp.ok) return null;
        const prod = await resp.json();
        const ids = {
          productId: String(prod.id),
          variantId: prod.variants && prod.variants[0] ? String(prod.variants[0].id) : '',
        };
        handleToIds.set(handle, ids);
        return ids;
      } catch {
        return null;
      } finally {
        inflightHandle.delete(handle);
      }
    })();
    inflightHandle.set(handle, p);
    return p;
  }

  async function ensureIds(btn) {
    if (btn.dataset.productId) {
      return { productId: btn.dataset.productId, variantId: btn.dataset.variantId || '' };
    }
    const ids = await resolveHandle(btn.dataset.productHandle);
    if (ids) {
      btn.dataset.productId = ids.productId;
      if (!btn.dataset.variantId && ids.variantId) btn.dataset.variantId = ids.variantId;
    }
    return ids;
  }

  /* ---------- Header counter ---------- */
  const COUNT_CACHE_KEY = 'wishlist_count';
  function cachedCount() {
    try {
      const n = parseInt(localStorage.getItem(COUNT_CACHE_KEY) || '', 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }
  function applyCount(el, v) {
    el.textContent = String(v);
    el.dataset.count = String(v);
  }

  function applyThemeFromConfig() {
    if (!CFG().uiConfig) return;
    const s = CFG().settings || {};
    if (s.advancedSettings) {
      const root = document.documentElement;
      const values = {
        '--wl-primary': s.buttonBackground || '#000000', '--wl-secondary': s.buttonText || '#ffffff',
        '--ws-button-bg': s.buttonBackground || '#000000', '--ws-button-text': s.buttonText || '#ffffff',
        '--ws-primary': s.buttonColor || '#e74c3c', '--ws-bg': s.drawerBg || '#ffffff',
        '--ws-text': s.drawerText || '#1a1a1a', '--ws-border': s.borderColor || '#e5e7eb',
        '--ws-radius': (s.borderRadius ?? 8) + 'px'
      };
      Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
      return;
    }
    const panel = { ...(CFG().uiConfig.themeSettings || {}), ...savedSettings() };
    const source = panel && typeof panel === 'object' ? panel : {};
    const theme = {
      primaryColor: source.primaryColor || source.theme?.primaryColor || CFG().settings?.buttonColor || '#e74c3c',
      backgroundColor: source.secondaryColor || source.backgroundColor || source.theme?.backgroundColor || '#ffffff',
      textColor: source.textColor || source.theme?.textColor || '#1a1a1a',
      borderColor: source.borderColor || source.theme?.borderColor || '#e5e7eb',
      borderRadius: source.borderRadius ?? source.theme?.borderRadius ?? 8,
    };

    const root = document.documentElement;
    root.style.setProperty('--wl-primary', theme.primaryColor);
    root.style.setProperty('--wl-secondary', source.secondaryColor || '#ffffff');
    root.style.setProperty('--ws-button-bg', theme.primaryColor);
    root.style.setProperty('--ws-button-text', source.secondaryColor || '#ffffff');
    root.style.setProperty('--ws-primary', theme.primaryColor);
    root.style.setProperty('--ws-bg', theme.backgroundColor);
    root.style.setProperty('--ws-text', theme.textColor);
    root.style.setProperty('--ws-border', theme.borderColor);
    root.style.setProperty('--ws-radius', Number(theme.borderRadius ?? 8) + 'px');
  }

  function setCount(n) {
    const v = Math.max(0, n | 0);
    try { localStorage.setItem(COUNT_CACHE_KEY, String(v)); } catch { /* ignore */ }
    document.querySelectorAll('#ws-header-count, #ws-floating-count, [data-ws-menu-count]').forEach((el) => applyCount(el, v));
  }
  function getCount() {
    const el = document.getElementById('ws-header-count') || document.getElementById('ws-floating-count');
    if (!el) return cachedCount() || 0;
    const n = parseInt(el.dataset.count || el.textContent || '0', 10);
    return Number.isFinite(n) ? n : 0;
  }

  /* ---------- Heart state ---------- */
  function setHeartState(btn, inList) {
    btn.setAttribute('aria-pressed', inList ? 'true' : 'false');
    btn.classList.toggle('is-in-wishlist', !!inList);
    renderConfiguredButton(btn, inList);
  }

  let heartFetch = null;
  const HEART_TTL = 1500;
  function fetchHeartData() {
    const now = Date.now();
    if (heartFetch && now - heartFetch.at < HEART_TTL) return heartFetch.promise;
    const cfg = CFG();
    const params = new URLSearchParams({ guest_token: getGuestToken(), enrich: '0' });
    const promise = fetch(`${cfg.proxyBase}/wishlist?${params}`)
      .then((resp) => resp.json())
      .catch(() => null);
    heartFetch = { at: now, promise };
    return promise;
  }

  async function refreshHeartStates() {
    try {
      const data = await fetchHeartData();
      if (!data || !data.ok || !Array.isArray(data.items)) return;

      if (typeof data.requiresLogin === 'boolean') wsRequiresLogin = data.requiresLogin;
      if (typeof data.loggedIn === 'boolean') wsLoggedIn = data.loggedIn;

      const ids = new Set(data.items.map((i) => String(i.productId)));
      const handles = new Set(data.items.map((i) => i.handle).filter(Boolean));

      document.querySelectorAll('.wishlist-heart').forEach((btn) => {
        const inList =
          (btn.dataset.productId && ids.has(String(btn.dataset.productId))) ||
          (btn.dataset.productHandle && handles.has(btn.dataset.productHandle));
        setHeartState(btn, inList);
      });

      setCount(data.count !== undefined ? data.count : data.items.length);
    } catch {
      /* silent */
    }
  }

  async function sendWishlist(btn, add) {
    const cfg = CFG();
    const ids = await ensureIds(btn);
    if (!ids || !ids.productId) return null;

    const payload = { productId: ids.productId, guestToken: getGuestToken() };
    if (add && btn.dataset.wishlistList) payload.listName = btn.dataset.wishlistList;
    if (add) {
      payload.variantId = btn.dataset.variantId || ids.variantId || null;
      payload.handle = btn.dataset.productHandle || null;
    } else {
      payload._method = 'delete';
    }

    const resp = await fetch(`${cfg.proxyBase}/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.json();
  }

  async function syncButton(btn) {
    if (btn.__wsSyncing) { btn.__wsDirty = true; return; }
    btn.__wsSyncing = true;
    try {
      do {
        btn.__wsDirty = false;
        const desired = btn.classList.contains('is-in-wishlist');
        let data = null;
        try {
          data = await sendWishlist(btn, desired);
        } catch (err) {
          console.error('Wishlist error', err);
        }

        if (btn.__wsDirty) continue;

        if (data && data.ok) {
          heartFetch = null;
          setHeartState(btn, !!data.inWishlist);
          showToast(data.inWishlist ? 'Added to wishlist' : 'Removed from wishlist');
          document.dispatchEvent(new CustomEvent('wishlist:changed'));
          if (data.inWishlist) document.dispatchEvent(new CustomEvent('wishlist:item-added'));
          if (data.count !== undefined) setCount(data.count);
        } else {
          if (data && data.code === 'login_required') {
            wsRequiresLogin = true;
            wsLoggedIn = false;
            promptLogin();
          }
          setHeartState(btn, !desired);
          heartFetch = null;
          refreshHeartStates();
        }
      } while (btn.__wsDirty);
    } finally {
      btn.__wsSyncing = false;
    }
  }

  async function onHeartClick(btn) {
    if (btn.__wsSelecting) return;
    const next = !btn.classList.contains('is-in-wishlist');
    if (next && wsRequiresLogin && !wsLoggedIn) {
      promptLogin();
      return;
    }
    if (next && document.getElementById('ws-variant-selector')?.dataset.enabled === 'true' && !window.__wishlistVariantSelector) {
      showToast('Product options are still loading. Please try again.');
      return;
    }
    if (next && window.__wishlistVariantSelector) {
      btn.__wsSelecting = true;
      btn.setAttribute('aria-busy', 'true');
      try {
        const selected = await window.__wishlistVariantSelector.select(btn);
        if (selected === null) return;
        if (selected) {
          btn.dataset.productId = selected.productId;
          btn.dataset.variantId = selected.variantId;
        }
      } catch {
        showToast('Could not load product options. Please try again.');
        return;
      } finally {
        btn.__wsSelecting = false;
        btn.removeAttribute('aria-busy');
      }
    }
    if (next && window.__wishlistFeatures) {
      btn.__wsSelecting = true;
      try {
        const list = await window.__wishlistFeatures.chooseList();
        if (list === null) return;
        btn.dataset.wishlistList = list;
      } catch (error) {
        window.__wishlistFeatures.notice(error.message); return;
      } finally { btn.__wsSelecting = false; }
    }
    setHeartState(btn, next);
    setCount(getCount() + (next ? 1 : -1));
    if (next) {
      btn.classList.add('ws-just-added');
      setTimeout(() => btn.classList.remove('ws-just-added'), 340);
    }
    syncButton(btn);
  }

  function bindHeart(btn) {
    if (btn.__wishlistBound) return;
    btn.__wishlistBound = true;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.openDrawer) {
        if (window.__wishlistStock) window.__wishlistStock.openDrawer();
        return;
      }
      onHeartClick(btn);
    });
    if (!btn.dataset.productId && btn.dataset.productHandle) {
      const warm = () => { ensureIds(btn); };
      btn.addEventListener('pointerenter', warm, { once: true });
      btn.addEventListener('focus', warm, { once: true });
    }
  }

  /* ---------- Capture-phase guard for the heart tap ---------- */
  let cardClickGuardInstalled = false;
  function installCardClickGuard() {
    if (cardClickGuardInstalled) return;
    cardClickGuardInstalled = true;
    document.addEventListener(
      'click',
      (e) => {
        if (e.target && e.target.closest && e.target.closest('.wishlist-heart')) return;

        const x = e.clientX;
        const y = e.clientY;
        if (!x && !y) return;

        const hearts = document.querySelectorAll('.wishlist-heart');
        for (const btn of hearts) {
          const r = btn.getBoundingClientRect();
          if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (btn.dataset.openDrawer) {
              if (window.__wishlistStock) window.__wishlistStock.openDrawer();
            } else {
              onHeartClick(btn);
            }
            return;
          }
        }
      },
      true,
    );
  }

  // Only visual markup is accepted from the admin code editor. Preserve the
  // runtime button (and its identity/listeners) when changing its contents.
  function templateContents(markup, label) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    const allowed = new Set(['BUTTON', 'SPAN', 'DIV', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON', 'G', 'TITLE']);
    template.content.querySelectorAll('*').forEach((el) => {
      if (!allowed.has(el.tagName.toUpperCase())) { el.remove(); return; }
      Array.from(el.attributes).forEach((attr) => {
        if (!/^(class|viewBox|width|height|d|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|cx|cy|r|x|y|x1|y1|x2|y2|points|rx|ry|aria-hidden)$/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });
    const root = template.content.querySelector('button') || template.content;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) node.textContent = node.textContent.replace(/\{\{Wishlist(?:Add|Added)CTA\}\}/g, () => label);
    const holder = document.createElement('span');
    holder.append(...Array.from(root.childNodes));
    return holder.innerHTML;
  }

  function renderConfiguredButton(btn, inList) {
    const c = savedSettings();
    const card = btn.closest('.ws-card-heart');
    const label = inList ? (c.labelAfter || 'Added To Wishlist') : (c.labelBefore || 'Add To Wishlist');
    const signature = JSON.stringify([c, resolvedIconType(), !!card, !!inList]);
    if (btn.__wsVisualSignature === signature) return;
    btn.__wsVisualSignature = signature;
    btn.setAttribute('aria-label', label);
    const advanced = !card && c.activeMode === 'advanced';
    btn.classList.toggle('ws-configured-basic', !card && c.activeMode === 'basic');
    if (!card) {
      ['gap', 'margin', 'padding', 'border-radius', 'background', 'color', 'border'].forEach((property) => btn.style.removeProperty(property));
    }
    const markup = card ? c.collHtml : advanced ? (inList ? c.htmlAfter : c.htmlBefore) : null;
    btn.classList.toggle('wl-quick-save', !!card && !!markup);
    btn.classList.toggle('wl-icon-text', advanced && !!markup);
    if (markup) {
      btn.innerHTML = templateContents(markup, label);
      if (CFG().settings?.advancedSettings) {
        const icon = btn.querySelector('svg, img');
        if (icon) icon.outerHTML = wishlistIconMarkup();
      }
    } else {
      const type = card ? 'icon' : c.basicType || 'icon-text';
      btn.innerHTML = type === 'text' ? '' : wishlistIconMarkup(card ? 20 : 24);
      const text = document.createElement('span');
      text.className = type === 'icon' ? 'ws-sr-only' : 'ws-button-label';
      text.textContent = label;
      btn.appendChild(text);
    }
    if (CFG().settings?.advancedSettings) {
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.style.color = c.collIconColor;
        svg.style.stroke = 'currentColor';
        svg.style.strokeWidth = String(c.collThickness);
      }
    }
    if (card) {
      const position = c.collPosition || 'top-right';
      ['top', 'bottom', 'left', 'right'].forEach((side) => {
        card.style.setProperty('--ws-card-' + side, position.split('-').includes(side) ? '8px' : 'auto');
      });
      if (c.circularBg !== undefined) {
        card.style.setProperty('--ws-card-size', '32px');
        card.style.setProperty('--ws-card-bg', c.circularBg ? '#ffffff' : 'transparent');
        card.style.setProperty('--ws-card-shadow', c.circularBg ? '0 1px 4px rgba(0,0,0,.25)' : 'none');
        card.style.setProperty('--ws-card-border', '0');
        card.style.setProperty('--ws-card-blur', 'none');
      }
      btn.style.setProperty('position', 'static', 'important');
      if (c.collIconColor) btn.style.color = inList && !CFG().settings?.advancedSettings ? c.primaryColor || c.collIconColor : c.collIconColor;
      const svg = btn.querySelector('svg');
      if (svg && c.collThickness != null) svg.style.setProperty('--ws-card-stroke', String(c.collThickness));
    } else if (c.activeMode === 'basic') {
      btn.style.gap = '8px';
      btn.style.margin = '0';
      btn.style.padding = '12px 20px';
      btn.style.borderRadius = CFG().settings?.advancedSettings ? (CFG().settings.borderRadius ?? 8) + 'px' : '0';
      const solid = !c.basicStyle || c.basicStyle === 'solid';
      btn.style.background = solid ? c.primaryColor || '#000000' : 'transparent';
      btn.style.color = solid ? c.secondaryColor || '#ffffff' : c.primaryColor || '#000000';
      btn.style.border = c.basicStyle === 'outline' ? '1px solid currentColor' : '0';
    }
  }

  function placeProductButton(wrap, form) {
    const c = savedSettings();
    const scope = productPageScope(form);
    const anchor = form.closest('product-form') || form;
    let target = anchor;
    let position = 'afterend';
    if (c.activeMode === 'advanced') {
      if (c.advPosition === 'custom') {
        target = query(document, c.cssSelector);
        if (!target) return; // Wait for a matching section instead of using the wrong location.
        position = 'beforeend';
      } else if (c.advPosition === 'title') {
        target = query(scope, '.product__title, h1') || anchor;
      } else if (c.advPosition === 'overlay') {
        target = query(scope, '.product__media-wrapper, .product__media') || anchor;
        position = 'beforeend';
      }
    } else if (c.basicPlacement === 'on-image') {
      target = query(scope, '.product__media-wrapper, .product__media') || anchor;
      position = 'beforeend';
    } else if (c.basicPosition === 'above') {
      position = 'beforebegin';
    } else if (c.basicPosition === 'left' || c.basicPosition === 'right') {
      target = query(form, '[type="submit"]') || anchor;
      position = c.basicPosition === 'left' ? 'beforebegin' : 'afterend';
      wrap.style.display = 'inline-flex';
      wrap.style.verticalAlign = 'middle';
    }
    if (c.advPosition === 'overlay' && c.activeMode === 'advanced' || c.basicPlacement === 'on-image' && c.activeMode === 'basic') {
      target.classList.add('ws-heart-host');
      wrap.style.position = 'absolute';
      wrap.style.top = '12px';
      wrap.style.right = '12px';
      wrap.style.zIndex = '5';
    }
    target.insertAdjacentElement(position, wrap);
  }

  function applyLaunchSettings() {
    const c = savedSettings();
    const toggle = document.getElementById('ws-drawer-toggle');
    const header = document.getElementById('ws-header-link');
    const launchMode = c.launchFrom === 'header' || c.launchFrom === 'floating' || c.launchFrom === 'menu'
      ? c.launchFrom
      : 'floating';

    const showHeader = on('headerLink', false);
    const showFloating = launchMode === 'floating';
    const showMenu = launchMode === 'menu';

    if (header) {
      header.hidden = !showHeader;
      header.style.display = header.hidden ? 'none' : '';
    }

    if (toggle) {
      toggle.hidden = !showFloating;
      toggle.style.display = toggle.hidden ? 'none' : '';
      if (c.floatingPosition) {
        const left = c.floatingPosition.includes('left');
        const bottom = c.floatingPosition.includes('bottom');
        toggle.style.left = left ? '16px' : 'auto';
        toggle.style.right = left ? 'auto' : '16px';
        toggle.style.top = bottom ? 'auto' : '50%';
        toggle.style.bottom = bottom ? '16px' : 'auto';
      }
    }

    [header, toggle].filter(Boolean).forEach((link) => {
      if (link === header || c.pageType === 'page') link.removeAttribute('data-open-drawer');
      else if (c.pageType) link.setAttribute('data-open-drawer', '');
      if (link === header) link.href = CFG().settings.wishlistPageUrl || '/pages/wishlist';
      const iconSignature = JSON.stringify([resolvedIconType(), c.iconImage, CFG().uiConfig?.themeSettings?.iconImage, CFG().settings.iconImage]);
      if (link.__wsIcon !== iconSignature) {
        const old = link.querySelector('svg, img');
        if (old) old.remove();
        link.insertAdjacentHTML('afterbegin', wishlistIconMarkup(20));
        link.__wsIcon = iconSignature;
      }
      if (link === header || CFG().uiConfig) link.setAttribute('data-ws-ready', '');
    });

    if (toggle && c.showCount === true && !document.getElementById('ws-floating-count')) {
      const count = document.createElement('span');
      count.id = 'ws-floating-count';
      count.className = 'ws-count';
      applyCount(count, cachedCount() || 0);
      toggle.appendChild(count);
    }

    document.querySelectorAll('#ws-header-count, #ws-floating-count, [data-ws-menu-count]').forEach((count) => {
      count.hidden = c.showCount === false || showMenu;
      count.style.display = count.hidden ? 'none' : '';
    });

    if (toggle && !toggle.__wsPageNavigationBound) {
      toggle.__wsPageNavigationBound = true;
      toggle.addEventListener('click', () => {
        if (savedSettings().pageType === 'page') location.assign(CFG().settings.wishlistPageUrl);
      });
    }

    if (showMenu) {
      document.querySelectorAll('[data-ws-menu-item]').forEach((item) => item.remove());
      document.querySelectorAll('[data-ws-menu-managed]').forEach((link) => {
        const original = link.__wsOriginalLaunch;
        if (original) {
          link.setAttribute('href', original.href);
          if (original.drawer) link.setAttribute('data-open-drawer', '');
          else link.removeAttribute('data-open-drawer');
        }
        link.querySelector('[data-ws-menu-count]')?.remove();
        link.removeAttribute('data-ws-menu-managed');
        delete link.__wsOriginalLaunch;
      });
      applyMenuLaunch(c);
      return;
    }

    if (showHeader || showFloating) {
      document.querySelectorAll('[data-ws-menu-item]').forEach((item) => item.remove());
      document.querySelectorAll('[data-ws-menu-managed]').forEach((link) => {
        const original = link.__wsOriginalLaunch;
        if (original) {
          link.setAttribute('href', original.href);
          if (original.drawer) link.setAttribute('data-open-drawer', '');
          else link.removeAttribute('data-open-drawer');
        }
        link.querySelector('[data-ws-menu-count]')?.remove();
        link.removeAttribute('data-ws-menu-managed');
        delete link.__wsOriginalLaunch;
      });
    }

    applyMenuLaunch(c);
  }

  function applyMenuLaunch(c) {
    const pageUrl = CFG().settings.wishlistPageUrl || '/apps/wishlist-stock/wishlist';
    if (c.launchFrom !== 'menu') {
      document.querySelectorAll('[data-ws-menu-item]').forEach((item) => item.remove());
      document.querySelectorAll('[data-ws-menu-managed]').forEach((link) => {
        const original = link.__wsOriginalLaunch;
        if (original) {
          link.setAttribute('href', original.href);
          if (original.drawer) link.setAttribute('data-open-drawer', '');
          else link.removeAttribute('data-open-drawer');
        }
        link.querySelector('[data-ws-menu-count]')?.remove();
        link.removeAttribute('data-ws-menu-managed');
        delete link.__wsOriginalLaunch;
      });
      return;
    }
    // Dawn desktop and mobile navigation; never append links to arbitrary lists.
    document.querySelectorAll('.header__inline-menu > ul, .menu-drawer__navigation > .menu-drawer__menu').forEach((menu) => {
      let link = Array.from(menu.querySelectorAll('a[href]')).find((a) => {
        try {
          const url = new URL(a.href, location.href);
          return url.origin === location.origin && [pageUrl, '/pages/wishlist'].includes(url.pathname);
        } catch { return false; }
      });
      if (!link) {
        const item = document.createElement('li');
        item.setAttribute('data-ws-menu-item', '');
        link = document.createElement('a');
        link.className = menu.classList.contains('menu-drawer__menu')
          ? 'menu-drawer__menu-item list-menu__item link link--text focus-inset'
          : 'header__menu-item list-menu__item link link--text focus-inset';
        link.textContent = 'Wishlist';
        item.appendChild(link);
        menu.appendChild(item);
      }
      if (!link.closest('[data-ws-menu-item]') && !link.__wsOriginalLaunch) {
        link.__wsOriginalLaunch = { href: link.getAttribute('href'), drawer: link.hasAttribute('data-open-drawer') };
        link.setAttribute('data-ws-menu-managed', '');
      }
      link.href = pageUrl;
      if (c.pageType === 'drawer' || c.pageType === 'modal') link.setAttribute('data-open-drawer', '');
      else link.removeAttribute('data-open-drawer');
      let count = link.querySelector('[data-ws-menu-count]');
      if (!count) {
        count = document.createElement('span');
        count.setAttribute('data-ws-menu-count', '');
        count.style.marginInlineStart = '6px';
        applyCount(count, cachedCount() || 0);
        link.appendChild(count);
      }
      count.hidden = c.showCount === false;
      count.style.display = count.hidden ? 'none' : '';
    });
  }

  function refreshConfiguredUI() {
    const c = savedSettings();
    let style = document.getElementById('ws-saved-button-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ws-saved-button-styles';
      document.head.appendChild(style);
    }
    style.textContent = (c.activeMode === 'advanced' ? c.css || '' : '') + '\n' + (c.collCss || '').replace(/\.wl-quick-save\b/g, '.ws-card-heart.ws-card-heart');
    if (c.quickSaveEnabled === false) document.querySelectorAll('.ws-card-heart').forEach((el) => el.remove());
    const pdp = document.getElementById('ws-pdp');
    if (pdp && pdpBoundForm) {
      pdp.removeAttribute('style');
      const button = pdp.querySelector('.wishlist-heart');
      if (button) button.removeAttribute('style');
      placeProductButton(pdp, pdpBoundForm);
    }
    enhance();
  }

  /* ---------- Injection: header link + counter ---------- */
  function resolvedIconType() {
    const cfg = CFG();
    const savedTheme = (cfg.uiConfig && (cfg.uiConfig.themeSettings || {})) || {};
    const savedProduct = (cfg.uiConfig && (cfg.uiConfig.productCardConfig || {})) || {};
    const themeIcon = savedProduct.icon || savedProduct.iconType || savedTheme.iconType || savedTheme.icon;
    const blockIcon = cfg.settings && cfg.settings.iconType;
    const iconType = cfg.settings?.advancedSettings ? blockIcon || 'heart' : themeIcon || blockIcon || 'heart';
    return (iconType === 'bookmark' || iconType === 'star' || iconType === 'heart' || iconType === 'image') ? iconType : 'heart';
  }

  function wishlistIconMarkup(size) {
    const s = CFG().settings || {};
    const uiConfig = CFG().uiConfig || {};
    const productCfg = (uiConfig.productCardConfig && typeof uiConfig.productCardConfig === 'object') ? uiConfig.productCardConfig : {};
    const themeCfg = (uiConfig.themeSettings && typeof uiConfig.themeSettings === 'object') ? uiConfig.themeSettings : {};
    const iconType = resolvedIconType();
    const imageUrl = s.advancedSettings ? s.iconImage || '' : productCfg.iconImage || themeCfg.iconImage || s.iconImage || '';
    const dimension = s.buttonSize || size || 22;

    if (iconType === 'image' && imageUrl) {
      return `<img src="${imageUrl}" alt="Wishlist" width="${dimension}" height="${dimension}" style="width:${dimension}px;height:${dimension}px;" />`;
    }

    const paths = {
      heart: '<path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z"/>',
      star: '<path d="m12 3 2.8 5.67 6.26.91-4.53 4.41 1.07 6.23L12 17.28l-5.6 2.94 1.07-6.23-4.53-4.41 6.26-.91L12 3z"/>',
      bookmark: '<path d="M6 3h12v18l-6-3.5L6 21V3z"/>',
    };
    return `<svg width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[iconType] || paths.heart}</svg>`;
  }

  function renderHeaderIconMarkup() {
    const s = CFG().settings || {};
    const size = Math.max(14, Number(s.buttonSize) || 20);
    return wishlistIconMarkup(size);
  }

  function injectHeaderLink() {
    if (!on('headerLink', false)) {
      const existing = document.getElementById('ws-header-link');
      if (existing) existing.remove();
      return;
    }
    const host = Array.from(document.querySelectorAll(
      '.header__icons, [class*="header__icons"], .site-header__icons, .header-icons'
    )).find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // A header outside the viewport is still the correct host when scrolling.
      return rect.width > 0 && rect.height > 0 &&
        style.visibility !== 'hidden' && style.display !== 'none';
    });
    let link = document.getElementById('ws-header-link');
    if (link) {
      link.classList.toggle('ws-header-link--floating', !host);
      const parent = host || document.body;
      if (link.parentElement !== parent) parent.appendChild(link);
      return;
    }

    link = document.createElement('a');
    link.href = CFG().settings.wishlistPageUrl || '/pages/wishlist';
    link.id = 'ws-header-link';
    link.className = 'ws-header-link header__icon header__icon--summary link focus-inset';
    link.setAttribute('aria-label', 'My Wishlist');
    link.innerHTML = renderHeaderIconMarkup();

    let counter = document.getElementById('ws-header-count');
    if (!counter) {
      counter = document.createElement('span');
      counter.id = 'ws-header-count';
      counter.dataset.count = '0';
    }
    const cc = cachedCount();
    if (cc !== null && (!counter.dataset.count || counter.dataset.count === '0')) {
      applyCount(counter, cc);
    }
    counter.classList.remove('ws-sr-only');
    counter.classList.add('ws-count');
    link.appendChild(counter);

    link.classList.toggle('ws-header-link--floating', !host);
    if (!host) {
      document.body.appendChild(link);
      return;
    }
    const cart =
      host.querySelector('#cart-icon-bubble') ||
      host.querySelector('a[href$="/cart"], a[href*="/cart?"]');
    if (cart && cart.parentElement === host) host.insertBefore(link, cart);
    else host.appendChild(link);
  }

  /* ---------- Injection: hearts on product cards ---------- */
  function ensureCardStyles() {
    if (document.getElementById('ws-card-heart-style')) return;
    const style = document.createElement('style');
    style.id = 'ws-card-heart-style';
    style.textContent = `
      .card-wrapper, .card, .ws-heart-host { position: relative; }

      .ws-card-heart {
        position: absolute;
        top: var(--ws-card-top, 10px);
        right: var(--ws-card-right, 10px);
        left: var(--ws-card-left, auto);
        bottom: var(--ws-card-bottom, auto);
        z-index: 5;
        width: var(--ws-card-size, 36px);
        height: var(--ws-card-size, 36px);
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: var(--ws-card-bg, rgba(255, 255, 255, 0.9));
        -webkit-backdrop-filter: var(--ws-card-blur, blur(6px));
        backdrop-filter: var(--ws-card-blur, blur(6px));
        border: var(--ws-card-border, 1px solid rgba(0, 0, 0, 0.06));
        box-shadow: var(--ws-card-shadow, 0 2px 8px rgba(0, 0, 0, 0.12));
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-4px) scale(0.9);
        animation: ws-heart-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                    box-shadow 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
      }

      @keyframes ws-heart-in {
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .card-wrapper:hover .ws-card-heart,
      .card:hover .ws-card-heart { box-shadow: var(--ws-card-shadow, 0 5px 16px rgba(0, 0, 0, 0.22)); }

      .ws-card-heart:hover { transform: scale(1.1); background: var(--ws-card-bg, #fff); }
      .ws-card-heart:active { transform: scale(0.92); }

      .ws-card-heart .wishlist-heart {
        cursor: pointer;
        background: none;
        border: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #33373d;
        border-radius: 50%;
      }

      .ws-card-heart svg { stroke-width: var(--ws-card-stroke, 1.8); }

      .ws-card-heart .wishlist-heart:hover {
        transform: none;
        background: none;
        color: var(--ws-primary, #e74c3c);
      }

      .ws-card-heart .wishlist-heart[aria-pressed="true"] { color: var(--ws-primary, #e74c3c); }
      .ws-card-heart:has(.wishlist-heart[aria-pressed="true"]) {
        background: var(--ws-card-bg, rgba(231, 76, 60, 0.12));
        border-color: rgba(231, 76, 60, 0.28);
      }

      .wishlist-heart.ws-just-added svg { animation: ws-heart-pop 0.32s ease; }
      @keyframes ws-heart-pop {
        0% { transform: scale(1); }
        45% { transform: scale(1.35); }
        100% { transform: scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .ws-card-heart { animation: none; opacity: 1; transform: none; transition: none; }
        .ws-card-heart:hover, .ws-card-heart:active { transform: none; }
        .wishlist-heart.ws-just-added svg { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function handleFromCard(card) {
    const link = query(card, savedSettings().collProductSelector) || card.querySelector('a[href*="/products/"]');
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function cardHeartHost(card) {
    const media =
      card.querySelector('.card__inner') ||
      card.querySelector('.card__media') ||
      card.querySelector('.media');
    if (media && media.querySelector('img')) return media;
    const img = card.querySelector('img');
    const wrap = img && img.closest('a, figure, div');
    if (wrap && wrap !== card && card.contains(wrap)) return wrap;
    return card;
  }

  function injectCardHearts() {
    ensureCardStyles();
    if (savedSettings().quickSaveEnabled === false) return;

    const cards = new Set();
    try {
      if (savedSettings().collButtonSelector) document.querySelectorAll(savedSettings().collButtonSelector).forEach((c) => cards.add(c));
    } catch { /* An invalid custom selector must not break other wishlist controls. */ }
    if (!cards.size) document.querySelectorAll('.card-wrapper').forEach((c) => cards.add(c));
    document.querySelectorAll('.card').forEach((c) => {
      if (!c.closest('.card-wrapper') && !Array.from(cards).some((parent) => parent.contains(c) || c.contains(parent))) cards.add(c);
    });

    cards.forEach((card) => {
      const host = cardHeartHost(card);
      const existing = card.querySelector('.wishlist-heart');
      if (existing) {
        if (existing.closest('.ws-card-heart')) return;
        if (!existing.dataset.productId && !existing.dataset.productHandle) {
          const h = handleFromCard(card);
          if (h) existing.dataset.productHandle = h;
        }
        host.classList.add('ws-heart-host');
        const chip = document.createElement('div');
        chip.className = 'ws-card-heart';
        host.appendChild(chip);
        chip.appendChild(existing);
        return;
      }

      const handle = handleFromCard(card);
      if (!handle) return;

      host.classList.add('ws-heart-host');

      const wrap = document.createElement('div');
      wrap.className = 'ws-card-heart';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wishlist-heart';
      btn.dataset.productHandle = handle;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = wishlistIconMarkup(20) + '<span class="ws-sr-only">Add to wishlist</span>';
      wrap.appendChild(btn);
      host.appendChild(wrap);
    });
  }

  /* ---------- Injection: product-page heart (no notify — that's the BIS ext) ---------- */
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

  function productPageScope(form) {
    return (
      form.closest('.shopify-section') ||
      form.closest('section') ||
      form.closest('main') ||
      document.body
    );
  }

  let pdpBoundForm = null;
  async function injectProductPage() {
    if (!on('productButton')) return;
    const handle = pdpHandle();
    if (!handle) return;
    if (document.querySelector('.ws-product-block')) return;
    const form = mainProductForm();
    if (!form) return;
    if (pdpBoundForm?.isConnected) return;
    pdpBoundForm = null;

    const scope = productPageScope(form);

    // Theme section events can fire while the product JSON request is pending.
    // Reuse the first existing PDP heart instead of creating another one.
    const existingPdpHearts = Array.from(scope.querySelectorAll('.ws-pdp .wishlist-heart'));
    if (existingPdpHearts.length) {
      existingPdpHearts.slice(1).forEach((heart) => {
        const wrapper = heart.closest('.ws-pdp');
        if (wrapper) wrapper.remove();
      });
      bindHeart(existingPdpHearts[0]);
      pdpBoundForm = form;
      return;
    }

    // If the theme or a merchant has already placed a wishlist button on the
    // product page, avoid injecting another one to prevent duplicate hearts on
    // the PDP.
    if (scope.querySelector('.ws-pdp .wishlist-heart, .ws-product-block .wishlist-heart, form[action*="/cart/add"] .wishlist-heart')) {
      pdpBoundForm = form;
      return;
    }

    // Reserve this form before awaiting the product lookup. This prevents
    // concurrent MutationObserver callbacks from inserting duplicate hearts.
    pdpBoundForm = form;

    let product = null;
    try {
      const resp = await fetch(`/products/${handle}.js`);
      if (resp.ok) product = await resp.json();
    } catch { /* non-fatal */ }

    const pid = product ? String(product.id) : '';
    const vid =
      currentVariantId(form) ||
      (product && product.variants && product.variants[0] ? String(product.variants[0].id) : '');

    const wrap = document.createElement('div');
    wrap.className = 'ws-pdp';
    wrap.id = 'ws-pdp';
    wrap.dataset.productHandle = handle;
    wrap.innerHTML =
      '<button class="wishlist-heart" type="button"' +
      (pid ? ` data-product-id="${pid}"` : '') +
      (vid ? ` data-variant-id="${vid}"` : '') +
      ` data-product-handle="${handle}" aria-pressed="false">` +
      wishlistIconMarkup(24) + '<span class="ws-sr-only">Add to wishlist</span></button>';

    placeProductButton(wrap, form);
    if (!wrap.isConnected) {
      pdpBoundForm = null;
      return;
    }

    const heart = wrap.querySelector('.wishlist-heart');
    if (heart) {
      bindHeart(heart);
      renderConfiguredButton(heart, false);
    }
    refreshHeartStates();

    if (!form.__wsWishlistBound) {
      form.__wsWishlistBound = true;
      form.addEventListener('change', () => {
        setTimeout(() => {
          const h = wrap.querySelector('.wishlist-heart');
          const nv = currentVariantId(form);
          if (h && nv) h.dataset.variantId = nv;
        }, 60);
      });
    }
  }

  /* ---------- Enhance: inject + bind + refresh ---------- */
  function enhance() {
    applyThemeFromConfig();
    injectHeaderLink();
    applyLaunchSettings();
    if (on('cardHearts', true)) injectCardHearts();
    injectProductPage();
    document.querySelectorAll('.wishlist-heart').forEach((btn) => {
      bindHeart(btn);
      renderConfiguredButton(btn, btn.getAttribute('aria-pressed') === 'true');
    });
    refreshHeartStates();
    window.__wishlistFeatures?.tips();
  }

  function scheduleEnhance() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      enhance();
    }, 150);
  }

  function boot() {
    const start = () => {
      document.addEventListener('wishlist:config-updated', refreshConfiguredUI);
      document.addEventListener('wishlist:launcher-ready', applyLaunchSettings);
      installCardClickGuard();
      refreshConfiguredUI();

      document.addEventListener('shopify:section:load', scheduleEnhance);
      let headerFrame = null;
      const updateHeaderPlacement = () => {
        if (headerFrame !== null) return;
        headerFrame = requestAnimationFrame(() => {
          headerFrame = null;
          injectHeaderLink();
          applyLaunchSettings();
        });
      };
      window.addEventListener('scroll', updateHeaderPlacement, { passive: true });
      window.addEventListener('resize', updateHeaderPlacement);
      const grid =
        document.getElementById('ProductGridContainer') || document.querySelector('main') || document.body;
      if (window.MutationObserver && grid) {
        new MutationObserver(scheduleEnhance).observe(grid, { childList: true, subtree: true });
      }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  document.addEventListener('wishlist:changed', () => { heartFetch = null; refreshHeartStates(); });
  document.addEventListener('wishlist:item-removed', () => { heartFetch = null; refreshHeartStates(); });
  boot();
})();
