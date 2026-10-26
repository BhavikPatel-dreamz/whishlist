import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import type { RecurringCustomerDetail } from "../../lib/recurring-customer-detail";

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

export function RecurringCustomerDetailDrawer({
  customerId,
  from,
  to,
  onClose,
}: {
  customerId: string;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<FetcherData>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadedKey = useRef<string | null>(null);
  const url = `/app/api/analytics/recurring-customer-detail?customerId=${encodeURIComponent(customerId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  useEffect(() => {
    if (loadedKey.current === url) return;
    loadedKey.current = url;
    fetcher.load(url);
  }, [url, fetcher]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

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
    <div
      className="ca-drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="ca-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ca-recurring-customer-title"
      >
        <header className="ca-drawer-head">
          <div className="ca-drawer-title">
            <div>
              <h2 id="ca-recurring-customer-title">
                {detail?.customer ?? "Customer details"}
              </h2>
              <p className="ca-mu">{from} to {to} · customer activity and purchases</p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="ca-drawer-close"
            onClick={onClose}
            aria-label="Close customer details"
          >
            ✕
          </button>
        </header>
        <div className="ca-drawer-body">
          {loading && <p className="ca-drawer-state" role="status">Loading customer details…</p>}
          {error && (
            <div className="ca-drawer-state ca-r" role="alert">
              {error}{" "}
              <button type="button" className="ca-link" onClick={() => fetcher.load(url)}>
                Try again
              </button>
            </div>
          )}
          {detail && (
            <>
              <div className="ca-drawer-kpis">
                {metrics.map(([label, value]) => (
                  <div className="ca-kpi" key={label}>
                    <span>{label}</span>
                    <strong>{typeof value === "number" ? fmtN(value) : value}</strong>
                  </div>
                ))}
              </div>
              {detail.orderDetails.length ? (
                <div className="ca-tw">
                  <table className="ca-table ca-table--compact">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Date</th>
                        <th>Product purchased</th>
                        <th>Variant</th>
                        <th>Source</th>
                        <th className="ca-n">Quantity</th>
                        <th className="ca-n">Revenue</th>
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
                            <td className="ca-n">{fmtN(product.quantity)}</td>
                            <td className="ca-n">{fmtMoney(product.revenue)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ca-empty">No attributed purchases for this customer in the selected range.</div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
