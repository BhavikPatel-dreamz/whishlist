(function () {
  let dialog;
  function trackShare(mode) {
    const cfg = window.__wishlist_stock || {};
    return fetch(`${cfg.proxyBase}/wishlist-share`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }), keepalive: true,
    }).then((response) => { if (!response.ok) throw new Error('Share tracking failed'); });
  }

  function mount() {
    const cfg = window.__wishlist_stock || {};
    const page = document.getElementById('ws-wishlist-page');
    if (!page || !cfg.customerLoggedIn || document.getElementById('ws-share-trigger')) return;
    const trigger = document.createElement('button');
    trigger.id = 'ws-share-trigger';
    trigger.type = 'button';
    trigger.className = 'ws-btn';
    trigger.textContent = 'Share Wishlist';
    page.prepend(trigger);
    trigger.addEventListener('click', async () => {
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.className = 'ws-share-dialog';
        dialog.setAttribute('aria-labelledby', 'ws-share-title');
        dialog.innerHTML = '<form method="dialog"><button class="ws-share-close" aria-label="Close share dialog">×</button></form><h2 id="ws-share-title">Share via</h2><div class="ws-share-options" hidden><button type="button" class="ws-share-action ws-share-copy">Copy Link</button><a class="ws-share-action ws-share-facebook" target="_blank" rel="noopener noreferrer"><span class="ws-share-facebook-icon" aria-hidden="true">f</span>Facebook</a><a class="ws-share-action ws-share-x" aria-label="Share on X" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">𝕏</span></a></div><p role="status" class="ws-share-status"></p><label class="ws-share-fallback" hidden>Share link<input class="ws-share-url" readonly></label>';
        document.body.appendChild(dialog);
        dialog.addEventListener('close', () => trigger.focus());
        ['facebook', 'x'].forEach((mode) => {
          dialog.querySelector(`.ws-share-${mode}`).addEventListener('click', () => {
            void trackShare(mode).catch(() => { dialog.querySelector('.ws-share-status').textContent = 'Share opened, but the report could not be updated.'; });
          });
        });
        dialog.querySelector('.ws-share-copy').addEventListener('click', async () => {
          const input = dialog.querySelector('.ws-share-url');
          try {
            await navigator.clipboard.writeText(input.value);
            dialog.querySelector('.ws-share-status').textContent = 'Wishlist link copied.';
            void trackShare('copylink').catch(() => { dialog.querySelector('.ws-share-status').textContent = 'Link copied, but the report could not be updated.'; });
          } catch {
            dialog.querySelector('.ws-share-fallback').hidden = false;
            input.focus(); input.select();
            dialog.querySelector('.ws-share-status').textContent = 'Copy the selected link to share your wishlist.';
          }
        });
      }
      dialog.querySelector('.ws-share-options').hidden = true;
      dialog.querySelector('.ws-share-fallback').hidden = true;
      const status = dialog.querySelector('.ws-share-status');
      status.textContent = 'Creating share link…';
      dialog.showModal();
      trigger.disabled = true;
      try {
        const response = await fetch(`${cfg.proxyBase}/wishlist-share`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.code === 'login_required' ? 'Please log in to share your wishlist.' : 'Could not create a share link. Please try again.');
        const url = new URL(`${cfg.proxyBase.replace(/\/api\/?$/, '')}/share/${encodeURIComponent(result.token)}`, location.origin).href;
        dialog.querySelector('.ws-share-url').value = url;
        dialog.querySelector('.ws-share-facebook').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
        dialog.querySelector('.ws-share-x').href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`;
        dialog.querySelector('.ws-share-options').hidden = false;
        status.textContent = '';
      } catch (error) { status.textContent = error.message; }
      finally { trigger.disabled = false; }
    });
  }
  document.addEventListener('wishlist:page-ready', mount);
  document.addEventListener('wishlist:ready', mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
