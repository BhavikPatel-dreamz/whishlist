import { Form, Link, useNavigation } from "@remix-run/react";
import { shopperValue, type MetricsData } from "../lib/analytics-metrics";

export function MetricsDateFilter({
  data,
  action,
  kind,
}: {
  data: MetricsData;
  action: string;
  kind?: string;
}) {
  const navigation = useNavigation();
  return (
    <Form method="get" action={action} className="ws-metrics-filter">
      {kind && <input type="hidden" name="kind" value={kind} />}
      <label>
        From{" "}
        <input
          type="date"
          name="from"
          defaultValue={data.from}
          key={`from-${data.from}`}
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
          required
        />
      </label>
      <button type="submit" disabled={navigation.state !== "idle"}>
        {navigation.state !== "idle" ? "Loading…" : "Apply"}
      </button>
    </Form>
  );
}

export function AnalyticsMetrics({ data }: { data: MetricsData }) {
  const query = new URLSearchParams({ from: data.from, to: data.to });
  const report = (kind: string) => `/app/analytics?${query}&kind=${kind}`;
  return (
    <section className="ws-metrics" aria-labelledby="ws-metrics-heading">
      <header className="ws-metrics-heading">
        <div>
          <h2 id="ws-metrics-heading">Metrics</h2>
          <p>Here is how your store is performing</p>
        </div>
        <MetricsDateFilter data={data} action="/app" />
      </header>
      {data.error && <p role="alert">{data.error} Showing the last 7 days.</p>}
      <div className="ws-metrics-columns">
        <section className="ws-metrics-column">
          <h3>Shoppers</h3>
          <p>Who saved the most products</p>
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
              <li>No wishlist shoppers in this date range.</li>
            )}
          </ul>
          <Link to={report("shoppers")}>
            Detailed Report <span aria-hidden="true">→</span>
          </Link>
        </section>
        {(
          [
            {
              key: "popular",
              title: "Popular Products",
              subtitle: "Wishlisted by most shoppers",
              rows: data.popular,
            },
            {
              key: "running-low",
              title: "Running out soon",
              subtitle: "Currently out-of-stock products",
              rows: data.runningLow,
            },
          ] as const
        ).map((column) => (
          <section className="ws-metrics-column" key={column.key}>
            <h3>{column.title}</h3>
            <p>{column.subtitle}</p>
            <ul className="ws-metrics-list">
              {column.rows.slice(0, 20).map((row) => (
                <li key={row.productId}>
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                    />
                  ) : (
                    <span className="ws-metrics-placeholder" aria-hidden="true">
                      ♡
                    </span>
                  )}
                  <div>
                    <strong title={row.title}>{row.title}</strong>
                    <span>
                      {column.key === "running-low"
                        ? `Out of stock · ${row.stock} units`
                        : `${row.shoppers} shoppers`}
                    </span>
                  </div>
                </li>
              ))}
              {!column.rows.length && (
                <li>
                  {column.key === "popular"
                    ? "No wishlist products in this date range."
                    : "No out-of-stock products in your store."}
                </li>
              )}
            </ul>
            <Link to={report(column.key)}>
              Detailed Report <span aria-hidden="true">→</span>
            </Link>
          </section>
        ))}
      </div>
      <p className="ws-metrics-note">
        Currently saved items added between {data.from} and {data.to} (UTC).
        Showing up to 20 entries per column; reports include all results.
        Running out soon shows active, inventory-tracked products with zero or
        fewer units across all locations that were also saved during the selected
        date range. Values estimate one unit per product at its current minimum
        price; inventory is current.
      </p>
    </section>
  );
}
