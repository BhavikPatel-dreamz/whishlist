import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { DashboardHelp } from "../components/DashboardHelp";
import { fetchEmbedExtensions, getEmbedStatus } from "../lib/embed-status";
import type { ExtensionInfo } from "../lib/embed-status";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const editor = `https://${session.shop}/admin/themes/current/editor?context=apps&template=index`;
  const apiKey = process.env.SHOPIFY_API_KEY;
  const embedUrl = (handle: string) =>
    apiKey
      ? `${editor}&activateAppId=${encodeURIComponent(`${apiKey}/${handle}`)}`
      : editor;
  return {
    wishlistEditor: embedUrl("wishlist-app-embed"),
    storefrontEditor: embedUrl("storefront-ui-app-embed"),
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
  const { wishlistEditor, storefrontEditor } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      // Older installed App Bridge types do not yet include the App API.
      const bridge = shopify as unknown as {
        app?: { extensions?: () => Promise<ExtensionInfo[]> };
      };
      const result = await fetchEmbedExtensions(bridge);
      if (mounted.current) {
        setExtensions(result);
        setError(false);
      }
    } catch {
      if (mounted.current) {
        setError(true);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [shopify]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const embeds = [
    {
      title: "App Control Centre",
      handle: "wishlist-app-embed",
      url: wishlistEditor,
      description:
        "The main wishlist interface — enables the wishlist button and interface that shoppers use to view and manage their saved items on your storefront.",
      label: "Wishlist",
    },
    {
      title: "Storefront UI Elements",
      handle: "storefront-ui-app-embed",
      url: storefrontEditor,
      description:
        "Wishlist UI components — lets shoppers choose their preferred product variant before saving. Customize the selector’s colors, text, and typography in your theme editor. Requires App Control Centre to be enabled.",
      label: "Storefront UI Elements",
    },
  ];
  return (
    <main className="ws-home-page">
      <TitleBar title="Dashboard" />
      <section className="ws-home-panel" aria-labelledby="embed-title">
        <div className="ws-home-sectionHeading">
          <h1 id="embed-title">App Embed Status</h1>
          <button
            className="ws-home-refresh"
            onClick={() => void refresh()}
            disabled={checking}
          >
            {checking
              ? "Checking…"
              : error
                ? "Retry status check"
                : "Refresh status"}
          </button>
        </div>
        <div className="ws-home-embedGrid">
          {embeds.map((embed) => {
            const knownStatus = getEmbedStatus(extensions, embed.handle);
            const status =
              knownStatus !== "Unknown"
                ? knownStatus
                : checking
                  ? "Checking…"
                  : "Unknown";
            return (
              <article className="ws-home-embedCard" key={embed.handle}>
                <h2>{embed.title}</h2>
                <span
                  className={`ws-home-badge ${status === "Enabled" ? "ws-home-enabled" : "ws-home-neutral"}`}
                  role="status"
                >
                  {status}
                </span>
                <p>{embed.description}</p>
                <a
                  className="ws-home-button"
                  href={embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Manage ${embed.label} in Theme Editor (opens in new tab)`}
                >
                  <span aria-hidden="true">↗</span> Manage in Theme Editor
                </a>
              </article>
            );
          })}
        </div>
        {error && (
          <p className="ws-home-statusNote" role="status">
            Status could not be checked. Any previous status is from the last
            successful check. Retry or open the theme editor to verify your
            embeds.
          </p>
        )}
        <p className="ws-home-statusNote">
          Status reflects your published theme. Save your changes in the theme
          editor to apply them.
        </p>
      </section>

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
            <a
              className="ws-home-featureLink"
              href={wishlistEditor}
              target="_blank"
              rel="noopener noreferrer"
            >
              Customize wishlist <span aria-hidden="true">→</span>
            </a>
          </article>
          <article className="ws-home-featureCard">
            <AlertPreview />
            <h3>Automate Engaging Your Shoppers.</h3>
            <p>
              Send timely, automated <strong>back-in-stock alerts</strong> that
              rekindle your shoppers’ interest and bring them back to the
              products they love.
            </p>
            <Link className="ws-home-featureLink" to="/app/alerts">
              Manage stock alerts <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="ws-home-featureCard">
            <h3>Convert Interest into Sales.</h3>
            <p>
              Understand what your shoppers love. Explore wishlist activity,
              popular products, and wishlist-driven orders to turn saved
              favorites into your next opportunity.
            </p>
            <AnalyticsPreview />
            <Link className="ws-home-featureLink" to="/app/analytics">
              Explore analytics <span aria-hidden="true">→</span>
            </Link>
          </article>
        </div>
      </section>
      <DashboardHelp />
    </main>
  );
}
