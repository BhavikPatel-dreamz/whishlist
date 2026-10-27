import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import type { RecurringCustomerDetail } from "../../lib/recurring-customer-detail";
import "./product-detail.css";

type FetcherData = RecurringCustomerDetail | { error: string };

function isDetail(value: FetcherData | undefined): value is RecurringCustomerDetail {
  return Boolean(value && "customerId" in value && "orderDetails" in value);
}

function fmtN(value: number) {
  return value.toLocaleString("en-US");
}

function fmtMoney(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function RecurringCustomerDetailPage({
  customerId,
  from,
  to,
  onBack,
}: {
  customerId: string;
  from: string;
  to: string;
  onBack: () => void;
}) {
  const fetcher = useFetcher<FetcherData>();
  const loadedKey = useRef<string | null>(null);
  const url = `/app/api/analytics/recurring-customer-detail?customerId=${encodeURIComponent(customerId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  useEffect(() => {
    if (loadedKey.current === url) return;
    loadedKey.current = url;
    fetcher.load(url);
  }, [url, fetcher]);

  const detail = isDetail(fetcher.data) ? fetcher.data : null;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const loading = fetcher.state !== "idle" && !detail;
  const metrics = detail
    ? [
        ["Saves", detail.saves],
        ["Subscriptions", detail.subscriptions],
        ["Clicks", detail.clicks],
        ["Orders", detail.orders],
        ["Spend", fmtMoney(detail.spend)],
      ] as Array<[string, string | number]>
    : [];

  return (
    <div className="pd">
      <main className="pd-wrap">
        <button type="button" className="pd-back" onClick={onBack}>
          &larr; Back to analytics
        </button>
        <header className="pd-head">
          <span className="pd-thumb pd-customer-mark" aria-hidden="true">
            {detail?.customer.slice(0, 1).toUpperCase() ?? "C"}
          </span>
          <div>
            <h1>{detail?.customer ?? "Customer details"}</h1>
            <p className="pd-sub">
              {from} to {to} · customer activity and purchases
            </p>
          </div>
        </header>

        {loading && (
          <p className="pd-state" role="status">
            Loading customer details…
          </p>
        )}
        {error && (
          <p className="pd-state pd-state--err" role="alert">
            {error}{" "}
            <button type="button" className="pd-back" onClick={() => fetcher.load(url)}>
              Try again
            </button>
          </p>
        )}
        {detail && (
          <>
            <div className="pd-kpis">
              {metrics.map(([label, value]) => (
                <div className="pd-kpi pd-kpi--static" key={label}>
                  <span>{label}</span>
                  <strong>{typeof value === "number" ? fmtN(value) : value}</strong>
                </div>
              ))}
            </div>

            <section className="pd-card">
              <div className="pd-card-head">
                <h2>Attributed purchases</h2>
                <span className="pd-count">{fmtN(detail.orderDetails.length)}</span>
              </div>
              <p className="pd-note">Purchases attributed to this customer during the selected date range.</p>
              {detail.orderDetails.length ? (
                <div className="pd-tw">
                  <table className="pd-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Date</th>
                        <th>Product purchased</th>
                        <th>Variant</th>
                        <th>Source</th>
                        <th className="pd-n">Quantity</th>
                        <th className="pd-n">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.orderDetails.flatMap((order) =>
                        order.products.map((product, index) => (
                          <tr key={`${order.orderId}:${product.title}:${index}`}>
                            <td>{order.orderNumber}</td>
                            <td>{new Date(order.orderedAt).toISOString().slice(0, 10)}</td>
                            <td>{product.title}</td>
                            <td>{product.variant}</td>
                            <td>{product.source}</td>
                            <td className="pd-n">{fmtN(product.quantity)}</td>
                            <td className="pd-n">{fmtMoney(product.revenue)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="pd-empty">
                  No attributed purchases for this customer in the selected range.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
