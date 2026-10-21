import { useState, type ReactNode } from 'react';
import { MultiWishlistConfirmation } from './MultiWishlistConfirmation';
import type { WishlistConfig } from '../routes/app.settings';

type Props = { onMultiWishlistEnabled: () => void; config: WishlistConfig; onChange: <K extends keyof WishlistConfig>(key: K, value: WishlistConfig[K]) => void; onBack: () => void; onSave: () => void; saving: boolean };
export function SmartSaveSettings({ config: c, onChange: set, onBack, onSave, saving, onMultiWishlistEnabled }: Props) {
  const [confirmMulti, setConfirmMulti] = useState(false);
  const multiEnabled = c.wishlistMode === 'multi';
  const check = (key: 'smartSave' | 'allowShare' | 'smartSaveLoggedInOnly' | 'boostEngagement' | 'loginNudge' | 'wishlistNudge' | 'worksWithoutCookies' | 'askPermission', label: string, description?: string, children?: ReactNode) => (
    <div className="ss-row"><label className="ss-check"><input type="checkbox" checked={c[key]} onChange={e => set(key, e.target.checked)} disabled={saving} /><span>{label}</span></label>{description && <p>{description}</p>}{children}</div>
  );
  return <div className="ss-page">
    {confirmMulti && <MultiWishlistConfirmation onClose={() => setConfirmMulti(false)} onEnabled={onMultiWishlistEnabled} />}
    <nav aria-label="Breadcrumb"><button onClick={onBack} disabled={saving}>Features</button><span>/</span><strong>Settings</strong></nav>
    <section className="ss-section"><aside><h2>Features</h2><p>Set up personalized experiences for shoppers based on their wishlist items.</p></aside><div className="ss-stack">
      <div className="ss-card"><h2>Wishlist Configuration</h2><p>Choose how your customers organize and manage their wishlists.</p><div className="ss-choices">
        <label className={`ss-choice ${c.wishlistMode !== "multi" ? "selected" : ""}`}><input type="radio" checked={c.wishlistMode !== "multi"} onChange={() => set("wishlistMode", "single")} disabled={saving || multiEnabled} name="wishlist-mode" /><strong>Single Wishlist</strong><p>Shoppers save all items to one list. Best for small catalogs.</p></label>
        <label className={`ss-choice ${c.wishlistMode === "multi" ? "selected" : ""}`}><input type="radio" checked={c.wishlistMode === "multi"} onChange={() => setConfirmMulti(true)} disabled={saving} name="wishlist-mode" /><strong>Multi Wishlist</strong><p>Shoppers organize items into custom lists (e.g., “Bedroom”, “Holiday”). Best for large catalogs.</p></label>
      </div>{multiEnabled && <p className="ss-note" role="status">Multi-Wishlist is enabled. Shoppers can now create and manage their own lists. Switching back to Single Wishlist is unavailable.</p>}</div>
      <div className="ss-card"><h2>Features</h2><div className="ss-group">
        {check('allowShare', 'Allow shoppers to share their wishlists', 'Shoppers can share their wishlist through email or social media.')}
        {check('smartSave', "SmartSave: Auto-save high-interest products to a shopper’s wishlist", undefined, c.smartSave && <div className="ss-details">
          <label>Add a product to the wishlist if a shopper visits the product page <input aria-label="Product page visits" type="number" min="1" max="100" value={c.smartSaveVisits} disabled={saving} onChange={e => set('smartSaveVisits', Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /> times.</label>
          <label>Display a notification in the <select aria-label="Smart Save notification position" value={c.smartSavePosition} disabled={saving} onChange={e => set('smartSavePosition', e.target.value as WishlistConfig['smartSavePosition'])}>{['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(v => <option key={v} value={v}>{v.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}</option>)}</select> position on the site, with an undo option.</label>
          <label className="ss-check"><input type="checkbox" checked={c.smartSaveLoggedInOnly} disabled={saving} onChange={e => set('smartSaveLoggedInOnly', e.target.checked)} />Limit Smart Save to logged-in shoppers only</label>
        </div>)}
        {check('boostEngagement', 'Boost wishlist engagement', 'Show subtle, non-intrusive tooltips and toasts that guide new shoppers on how and why to use their wishlist.')}
        {check('loginNudge', 'Login nudge', 'Prompt guest shoppers to sign in so their wishlist is saved to their account.')}
        {check('wishlistNudge', 'Wishlist nudge popup', 'Show a popup on the product page encouraging shoppers to save items to their wishlist.')}
      </div></div>
    </div></section>
    <footer className="ss-footer"><button onClick={onBack} disabled={saving}>Cancel</button><button className="ss-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
  </div>;
}
