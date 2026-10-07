import { Link } from "@remix-run/react";

type Props = { saveFeaturesUrl: string; onAccessSettings: () => void };

function FeatureIcon({
  kind,
}: {
  kind: "save" | "share" | "alerts" | "privacy";
}) {
  const paths = {
    save: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
    share:
      "M12 16V3m-4 4 4-4 4 4M7 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2",
    alerts: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    privacy: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3",
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
  onAccessSettings,
}: Props) {
  return (
    <section
      className="wl-configuration-features"
      aria-labelledby="configuration-features-title"
    >
      <h2 id="configuration-features-title">Features</h2>
      <div className="wl-configuration-rows">
        <Link to={saveFeaturesUrl} className="wl-configuration-row">
          <FeatureIcon kind="save" />
          <span>
            <strong>Help Shoppers Save Favorites</strong>
            <span>
              Configure core elements like the wishlist button, Quick Save, and
              Smart Save behavior.
            </span>
          </span>
          <span className="wl-configuration-chevron" aria-hidden="true">
            ›
          </span>
        </Link>
        <button
          type="button"
          className="wl-configuration-row"
          onClick={onAccessSettings}
        >
          <FeatureIcon kind="share" />
          <span>
            <strong>Ways to Access &amp; Share Wishlist</strong>
            <span>
              Manage the wishlist page, sharing options, and launch points.
            </span>
          </span>
          <span className="wl-configuration-chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <Link to="/app/alerts" className="wl-configuration-row">
          <FeatureIcon kind="alerts" />
          <span>
            <strong>Help Shoppers Rediscover Their Favorites</strong>
            <span>
              Manage back-in-stock alerts and review shopper notification
              requests.
            </span>
          </span>
          <span className="wl-configuration-chevron" aria-hidden="true">
            ›
          </span>
        </Link>
        <div
          className="wl-configuration-row wl-configuration-row-unavailable"
          aria-disabled="true"
        >
          <FeatureIcon kind="privacy" />
          <span>
            <strong>Compliance &amp; Accessibility</strong>
            <span>
              Configure how your wishlist handles privacy and accessibility
              based on your store’s location.
            </span>
          </span>
          <span className="wl-configuration-coming-soon">Coming soon</span>
        </div>
      </div>
    </section>
  );
}
