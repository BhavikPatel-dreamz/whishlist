import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { AnalyticsMetrics } from "../components/AnalyticsMetrics";
import { loadAnalyticsMetrics } from "../models/analytics-metrics.server";
import { requireAdminShop } from "../lib/admin-auth.server";
import { DashboardHelp } from "../components/DashboardHelp";
import { fetchEmbedExtensions, getEmbedStatus, type EmbedStatus } from "../lib/embed-status";
import { embedEditorUrl, themeEditorUrl } from "../lib/theme-editor";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin, shop } = await requireAdminShop(request);
  const metrics = await loadAnalyticsMetrics(shop.id, admin, new URL(request.url).searchParams);
  return {
    metrics,
    themeEditor: themeEditorUrl(session.shop, { template: "index" }),
    wishlistEditor: embedEditorUrl(session.shop, "wishlist-app-embed"),
    backInStockEditor: embedEditorUrl(session.shop, "back-in-stock-app-embed"),
    storefrontUiEditor: embedEditorUrl(session.shop, "storefront-ui-app-embed"),
  };
}

function ProductArt({ kind }: { kind: "bowl" | "vase" | "bag" }) {
  return (
    <span
      className={`ws-home-productArt ${`ws-home-${kind}`}`}
      aria-hidden="true"
    />
  );
}

function WishlistPreview() {
  return (
    <div
      className={`ws-home-preview ws-home-wishlistPreview`}
      aria-label="Example wishlist preview"
    >
      <div className="ws-home-savedNotice">
        <ProductArt kind="bag" />
        <span>
          You have added <strong>“Everyday Tote”</strong> to your wishlist.
          <b>View Wishlist</b>
        </span>
      </div>
      <div className="ws-home-wishlistWindow">
        <strong>
          My Wishlist <span className="ws-home-green">♡</span>
        </strong>
        <div className="ws-home-productGrid">
          {(["bowl", "vase", "bag", "bowl"] as const).map((kind, i) => (
            <div className="ws-home-miniProduct" key={i}>
              <div>
                <ProductArt kind={kind} />
                <span>♡</span>
              </div>
              <small>
                {
                  [
                    "Modern Purple Bowl",
                    "The Earth Vase",
                    "Everyday Tote",
                    "Ceramic Bowl",
                  ][i]
                }
              </small>
              <b>{["$28.00", "$36.00", "$42.00", "$24.00"][i]}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlertPreview() {
  return (
    <div
      className={`ws-home-preview ws-home-alertPreview`}
      aria-label="Example back-in-stock notification"
    >
      <div className="ws-home-mailWindow">
        <strong>Your favorite is back!</strong>
        <p>The Earth Vase is back in stock. Make it yours before it’s gone.</p>
        <ProductArt kind="vase" />
        <span className="ws-home-buyButton">Shop now</span>
        <small>♡ Saved by you. Ready for you.</small>
      </div>
      <div className="ws-home-messageBubble">
        <span className="ws-home-avatar">SQ</span>
        <div>
          <strong>Wishlist by Square</strong>
          <p>
            Good news! Your saved item is back in stock.{" "}
            <b>Shop your favorite →</b>
          </p>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPreview() {
  return (
    <div
      className={`ws-home-preview ws-home-analyticsPreview`}
      aria-label="Illustrative wishlist analytics, not live store data"
    >
      <div className="ws-home-statsPreview">
        <small>Turn saved favorites into new possibilities</small>
        <div>
          <span>
            ♡<b>Wishlist activity</b>
          </span>
          <span>
            ↗<b>Customer interest</b>
          </span>
        </div>
      </div>
      <div className="ws-home-tablePreview">
        <strong>Top wishlisted products</strong>
        {(["bowl", "bag", "vase"] as const).map((kind, i) => (
          <div key={kind}>
            <ProductArt kind={kind} />
            <span>
              {["Modern Purple Bowl", "Everyday Tote", "The Earth Vase"][i]}
              <small>Saved to wishlists</small>
            </span>
            <span>♡</span>
          </div>
        ))}
      </div>
      <span className="ws-home-exampleLabel">Example preview</span>
    </div>
  );
}

export default function Dashboard() {
  const { themeEditor, wishlistEditor, backInStockEditor, storefrontUiEditor, metrics } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [embedStatuses, setEmbedStatuses] = useState({
    wishlist: "Unknown" as EmbedStatus,
    backInStock: "Unknown" as EmbedStatus,
  });

  useEffect(() => {
    let mounted = true;
    const refreshStatuses = async () => {
      try {
        const extensions = await fetchEmbedExtensions(shopify);
        if (!mounted) return;
        setEmbedStatuses({
          wishlist: getEmbedStatus(extensions, "wishlist-app-embed"),
          backInStock: getEmbedStatus(extensions, "back-in-stock-app-embed"),
        });
      } catch {
        if (!mounted) return;
        setEmbedStatuses({ wishlist: "Unknown", backInStock: "Unknown" });
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshStatuses();
    };

    void refreshStatuses();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [shopify]);

  const embeds = [
    {
      title: "App Control Centre",
      handle: "wishlist-app-embed",
      url: wishlistEditor,
      description:
        "Manage wishlist visibility, colors, notification alignment, drawer direction, and the wishlist page from one app embed.",
      label: "Wishlist",
    },
    {
      title: "Back-in-Stock",
      handle: "back-in-stock-app-embed",
      url: backInStockEditor,
      description:
        "Manage stock alert buttons, icons, colors, and notification text independently from wishlist.",
      label: "Back-in-Stock",
    },
    {
      title: "Storefront UI Elements",
      handle: "storefront-ui-app-embed",
      url: storefrontUiEditor,
      description:
        "Show a popup to choose product options before saving to wishlist. Customize its colors, text, and font sizes.",
      label: "Variant popup",
    },
  ];
  return (
    <main className="ws-home-page">
      <TitleBar title="Dashboard" />
      <section className="ws-home-panel" aria-labelledby="embed-title">
        <div className="ws-home-sectionHeading">
          <h1 id="embed-title">App Embeds</h1>

        </div>
        <div className="ws-home-embedGrid">
          {embeds.map((embed) => {
            const statusKey = embed.handle === "wishlist-app-embed"
              ? "wishlist"
              : embed.handle === "back-in-stock-app-embed"
                ? "backInStock"
                : null;
            const status = statusKey ? embedStatuses[statusKey] : null;
            const statusLabel = status === "Unknown" ? "Checking" : status;
            const actionUrl = status === "Enabled" ? themeEditor : embed.url;
            const actionLabel = status === "Enabled"
              ? "Manage or disable in Theme Editor"
              : status === "Disabled"
                ? "Enable in Theme Editor"
                : "Manage in Theme Editor";

            return (
              <article className="ws-home-embedCard" key={embed.handle}>
                <div className="ws-home-embedTitleRow">
                  <h2>{embed.title}</h2>
                  {status && (
                    <span
                      className={`ws-home-badge ${status === "Enabled" ? "ws-home-enabled" : "ws-home-neutral"}`}
                      role="status"
                    >
                      {statusLabel}
                    </span>
                  )}
                </div>

                <p>{embed.description}</p>
                <a
                  className="ws-home-button"
                  href={actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${actionLabel}: ${embed.label} (opens in new tab)`}
                >
                  <span aria-hidden="true">↗</span> {actionLabel}
                </a>
              </article>
            );
          })}
        </div>
        <p className="ws-home-statusNote">
          Shopify requires activation changes in Theme Editor. Enable opens the selected app embed; disable it there by switching the embed off.
        </p>
      </section>

      <AnalyticsMetrics data={metrics} />

      <section
        className={`ws-home-panel ws-home-features`}
        aria-labelledby="features-title"
      >
        <header className="ws-home-featureHeading">
          <h2 id="features-title">
            Design, Engage, Convert: Your Wishlist, Elevated.
          </h2>
          <p>
            Discover the benefits of a wishlist that keeps your shoppers coming
            back.
          </p>
        </header>
        <div className="ws-home-featureGrid">
          <article className="ws-home-featureCard">
            <h3>Craft Your Branded Wishlist.</h3>
            <p>
              Make it feel like your store. Customize your wishlist so shoppers
              can effortlessly save their favorites and return when they’re
              ready to buy.
            </p>
            <WishlistPreview />
            {/* <a
              className="ws-home-featureLink"
              href={wishlistEditor}
              target="_blank"
              rel="noopener noreferrer"
            >
              Customize wishlist <span aria-hidden="true">→</span>
            </a> */}
          </article>
          <article className="ws-home-featureCard">
            <AlertPreview />
            <h3>Automate Engaging Your Shoppers.</h3>
            <p>
              Send timely, automated <strong>back-in-stock alerts</strong> that
              rekindle your shoppers’ interest and bring them back to the
              products they love.
            </p>
            {/* <a
              className="ws-home-featureLink"
              href={backInStockEditor}
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage stock alerts <span aria-hidden="true">→</span>
            </a> */}
          </article>
          <article className="ws-home-featureCard">
            <h3>Convert Interest into Sales.</h3>
            <p>
              Understand what your shoppers love. Explore wishlist activity,
              popular products, and wishlist-driven orders to turn saved
              favorites into your next opportunity.
            </p>
            <AnalyticsPreview />
            {/* <Link className="ws-home-featureLink" to="/app/analytics">
              Explore analytics <span aria-hidden="true">→</span>
            </Link> */}
          </article>
        </div>
      </section>
      <DashboardHelp />
    </main>
  );
}
