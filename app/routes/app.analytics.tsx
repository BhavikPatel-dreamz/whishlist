import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import "../components/Reports.css";
import { requireAdminShop } from "../lib/admin-auth.server";
import { loadReport } from "../models/reports.server";
import { stockReportTabs, wishlistReportTabs } from "../lib/reports";
import {
  BarSeriesChart,
  ChartCard,
  DonutChart,
  SegmentedDonut,
} from "../components/OverviewCharts";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const params = new URL(request.url).searchParams;
  if (!params.has("tab") && !params.has("kind")) {
    params.set("tab", "overview");
  }
  const data = await loadReport(shop.id, admin, params);
  const count = data.table.rows.length;
  const pages = Math.max(1, Math.ceil(count / 10));
  const requested = Number(params.get("page") || 1);
  const page = Number.isInteger(requested)
    ? Math.max(1, Math.min(pages, requested))
    : 1;
  return {
    ...data,
    table: {
      ...data.table,
      rows: data.table.rows.slice((page - 1) * 10, page * 10),
    },
    count,
    page,
    pages,
  };
}

type OverviewCard = {
  label: string;
  value: string | number;
  tab?: string;
  kind?: string;
};

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const isOverview = data.tab === "overview";
  const isStockList = data.tab === "stock";
  // Back-in-stock reporting (stock list, sent alerts, purchases) lives under its own
  // top-level section; wishlist reporting keeps product/activity/shared reports.
  const isWishlistSection =
    data.tab === "shoppers" ||
    wishlistReportTabs.some(([key]) => key === data.tab);
  const isStockSection = stockReportTabs.some(([key]) => key === data.tab);
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const submit = useSubmit();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [search, setSearch] = useState(params.get("q") || "");
  useEffect(() => {
    setSearch(params.get("q") || "");
  }, [params]);
  const datesRef = useRef<HTMLDetailsElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  useEffect(() => {
    setFrom(data.from);
    setTo(data.to);
    if (!data.error && datesRef.current) datesRef.current.open = false;
  }, [data]);
  useEffect(() => () => clearTimeout(searchTimer.current), [data.tab]);
  const revalidator = useRevalidator();
  const busy = navigation.state !== "idle" || revalidator.state !== "idle";
  const query = new URLSearchParams({
    from: data.from,
    to: data.to,
    tab: data.tab,
  });
  const activeKind = params.get("kind");
  if (activeKind) query.set("kind", activeKind);
  if (params.get("q")) query.set("q", params.get("q")!);
  if (params.get("sort")) query.set("sort", params.get("sort")!);
  const pageUrl = (page: number) => {
    const next = new URLSearchParams(query);
    next.set("page", String(page));
    return `/app/analytics?${next}`;
  };
  async function exportReport() {
    setExporting(true);
    setExportError("");
    try {
      // Fetch within the embedded app so App Bridge can authenticate the request.
      const response = await fetch(`/app/reports/export?${query}`, {
        headers: { Accept: "text/csv" },
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("text/csv")
      ) {
        throw new Error("Export failed. Please try again or reload the app.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.tab}-${data.from}-${data.to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Export failed. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }
  const overviewSections:
    | { title: string; tone: "green" | "violet"; cards: OverviewCard[] }[]
    | undefined = data.overview && data.wishlistSummary
    ? [
        {
          title: "Back in Stock",
          tone: "green",
          cards: [
            {
              label: "Subscribed Alerts",
              value: data.overview.subscribedAlerts,
              tab: "alerts",
              kind: "all",
            },
            {
              label: "Pending Alerts",
              value: data.overview.pendingAlerts,
              tab: "alerts",
              kind: "pending",
            },
            {
              label: "Sent Alerts",
              value: data.overview.sentAlerts,
              tab: "alerts",
              kind: "sent",
            },
            {
              label: "Alert Purchases",
              value: data.overview.stockAlertPurchases,
              tab: "purchases",
              kind: "stock-alert",
            },
          ],
        },
        {
          title: "Wishlist Metrics",
          tone: "violet",
          cards: [
            {
              label: "Total Wishlist Saves",
              value: data.wishlistSummary.totalSaves,
              tab: "products",
              kind: "all-time-saves",
            },
            {
              label: "Wishlist Orders",
              value: data.wishlistSummary.orders,
              tab: "wishlist-orders",
              kind: "all-time-orders",
            },
            {
              label: "Wishlisted Products",
              value: data.wishlistSummary.productCount,
              tab: "products",
              kind: "all-time-products",
            },
          ],
        },
      ]
    : undefined;
  const stockCards: { label: string; value: number; kind?: string }[] =
    data.inventory
      ? [
          { label: "Tracked Products", value: data.inventory.tracked },
          { label: "In Stock", value: data.inventory.inStock, kind: "in-stock" },
          {
            label: "Low Stock",
            value: data.inventory.lowStock,
            kind: "low-stock",
          },
          {
            label: "Out of Stock",
            value: data.inventory.outOfStock,
            kind: "out-of-stock",
          },
        ]
      : [];
  const reportHref = (tab: string, kind?: string) => {
    const reportParams = new URLSearchParams({ from: data.from, to: data.to });
    reportParams.set("tab", tab);
    if (kind) reportParams.set("kind", kind);
    return `/app/analytics?${reportParams}`;
  };
  const overviewCharts =
    data.overview && data.wishlistSummary
      ? {
          funnel: [
            {
              label: "Alert requests",
              value: data.overview.subscribedAlerts,
              href: reportHref("alerts", "all"),
            },
            {
              label: "Pending alerts",
              value: data.overview.pendingAlerts,
              href: reportHref("alerts", "pending"),
            },
            {
              label: "Sent notifications",
              value: data.overview.sentAlerts,
              href: reportHref("alerts", "sent"),
            },
            {
              label: "Click-throughs",
              value: data.overview.clickThroughs,
              href: reportHref("alerts", "clickthroughs"),
            },
            {
              label: "Purchases",
              value: data.overview.stockAlertPurchases,
              href: reportHref("purchases", "stock-alert"),
            },
          ],
          wishlist: [
            {
              label: "Total saves",
              value: data.wishlistSummary.totalSaves,
              href: reportHref("products", "all-time-saves"),
            },
            {
              label: "Wishlisted products",
              value: data.wishlistSummary.productCount,
              href: reportHref("products", "all-time-products"),
            },
            {
              label: "Wishlist orders",
              value: data.wishlistSummary.orders,
              href: reportHref("wishlist-orders", "all-time-orders"),
            },
          ],
          topProducts: data.overview.popularRequestedProducts
            .slice(0, 8)
            .map((product) => ({
              label: product.title,
              value: product.alerts,
              href: reportHref("alerts", "requested-products"),
            })),
          clickRate: {
            value: data.overview.clickThroughs,
            total: data.overview.sentAlerts,
          },
          purchaseRate: {
            value: data.overview.stockAlertPurchases,
            total: data.overview.sentAlerts,
          },
        }
      : null;
  return (
    <main className="ws-reports">
      <TitleBar title="Analytics" />
      <nav className="ws-reports-tabs" aria-label="Analytics sections">
        <Link
          to={`/app/analytics?${new URLSearchParams({ tab: "overview", from: data.from, to: data.to })}`}
          aria-current={isOverview ? "page" : undefined}
        >
          Overview
        </Link>
        <Link
          to={`/app/analytics?${new URLSearchParams({ tab: "products", from: data.from, to: data.to })}`}
          aria-current={isWishlistSection ? "page" : undefined}
        >
          Wishlist
        </Link>
        <Link
          to={`/app/analytics?${new URLSearchParams({ tab: "stock", from: data.from, to: data.to })}`}
          aria-current={isStockSection ? "page" : undefined}
        >
          Back in Stock
        </Link>
      </nav>
      {isWishlistSection && (
        <nav className="ws-reports-tabs ws-reports-subtabs" aria-label="Wishlist reports">
          {wishlistReportTabs.map(([key, label]) => (
            <Link
              key={key}
              to={`/app/analytics?${new URLSearchParams({ tab: key, from: data.from, to: data.to })}`}
              aria-current={data.tab === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
          {data.tab === "shoppers" && <span aria-current="page">Shoppers</span>}
        </nav>
      )}
      {isStockSection && (
        <nav className="ws-reports-tabs ws-reports-subtabs" aria-label="Back in stock reports">
          {stockReportTabs.map(([key, label]) => (
            <Link
              key={key}
              to={`/app/analytics?${new URLSearchParams({ tab: key, from: data.from, to: data.to })}`}
              aria-current={data.tab === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      <header className="ws-reports-heading">
        <div>
          <h1>{data.table.title}</h1>
          <p>{data.table.description}</p>
        </div>
        <div className="ws-reports-actions">
          {!isOverview && <button
            type="button"
            className="ws-reports-button"
            disabled={
              !data.count ||
              busy ||
              exporting ||
              search !== (params.get("q") || "")
            }
            onClick={exportReport}
          >
            {exporting ? "Exporting…" : "↥ Export"}
          </button>}
          <details className="ws-reports-dates" ref={datesRef}>
            <summary>
              ▣ {data.from} – {data.to}
            </summary>
            <Form
              method="get"
              action="/app/analytics"
              onSubmit={() => clearTimeout(searchTimer.current)}
            >
              <input type="hidden" name="tab" value={data.tab} />
              {params.get("kind") && (
                <input
                  type="hidden"
                  name="kind"
                  value={params.get("kind")!}
                />
              )}
              <input type="hidden" name="q" value={params.get("q") || ""} />
              <input
                type="hidden"
                name="sort"
                value={params.get("sort") || "default"}
              />
              <label>
                From (UTC)
                <input
                  type="date"
                  name="from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  max={to}
                  required
                />
              </label>
              <label>
                To (UTC)
                <input
                  type="date"
                  name="to"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  min={from}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
              </label>
              <button className="ws-reports-button" disabled={busy}>
                Apply dates
              </button>
            </Form>
          </details>
        </div>
      </header>
      {exportError && <p role="alert">{exportError}</p>}
      {data.error && <p role="alert">{data.error} Showing the last 7 days.</p>}
      {isOverview && overviewSections && (
        <div className="ws-overview-sections" aria-busy={busy}>
          {overviewSections.map((section) => (
            <section
              className={`ws-overview-section ws-overview-section--${section.tone}`}
              key={section.title}
            >
              <h2>{section.title}</h2>
              <div className="ws-overview-grid">
                {section.cards.map((card) => {
                  const cardParams = new URLSearchParams({
                    from: data.from,
                    to: data.to,
                  });
                  if (card.tab) cardParams.set("tab", card.tab);
                  if (card.kind) cardParams.set("kind", card.kind);
                  const content = (
                    <>
                      <span className="ws-overview-card-label">
                        {card.label}
                      </span>
                      <span className="ws-overview-card-value">{card.value}</span>
                      <span
                        className="ws-overview-card-action"
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                    </>
                  );
                  return card.tab ? (
                    <Link
                      className="ws-overview-card"
                      key={card.label}
                      to={`/app/analytics?${cardParams}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="ws-overview-card" key={card.label}>
                      {content}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {overviewCharts && (
            <section
              className="ws-overview-section ws-overview-section--teal"
              aria-label="Charts"
            >
              <h2>Insights</h2>
              <div className="ws-overview-charts">
                <BarSeriesChart
                  title="Alert funnel"
                  subtitle="From request to purchase"
                  steps={overviewCharts.funnel}
                  accentLast
                />
                <ChartCard
                  title="Conversion rates"
                  subtitle="Calculated against sent notifications"
                >
                  <div className="ws-chart-donut-row">
                    <DonutChart
                      label="Click-through"
                      value={overviewCharts.clickRate.value}
                      total={overviewCharts.clickRate.total}
                    />
                    <DonutChart
                      label="Purchases"
                      value={overviewCharts.purchaseRate.value}
                      total={overviewCharts.purchaseRate.total}
                    />
                  </div>
                </ChartCard>
                <BarSeriesChart
                  title="Wishlist engagement"
                  steps={overviewCharts.wishlist}
                />
                <BarSeriesChart
                  title="Top requested products"
                  subtitle="Alert requests per product"
                  steps={overviewCharts.topProducts}
                />
              </div>
            </section>
          )}
        </div>
      )}
      {isStockList && data.inventory && (
        <section className="ws-overview-section ws-stock-summary" aria-label="Inventory metrics">
          <h2>Inventory Metrics</h2>
          <div className="ws-stock-summary-layout">
            <div className="ws-overview-grid">
              {stockCards.map((card) => {
                const cardParams = new URLSearchParams({
                  tab: "stock",
                  from: data.from,
                  to: data.to,
                });
                if (card.kind) cardParams.set("kind", card.kind);
                const isActive = (params.get("kind") || "") === (card.kind || "");
                return (
                  <Link
                    className="ws-overview-card"
                    key={card.label}
                    to={`/app/analytics?${cardParams}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="ws-overview-card-label">{card.label}</span>
                    <span className="ws-overview-card-value">{card.value}</span>
                  </Link>
                );
              })}
            </div>
            <SegmentedDonut
              title="Inventory split"
              segments={[
                {
                  label: "In stock",
                  value: data.inventory.inStock,
                  tone: "ws-tone-good",
                },
                {
                  label: "Low stock",
                  value: data.inventory.lowStock,
                  tone: "ws-tone-warn",
                },
                {
                  label: "Out of stock",
                  value: data.inventory.outOfStock,
                  tone: "ws-tone-bad",
                },
              ]}
            />
          </div>
        </section>
      )}
      {!isOverview && <section
        className={`ws-reports-card${isStockList ? " ws-stock-list-card" : ""}`}
        aria-label={data.table.title}
        aria-busy={busy}
      >
        <div className="ws-reports-toolbar">
          <span>{data.table.label}</span>
          <Form
            method="get"
            action="/app/analytics"
            className="ws-reports-search"
            key={data.tab}
            onSubmit={() => clearTimeout(searchTimer.current)}
          >
            <input type="hidden" name="tab" value={data.tab} />
            <input type="hidden" name="from" value={data.from} />
            <input type="hidden" name="to" value={data.to} />
            {params.get("kind") && (
              <input type="hidden" name="kind" value={params.get("kind")!} />
            )}
            <input
              name="q"
              type="search"
              aria-label="Search report"
              placeholder="Search report…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                const form = event.currentTarget.form!;
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(
                  () => submit(form, { replace: true }),
                  350,
                );
              }}
            />
            <select
              name="sort"
              aria-label="Sort report"
              value={params.get("sort") || "default"}
              onChange={(event) => {
                clearTimeout(searchTimer.current);
                submit(event.currentTarget.form!, { replace: true });
              }}
            >
              <option value="default">Default order</option>
              <option value="title-asc">{data.table.columns[0]} A–Z</option>
              <option value="title-desc">{data.table.columns[0]} Z–A</option>
            </select>
            <button className="ws-reports-button" disabled={busy}>
              Apply
            </button>
          </Form>
        </div>
        {data.count ? (
          <div className="ws-reports-table-scroll">
            <table className={isStockList ? "ws-stock-table" : undefined}>
              <thead>
                <tr>
                  {data.table.imageColumn && !isStockList && (
                    <th scope="col">Product Image</th>
                  )}
                  {data.table.columns.map((column, index) => (
                    <th key={column} scope="col">
                      {isStockList && index === 0 ? "Product" : column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.table.rows.map((row) => (
                  <tr key={row.id}>
                    {data.table.imageColumn && !isStockList && (
                      <td>
                        <ReportProductImage src={row.image} title={String(row.cells[0])} />
                      </td>
                    )}
                    {row.cells.map((cell, i) => (
                      <td key={i}>
                        {isStockList && i === 0 ? (
                          <div className="ws-stock-product">
                            <ReportProductImage src={row.image} title={String(cell)} />
                            <strong>{cell}</strong>
                          </div>
                        ) : isStockList && i === 1 ? (
                          <span className="ws-stock-inventory">{cell}</span>
                        ) : isStockList && i === 2 ? (
                          <span
                            className={`ws-stock-status ${
                              cell === "In stock"
                                ? "is-in-stock"
                                : cell === "Low stock"
                                  ? "is-low-stock"
                                  : "is-out-of-stock"
                            }`}
                          >
                            {cell}
                          </span>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ws-reports-empty">
            <svg
              width="136"
              height="144"
              viewBox="0 0 136 144"
              aria-hidden="true"
            >
              <circle cx="68" cy="72" r="62" fill="#f1f2f3" />
              <path
                d="M26 20h78v108H26z"
                fill="white"
                stroke="#ddd"
                strokeWidth="2"
              />
              <path d="M38 33h27v27H38z" fill="#e3ad49" />
              {[73, 82, 91, 100, 109].map((y) => (
                <path
                  key={y}
                  d={`M38 ${y}h53`}
                  stroke="#e6e6e6"
                  strokeWidth="3"
                />
              ))}
            </svg>
            <h2>No data available</h2>
            <p>
              {data.tab === "shared"
                ? "No wishlists were shared during the selected dates."
                : "There are no items to display for the selected criteria."}
            </p>
            <button
              className="ws-reports-button ws-reports-primary"
              onClick={() => revalidator.revalidate()}
              disabled={busy}
            >
              {busy ? "Refreshing…" : "↻ Refresh Data"}
            </button>
          </div>
        )}
      </section>}
      {!isOverview && data.count > 0 && (
        <nav className="ws-reports-pagination" aria-label="Report pages">
          {data.page > 1 ? (
            <Link to={pageUrl(data.page - 1)} aria-label="Previous page">
              ‹
            </Link>
          ) : (
            <span aria-disabled="true">‹</span>
          )}
          <span>
            {(data.page - 1) * 10 + 1}–{Math.min(data.page * 10, data.count)} of{" "}
            {data.count} items
          </span>
          {data.page < data.pages ? (
            <Link to={pageUrl(data.page + 1)} aria-label="Next page">
              ›
            </Link>
          ) : (
            <span aria-disabled="true">›</span>
          )}
        </nav>
      )}
      {!isOverview && <p className="ws-reports-note">{data.table.note}</p>}
    </main>
  );
}

function ReportProductImage({
  src,
  title,
}: {
  src?: string | null;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="ws-reports-no-image" aria-label={`No image for ${title}`}>
        ◇
      </span>
    );
  }
  return (
    <a
      className="ws-reports-image-link"
      href={src}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open image for ${title} in a new tab`}
    >
      <img
        src={src}
        alt={title}
        width={40}
        height={40}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

