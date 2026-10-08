import type { ReactNode } from 'react';
import type { WishlistConfig } from '../routes/app.settings';
import './SmartSaveSettings.css';

type Props = { config: WishlistConfig; onChange: <K extends keyof WishlistConfig>(key: K, value: WishlistConfig[K]) => void; onBack: () => void; onSave: () => void; saving: boolean };
const alertGroups = [
  { title: 'Acknowledgements', rows: [['Sign up confirmation', 'Send a confirmation when shoppers save their wishlist.'], ['Item added to wishlist', 'Send an alert when shoppers add items to their wishlist.'], ['Wishlist Shared', 'Send an alert when shoppers share their wishlist with others.']] },
  { title: 'Reminders', rows: [['Wishlist Reminder', 'Send reminders for wishlisted items after', '24', 'hours'], ['Send reminders on Items Saved for Later', 'Send reminders for items saved for later after', '24', 'hours'], ['Frequently Browsed Products', 'Send reminders for products shoppers have viewed frequently after', '5', 'views']] },
  { title: 'Alerts & Triggers on wishlist items', rows: [['Send low stock Alerts', 'Send an alert when the stock drops below', '10', 'units'], ['Send Price Drop alert', 'Send an alert when the price drops by', '10', '%'], ['Send Back in stock alerts', 'Send an alert when wishlisted items are back in stock.']] },
];
export function SmartSaveSettings({ config: c, onChange: set, onBack, onSave, saving }: Props) {
  const check = (key: 'smartSave' | 'allowShare' | 'smartSaveLoggedInOnly' | 'boostEngagement' | 'loginNudge' | 'wishlistNudge' | 'worksWithoutCookies' | 'askPermission', label: string, description?: string, children?: ReactNode) => (
    <div className="ss-row"><label className="ss-check"><input type="checkbox" checked={c[key]} onChange={e => set(key, e.target.checked)} disabled={saving} /><span>{label}</span></label>{description && <p>{description}</p>}{children}</div>
  );
  return <div className="ss-page">
    <nav aria-label="Breadcrumb"><button onClick={onBack} disabled={saving}>Features</button><span>/</span><strong>Settings</strong></nav>
    <section className="ss-section"><aside><h2>Features</h2><p>Set up personalized experiences for shoppers based on their wishlist items.</p></aside><div className="ss-stack">
      <div className="ss-card"><h2>Wishlist Configuration</h2><p>Choose how your customers organize and manage their wishlists.</p><div className="ss-choices">
        <label className="ss-choice selected"><input type="radio" checked readOnly name="wishlist-mode" /><strong>Single Wishlist</strong><p>Shoppers save all items to one list. Best for small catalogs.</p></label>
        <label className="ss-choice"><input type="radio" disabled name="wishlist-mode" /><strong>Multi Wishlist</strong><p>Shoppers organize items into custom lists (e.g., “Bedroom”, “Holiday”). Coming soon.</p></label>
      </div></div>
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
    <section className="ss-section"><aside><h2>Events & Triggers Settings</h2><p>Set up personalized alerts for shoppers based on their wishlist items.</p></aside><div className="ss-card">
      <div className="ss-integration"><h2>Activate Your Integrations to Send Alerts</h2><p>Wishlist event integrations are not connected. These alert controls will become available when supported.</p></div>
      {alertGroups.map(group => <div className="ss-alerts" key={group.title}><h2>{group.title}</h2><div className="ss-group">{group.rows.map(([title, description, amount, unit]) => <div className="ss-row" key={title}><label className="ss-check"><input type="checkbox" disabled /><span>{title}</span><small>Email</small>{title !== 'Sign up confirmation' && title !== 'Wishlist Shared' && <><small>SMS</small><small>Advertisement</small></>}</label><p>{description} {amount && <><input type="number" aria-label={title + ' threshold'} value={amount} disabled /> {unit}</>}</p></div>)}</div></div>)}
    </div></section>
    <section className="ss-section"><aside><h2>Compliance and Accessibility</h2><p>Configure how your wishlist handles privacy and accessibility based on your store’s location.</p></aside><div className="ss-card"><h2>Privacy-First Wishlist</h2><div className="ss-group">
      {check('worksWithoutCookies', 'Works without cookies', 'Save items to the shopper’s device if they decline cookies.')}
      {check('askPermission', 'Ask for Permission', 'Show a consent prompt on the shopper’s first heart-click.')}
    </div><p className="ss-note">Smart Save, engagement and privacy preferences are saved here; their storefront behavior is not yet enabled.</p></div></section>
    <footer className="ss-footer"><button onClick={onBack} disabled={saving}>Cancel</button><button className="ss-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
  </div>;
}
