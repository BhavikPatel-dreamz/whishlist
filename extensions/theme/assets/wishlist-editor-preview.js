/* Reveal the UI being configured, only inside Shopify's theme editor. */
(function () {
  if (!window.Shopify?.designMode) return;
  const marker = document.getElementById('ws-editor-preview-config');
  if (!marker || window.__wsEditorPreviewBound) return;
  window.__wsEditorPreviewBound = true;

  const settings = JSON.parse(marker.dataset.settings);
  const storageKey = `ws-editor-preview:${marker.dataset.blockId}`;
  let previous = null;
  try {
    previous = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    sessionStorage.setItem(storageKey, JSON.stringify(settings));
  } catch (_) { /* Preview still works when browser storage is unavailable. */ }
  const changed = (key) => previous && previous[key] !== settings[key];
  const wishlistSettingsChanged = previous && Object.keys(settings).some(changed);
  let selected = false;
  let toastTimer;

  function reveal() {
    const api = window.__wishlistStock;
    if (!api) return;

    api.closeDrawer();
    const pageUrl = window.__wishlist_stock?.settings?.wishlistPageUrl;
    let url;
    try {
      url = pageUrl && new URL(pageUrl, location.origin);
    } catch (_) { return; }
    if (!url || url.origin !== location.origin) return;
    const normalize = (path) => path.replace(/\/+$/, '') || '/';
    if (normalize(url.pathname) !== normalize(location.pathname)) {
      // Retain the selected theme when navigating within the editor iframe.
      const previewTheme = new URLSearchParams(location.search).get('preview_theme_id');
      if (previewTheme) url.searchParams.set('preview_theme_id', previewTheme);
      location.assign(url.href);
      return;
    }

    document.getElementById('ws-editor-sample')?.remove();
    document.getElementById('ws-wishlist-page')?.scrollIntoView({ block: 'start' });

    if (changed('notification_alignment') && settings.advanced_settings) {
      document.getElementById('ws-editor-toast')?.remove();
      const toast = document.createElement('div');
      toast.id = 'ws-editor-toast';
      toast.className = 'ws-toast is-visible';
      toast.textContent = 'Wishlist notification preview';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.remove(), 5000);
    }
  }

  // Other embeds share this page. Loading their preview must not navigate
  // away from the home/product page where the variant popup is being edited.
  document.addEventListener('wishlist:ready', () => {
    if (selected || wishlistSettingsChanged) reveal();
  }, { once: true });
  document.addEventListener('shopify:block:select', (event) => {
    selected = String(event.detail?.blockId) === marker.dataset.blockId;
    if (selected) reveal();
  });
  document.addEventListener('shopify:block:deselect', (event) => {
    if (String(event.detail?.blockId) !== marker.dataset.blockId) return;
    selected = false;
    window.__wishlistStock?.closeDrawer();
    document.getElementById('ws-editor-toast')?.remove();
  });
})();
