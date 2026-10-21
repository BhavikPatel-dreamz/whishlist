import { Link } from "@remix-run/react";

type Props = {
  saveFeaturesUrl: string;
  backInStockFeaturesUrl: string;
  wishlistEnabled: boolean;
  backInStockEnabled: boolean;
  saving: boolean;
  onToggle: (feature: "wishlist" | "backInStock", enabled: boolean) => void;
};

function FeatureIcon({
  kind,
}: {
  kind: "save" | "alerts";
}) {
  const paths = {
    save: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
    alerts: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

export function ConfigurationFeatures({
  saveFeaturesUrl,
  backInStockFeaturesUrl,
  wishlistEnabled,
  backInStockEnabled,
  saving,
  onToggle,
}: Props) {
  return (
    <section
      className="wl-configuration-features"
      aria-labelledby="configuration-features-title"
    >
      <h2 id="configuration-features-title">Features</h2>
      <div className="wl-configuration-rows">
        <div className="wl-configuration-row">
          <FeatureIcon kind="save" />
          <span>
            <Link to={saveFeaturesUrl} className="wl-configuration-link">
              <strong>Wishlist Configuration</strong>
            </Link>
            <span>
              Configure core elements like the wishlist button, Quick Save, and
              Smart Save behavior.
            </span>
          </span>
          <button
            type="button"
            className={`wl-feature-switch ${wishlistEnabled ? "is-on" : ""}`}
            role="switch"
            aria-checked={wishlistEnabled}
            aria-label="Enable Wishlist"
            disabled={saving}
            onClick={() => onToggle("wishlist", !wishlistEnabled)}
          >
            <span />
          </button>
        </div>
        <div className="wl-configuration-row">
          <FeatureIcon kind="alerts" />
          <span>
            <Link to={backInStockFeaturesUrl} className="wl-configuration-link">
              <strong>Back in Stock Configuration</strong>
            </Link>
            <span>
              Customize the notify button, signup form, and back-in-stock email.
            </span>
          </span>
          <button
            type="button"
            className={`wl-feature-switch ${backInStockEnabled ? "is-on" : ""}`}
            role="switch"
            aria-checked={backInStockEnabled}
            aria-label="Enable Back-in-Stock alerts"
            disabled={saving}
            onClick={() => onToggle("backInStock", !backInStockEnabled)}
          >
            <span />
          </button>
        </div>
      </div>
    </section>
  );
}
