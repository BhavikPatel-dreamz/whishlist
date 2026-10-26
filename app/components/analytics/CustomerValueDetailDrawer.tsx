import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import type {
  CustomerValueDetail,
  CustomerValueSegment,
} from "../../lib/customer-value-detail";

type FetcherData = CustomerValueDetail | { error: string };

function isDetail(value: FetcherData | undefined): value is CustomerValueDetail {
  return Boolean(value && "segment" in value && "rows" in value);
}

function fmtN(value: number) {
  return value.toLocaleString("en-US");
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

function fmtMoney(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function CustomerValueDetailDrawer({
  segment,
  from,
  to,
  onClose,
}: {
  segment: CustomerValueSegment;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<FetcherData>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const url = `/app/api/analytics/customer-value-detail?segment=${encodeURIComponent(segment)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  useEffect(() => {
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
        aria-labelledby="ca-customer-detail-title"
      >
        <header className="ca-drawer-head">
          <div className="ca-drawer-title">
            <div>
              <h2 id="ca-customer-detail-title">
                {detail?.title ?? "Customer details"}
              </h2>
              <p className="ca-mu">{from} to {to} · customer orders and products</p>
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
                <div className="ca-kpi"><span>Customers</span><strong>{fmtN(detail.customers)}</strong></div>
                <div className="ca-kpi"><span>Orders</span><strong>{fmtN(detail.orders)}</strong></div>
                <div className="ca-kpi"><span>Products</span><strong>{fmtN(detail.products)}</strong></div>
              </div>
              {detail.rows.length ? (
                <div className="ca-tw">
                  <table className="ca-table ca-table--compact">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Order</th>
                        <th>Date</th>
                        <th>Product</th>
                        <th>Variant</th>
                        <th>Source</th>
                        <th className="ca-n">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.rows.map((row, index) => (
                        <tr key={`${row.order}:${row.product}:${index}`}>
                          <td>{row.customer}</td>
                          <td>{row.order}</td>
                          <td>{fmtDate(row.orderedAt)}</td>
                          <td>{row.product}</td>
                          <td>{row.variant}</td>
                          <td>{row.source || "—"}</td>
                          <td className="ca-n">{fmtMoney(row.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ca-empty">No customer orders or products in this date range.</div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
