import { Form, Link, useNavigation, useSearchParams } from "@remix-run/react";
import { Button, ButtonGroup } from "@shopify/polaris";
import { useState } from "react";
import type { ReactNode } from "react";
import { shopperValue, type MetricsData } from "../lib/analytics-metrics";

type View = "wishlist" | "back-in-stock";

/* ------------------------------------------------------------------ */
/* Date filter                                                         */
/* ------------------------------------------------------------------ */
export function MetricsDateFilter({
  data,
  action,
  kind,
  view,
}: {
  data: MetricsData;
  action: string;
  kind?: string;
  view?: View;
}) {
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state !== "idle" &&
    navigation.formMethod?.toLowerCase() === "get";

  return (
    <Form method="get" action={action} className="ws-metrics-filter">
      {kind && <input type="hidden" name="kind" value={kind} />}
      {/* keeps the active tab after applying the date filter */}
      {view && <input type="hidden" name="view" value={view} />}
      <label>
        From{" "}
        <input
          type="date"
          name="from"
          defaultValue={data.from}
          key={`from-${data.from}`}
          max={data.to}
          required
        />
      </label>
      <label>
        To{" "}
        <input
          type="date"
          name="to"
          defaultValue={data.to}
          key={`to-${data.to}`}
          min={data.from}
          required
        />
      </label>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Loading…" : "Apply"}
      </button>
    </Form>
  );
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type BackInStockMetricsData = Pick<MetricsData, "from" | "to"> & {
  subscribedAlerts: number;
  pendingAlerts: number;
  sentAlerts: number;
  clickThroughs: number;
  stockAlertPurchases: number;
  alertCustomers?: Array<{
    contact: string;
    channel: string;
    requests: number;
    lastRequestedAt: string | null;
  }>;
  popularRequestedProducts: Array<{
    productId: string;
    title: string;
    imageUrl: string | null;
    alerts: number;
  }>;
};

type ProductRow = {
  productId: string;
  title: string;
  imageUrl: string | null;
  meta: string;
};

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */
function DetailedReport({ to }: { to: string }) {
  return (
    <Link to={to}>
      Detailed Report <span aria-hidden="true">→</span>
    </Link>
  );
}

function ProductList({
  rows,
  emptyText,
  placeholder,
}: {
  rows: ProductRow[];
  emptyText: string;
  placeholder: string;
}) {
  return (
    <ul className="ws-metrics-list">
      {rows.slice(0, 20).map((row) => (
        <li key={row.productId}>
          {row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt=""
              width={34}
              height={34}
              loading="lazy"
            />
          ) : (
            <span className="ws-metrics-placeholder" aria-hidden="true">
              {placeholder}
            </span>
          )}
          <div>
            <strong title={row.title}>{row.title}</strong>
            <span>{row.meta}</span>
          </div>
        </li>
      ))}
      {!rows.length && <li className="ws-metrics-empty">{emptyText}</li>}
    </ul>
  );
}

function MetricColumn({
  title,
  subtitle,
  reportTo,
  children,
}: {
  title: string;
  subtitle: string;
  reportTo: string;
  children: ReactNode;
}) {
  return (
    <section className="ws-metrics-column">
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {children}
      <DetailedReport to={reportTo} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export function AnalyticsMetrics({
  data,
  backInStock,
}: {
  data: MetricsData;
  backInStock: BackInStockMetricsData;
}) {
  const [searchParams] = useSearchParams();
  const [activeView, setActiveView] = useState<View>(
    searchParams.get("view") === "back-in-stock" ? "back-in-stock" : "wishlist",
  );

  /* ---- report links ---- */
  const reportUrl = (slug: string, from: string, to: string) => {
    const params = new URLSearchParams({ report: slug, from, to });
    return `/app/analytics?${params.toString()}`;
  };
  const wishlistReport = (kind: string) => {
    const slug =
      kind === "shoppers"
        ? "top-intent-customers"
        : kind === "popular"
          ? "wishlisted-products"
          : "low-stock-demand";
    return reportUrl(slug, data.from, data.to);
  };

  const backInStockReport = (tab: string, kind?: string) => {
    const slug =
      tab === "alerts" && kind === "subscribers"
        ? "alert-customers"
        : tab === "alerts"
          ? "alert-subscriptions"
          : "low-stock-demand";
    return reportUrl(slug, backInStock.from, backInStock.to);
  };

  /* ---- rows for lists ---- */
  const popularRows: ProductRow[] = data.popular.map((r) => ({
    productId: r.productId,
    title: r.title,
    imageUrl: r.imageUrl,
    meta: `${r.saves} ${r.saves === 1 ? "save" : "saves"} · ${r.shoppers} ${r.shoppers === 1 ? "customer" : "customers"}`,
  }));

  // "Running out soon" only surfaces products that are both out of stock and
  // in high demand — by wishlist saves (wishlist view) or alert requests
  // (back-in-stock view). Popular lists are demand-ordered (saves / alerts).
  const outOfStockVariants = new Map(
    data.runningLow.map((row) => [row.productId, row.variants ?? []]),
  );
  const outOfStockIds = new Set(outOfStockVariants.keys());
  const outOfStockLabel = (productId: string) => {
    const variants = outOfStockVariants.get(productId) || [];
    if (!variants.length) return "Out of stock";
    const shown = variants.slice(0, 3).join(", ");
    return `Out of stock: ${shown}${
      variants.length > 3 ? ` +${variants.length - 3} more` : ""
    }`;
  };
  const hotOutOfStockRows: ProductRow[] = data.popular
    .filter((r) => outOfStockIds.has(r.productId))
    .map((r) => ({
      productId: r.productId,
      title: r.title,
      imageUrl: r.imageUrl,
      meta: `${r.saves} ${r.saves === 1 ? "save" : "saves"} · ${r.shoppers} ${r.shoppers === 1 ? "customer" : "customers"} · ${outOfStockLabel(r.productId)}`,
    }));

  const requestedRows: ProductRow[] = backInStock.popularRequestedProducts.map(
    (r) => ({
      productId: r.productId,
      title: r.title,
      imageUrl: r.imageUrl,
      meta: `${r.alerts} alert requests`,
    }),
  );

  const requestedOutOfStockRows: ProductRow[] =
    backInStock.popularRequestedProducts
      .filter((r) => outOfStockIds.has(r.productId))
      .map((r) => ({
        productId: r.productId,
        title: r.title,
        imageUrl: r.imageUrl,
        meta: `${r.alerts} ${r.alerts === 1 ? "alert request" : "alert requests"} · ${outOfStockLabel(r.productId)}`,
      }));

  return (
    <section className="ws-metrics" aria-labelledby="ws-metrics-heading">
      <header className="ws-metrics-heading">
        <div>
          <h2 id="ws-metrics-heading">Metrics</h2>
          <p>Here is how your store is performing</p>
        </div>
        <div className="ws-metrics-view-switch" role="group" aria-label="Metrics view">
          <ButtonGroup variant="segmented">
            <Button
              pressed={activeView === "wishlist"}
              onClick={() => setActiveView("wishlist")}
            >
              Wishlist
            </Button>
            <Button
              pressed={activeView === "back-in-stock"}
              onClick={() => setActiveView("back-in-stock")}
            >
              Back-in-Stock
            </Button>
          </ButtonGroup>
        </div>
        <MetricsDateFilter data={data} action="/app" view={activeView} />
      </header>

      {data.error && (
        <p role="alert" className="ws-metrics-error">
          {data.error} Showing the last 7 days.
        </p>
      )}

      {activeView === "wishlist" ? (
        <div className="ws-metrics-columns">
          <MetricColumn
            title="Shoppers"
            subtitle="Who saved the most products"
            reportTo={wishlistReport("shoppers")}
          >
            <ul className="ws-metrics-list">
              {data.shoppers.slice(0, 20).map((row) => (
                <li key={row.id}>
                  <span className="ws-metrics-avatar" aria-hidden="true">
                    {row.name.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <strong title={row.name}>{row.name}</strong>
                    <span>
                      {row.products} products · est. {shopperValue(row)}
                    </span>
                  </div>
                </li>
              ))}
              {!data.shoppers.length && (
                <li className="ws-metrics-empty">
                  No wishlist shoppers in this date range.
                </li>
              )}
            </ul>
          </MetricColumn>

          <MetricColumn
            title="Popular Products"
            subtitle="Wishlisted by most shoppers"
            reportTo={wishlistReport("popular")}
          >
            <ProductList
              rows={popularRows}
              placeholder="♡"
              emptyText="No wishlist products in this date range."
            />
          </MetricColumn>

          <MetricColumn
            title="Running out soon"
            subtitle="High-demand wishlist products that are out of stock"
            reportTo={wishlistReport("running-low")}
          >
            <ProductList
              rows={hotOutOfStockRows}
              placeholder="♡"
              emptyText="No high-demand wishlist products are out of stock."
            />
          </MetricColumn>
        </div>
      ) : (
        <div className="ws-metrics-columns">
          <MetricColumn
            title="Customers"
            subtitle={`Shoppers who requested a back-in-stock alert from ${backInStock.from} to ${backInStock.to}`}
            reportTo={backInStockReport("alerts", "subscribers")}
          >
            <ul className="ws-metrics-list ws-metrics-customer-list">
              {(backInStock.alertCustomers ?? []).map((customer) => (
                <li key={customer.contact}>
                  <span className="ws-metrics-avatar" aria-hidden="true">
                    {customer.contact.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <strong title={customer.contact}>{customer.contact}</strong>
                    <span>
                      {customer.requests}{" "}
                      {customer.requests === 1 ? "request" : "requests"} ·{" "}
                      {customer.channel === "sms" ? "SMS" : "Email"}
                    </span>
                  </div>
                </li>
              ))}
              {!backInStock.alertCustomers?.length && (
                <li className="ws-metrics-empty">
                  No alert requests in this date range.
                </li>
              )}
            </ul>
          </MetricColumn>

          <MetricColumn
            title="Popular Products"
            subtitle="Products with the most alert requests"
            reportTo={backInStockReport("alerts", "requested-products")}
          >
            <ProductList
              rows={requestedRows}
              placeholder="!"
              emptyText="No alert requests in this date range."
            />
          </MetricColumn>

          <MetricColumn
            title="Running out soon"
            subtitle="High-demand alert products that are out of stock"
            reportTo={backInStockReport("stock", "out-of-stock")}
          >
            <ProductList
              rows={requestedOutOfStockRows}
              placeholder="!"
              emptyText="No high-demand alert products are out of stock."
            />
          </MetricColumn>
        </div>
      )}

      <p className="ws-metrics-note">
        {activeView === "wishlist" ? (
          <>
            Currently saved items added between {data.from} and {data.to} (UTC).
            Showing up to 20 entries per column; reports include all results.
            Running out soon lists the most-wishlisted products that are also
            currently out of stock, so restocking them protects existing demand.
            Values estimate one unit per product at its current minimum price;
            inventory is current.
          </>
        ) : (
          <>
            Customer requests cover {backInStock.from} to {backInStock.to}{" "}
            (UTC). Showing up to 20 customers; the detailed report includes all
            results. Running out soon lists the products with the most alert
            requests that are also currently out of stock. Inventory is current.
          </>
        )}
      </p>

    </section>
  );
}