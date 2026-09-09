(function () {
    function heartSvg() {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.716-4.434-9.333-7.14C-1.333 10.9 1.333 6 6 6c2.76 0 4 2 6 2s3.24-2 6-2c4.667 0 7.333 4.9 3.333 7.86C18.716 16.566 12 21 12 21z"/></svg>';
    }

    function createToggle() {
        if (document.getElementById('ws-drawer-toggle')) return;
        // If header link exists, do not create duplicate toggle
       

        var btn = document.createElement('button');
        btn.id = 'ws-drawer-toggle';
        btn.className = 'ws-drawer-toggle';
        btn.setAttribute('aria-label', 'Open wishlist');
        btn.setAttribute('data-open-drawer', '');
        btn.innerHTML = heartSvg();
        document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createToggle);
    else createToggle();
})();
