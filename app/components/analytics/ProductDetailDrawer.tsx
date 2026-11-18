import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "@remix-run/react";
import type { ProductDetail } from "../../lib/product-detail";
import "./product-detail.css";

type FetcherData = ProductDetail | { error: string };
type ProductDetailPanel =
  | "saves"
  | "subscriptions"
  | "pendingAlerts"
  | "notifications"
  | "orders"
  | "revenue";

const PRODUCT_DETAIL_PAGE_SIZE = 10;

function isDetail(value: FetcherData | undefined): value is ProductDetail {
  return Boolean(value && "summary" in value);
}

function fmtN(value: number) {
  return value.toLocaleString("en-US");
}

function fmtMoney(value: number, currency: string | null) {
  if (!currency) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function sourceLabel(source: string) {
  if (source === "WISHLIST") return "Wishlist";
  if (source === "RESTOCK_ALERT") return "Back in stock";
  return source;
}

function typeLabel(type: string) {
  if (type === "DIRECT") return "Direct";
  if (type === "ESTIMATED") return "Estimated";
  return type;
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["SENT", "DELIVERED", "CONFIRMED"].includes(value)) return "pd-badge--g";
  if (["FAILED", "BOUNCED", "CANCELLED"].includes(value)) return "pd-badge--r";
  return "pd-badge--a";
}

function Badge({ status }: { status: string }) {
  const tone = statusTone(status);
  return <span className={`pd-badge ${tone}`}>{status}</span>;
}

function Panel({
  title,
  count,
  note,
  pagination,
  empty,
  head,
  foot,
  children,
}: {
  title: string;
  count: number;
  note: string;
  pagination?: {
    page: number;
    pageCount: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  empty: string;
  head: ReactNode;
  foot?: ReactNode;
  children: ReactNode[];
}) {
  return (
    <section className="pd-card">
      <div className="pd-card-head">
        <h2>{title}</h2>
        <span className="pd-count">{fmtN(count)}</span>
      </div>
      <p className="pd-note">{note}</p>
      {children.length ? (
        <div className="pd-tw">
          <table className="pd-table">
            <thead><tr>{head}</tr></thead>
            <tbody>{children}</tbody>
            {foot}
          </table>
        </div>
      ) : (
        <p className="pd-empty">{empty}</p>
      )}
      {pagination && pagination.pageCount > 1 && (
        <div className="pd-pagination" aria-label={`${title} pages`}>
          <span>
            {(pagination.page - 1) * PRODUCT_DETAIL_PAGE_SIZE + 1}–
            {Math.min(pagination.page * PRODUCT_DETAIL_PAGE_SIZE, pagination.total)} of {fmtN(pagination.total)}
          </span>
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => pagination.onPageChange(pagination.page - 1)}
          >
            Previous
          </button>
          <span>Page {pagination.page} of {pagination.pageCount}</span>
          <button
            type="button"
            disabled={pagination.page >= pagination.pageCount}
            onClick={() => pagination.onPageChange(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

function DetailBody({ detail, variantId }: { detail: ProductDetail; variantId?: string }) {
  const [selectedPanel, setSelectedPanel] = useState<ProductDetailPanel | null>(null);
  const [page, setPage] = useState(1);
  const { product, summary, range } = detail;
  const currency = product.currencyCode;
  const money = (value: number) => fmtMoney(value, currency);
  const subscriptionVariant = product.variants.find((v) => v.variantId === variantId);

  const kpis: Array<[ProductDetailPanel, string, string]> = [
    ["saves", "Saves", fmtN(summary.saves)],
    ["subscriptions", "Subscriptions", fmtN(summary.subscriptions)],
    ["pendingAlerts", "Pending alerts", fmtN(summary.pendingAlerts)],
    ["notifications", "Notifications sent", fmtN(summary.notificationsSent)],
  ];

  useEffect(() => setPage(1), [selectedPanel]);

  const paginateRows = <T,>(rows: T[]) => {
    const pageCount = Math.max(1, Math.ceil(rows.length / PRODUCT_DETAIL_PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    return {
      rows: rows.slice(
        (currentPage - 1) * PRODUCT_DETAIL_PAGE_SIZE,
        currentPage * PRODUCT_DETAIL_PAGE_SIZE,
      ),
      page: currentPage,
      pageCount,
      total: rows.length,
      onPageChange: setPage,
    };
  };
  const savers = paginateRows(detail.savers);
  const subscriptions = paginateRows(detail.subscriptions);
  const pendingAlerts = paginateRows(detail.pendingAlerts);
  const notifications = paginateRows(detail.notifications);
  const orders = paginateRows(detail.orders);

  return (
    <>
      <div className="pd-meta">
        <span className="pd-badge pd-badge--g">{product.status}</span>
        {product.price && currency && <span>{fmtMoney(Number(product.price), currency)}</span>}
        <span>{fmtN(product.totalInventory)} in stock</span>
        <span>{range.from} to {range.to} (UTC)</span>
        {product.onlineStoreUrl && (
          <a href={product.onlineStoreUrl} target="_blank" rel="noopener noreferrer">View product ↗</a>
        )}
      </div>

      {selectedPanel === null ? (
        <>
          <div className="pd-kpis">
            {kpis.map(([panel, label, value]) => (
              <button
                key={panel}
                type="button"
                className="pd-kpi"
                onClick={() => setSelectedPanel(panel)}
                aria-label={`View ${label.toLowerCase()} details`}
              >
                <span>{label}</span>
                <strong>{value}</strong>
              </button>
            ))}
          </div>
          <p className="pd-hint">Click a card to see its details below.</p>
        </>
      ) : (
        <button type="button" className="pd-back" onClick={() => setSelectedPanel(null)}>
          &larr; Back to product metrics
        </button>
      )}

      {selectedPanel === "saves" && (
        <Panel
          title="Saves"
          count={summary.uniqueSavers}
          note={variantId
            ? `Distinct customers or guest devices who saved this variant from ${range.from} to ${range.to}.`
            : "Distinct customers or guest devices with a wishlist save in the selected range."}
          pagination={savers}
          empty="No wishlist saves for this product in the selected range."
          head={<><th>Shopper</th><th>Type</th><th className="pd-n">Saves</th><th>First saved</th><th>Last saved</th><th>Source</th></>}
        >
          {savers.rows.map((s) => (
            <tr key={s.id}>
              <td title={s.name}>{s.name}</td>
              <td><span className={`pd-badge ${s.type === "customer" ? "pd-badge--b" : "pd-badge--a"}`}>{s.type === "customer" ? "Customer" : "Guest"}</span></td>
              <td className="pd-n">{fmtN(s.saves)}</td>
              <td>{fmtDate(s.firstSavedAt)}</td>
              <td>{fmtDate(s.lastSavedAt)}</td>
              <td>{s.source ?? "—"}{s.device ? ` · ${s.device}` : ""}</td>
            </tr>
          ))}
        </Panel>
      )}

      {selectedPanel === "subscriptions" && (
        <Panel
          title={subscriptionVariant ? `Subscriptions · ${subscriptionVariant.title}` : "Subscriptions"}
          count={summary.subscriptions}
          note={variantId
            ? "All recorded subscriptions for this variant; other product details use the selected date range."
            : "Back-in-stock alert subscriptions created in the selected range."}
          pagination={subscriptions}
          empty="No back-in-stock subscriptions for this product in the selected range."
          head={<><th>Contact</th><th>Channel</th><th>Variant</th><th>Status</th><th>Signed up</th><th>Notified</th><th>Purchase</th></>}
        >
          {subscriptions.rows.map((a) => (
            <tr key={a.id}>
              <td>{a.contact}</td>
              <td>{a.channel === "sms" ? "SMS" : a.channel}</td>
              <td>{a.variantTitle}</td>
              <td><Badge status={a.status} /></td>
              <td>{fmtDate(a.createdAt)}</td>
              <td>{fmtDate(a.notifiedAt)}</td>
              <td>
                {a.purchasedAt
                  ? `${a.purchaseOrderId ?? "Order"} · ${fmtMoney(a.purchaseRevenue ?? 0, a.purchaseCurrency ?? currency)}`
                  : "—"}
              </td>
            </tr>
          ))}
        </Panel>
      )}

      {selectedPanel === "pendingAlerts" && (
        <Panel
          title="Pending alerts"
          count={summary.pendingAlerts}
          note="Waiting alerts (PENDING, CONFIRMED or SENDING) that have not been notified yet."
          pagination={pendingAlerts}
          empty="No alerts are waiting for this product in the selected range."
          head={<><th>Contact</th><th>Channel</th><th>Variant</th><th>Status</th><th>Reason</th><th>Requested</th></>}
        >
          {pendingAlerts.rows.map((a) => (
            <tr key={a.id}>
              <td>{a.contact}</td>
              <td>{a.channel === "sms" ? "SMS" : a.channel}</td>
              <td>{a.variantTitle}</td>
              <td><Badge status={a.status} /></td>
              <td>{a.pendingReason ?? "—"}</td>
              <td>{fmtDate(a.createdAt)}</td>
            </tr>
          ))}
        </Panel>
      )}

      {selectedPanel === "notifications" && (
        <Panel
          title="Notification sends"
          count={detail.notifications.length}
          note="Notification log entries created in the selected range. Sent does not confirm delivery or opening."
          pagination={notifications}
          empty="No notifications recorded for this product in the selected range."
          head={<><th>Created</th><th>Sent</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Delivered</th><th>Opened</th><th>Clicked</th></>}
        >
          {notifications.rows.map((log) => (
            <tr
              key={log.id}
              title={log.errorReason ? `Error: ${log.errorReason}` : log.retryCount ? `Retries: ${log.retryCount}` : undefined}
            >
              <td>{fmtDate(log.createdAt)}</td>
              <td>{fmtDate(log.sentAt)}</td>
              <td>{log.recipient}</td>
              <td>{log.channel}</td>
              <td><Badge status={log.status} /></td>
              <td>{fmtDate(log.deliveredAt)}</td>
              <td>{fmtDate(log.openedAt)}</td>
              <td>{fmtDate(log.clickedAt)}</td>
            </tr>
          ))}
        </Panel>
      )}

      {selectedPanel === "orders" && (
        <Panel
          title="Attributed orders"
          count={summary.attributedOrders}
          note="Last-click attribution. Revenue is the attributed line-item total after discounts."
          pagination={orders}
          empty="No attributed orders for this product in the selected range."
          head={<><th>Order</th><th>Date</th><th>Customer</th><th>Source</th><th>Attribution</th><th className="pd-n">Units</th><th className="pd-n">Revenue</th></>}
        >
          {orders.rows.map((o) => (
            <tr key={o.id}>
              <td>{o.orderNumber}</td>
              <td>{fmtDate(o.orderedAt)}</td>
              <td>{o.customer}</td>
              <td>{o.sources.map(sourceLabel).join(", ")}</td>
              <td>
                {o.types.map((t) => (
                  <span key={t} className={`pd-badge ${t === "DIRECT" ? "pd-badge--b" : "pd-badge--a"}`}>{typeLabel(t)}</span>
                ))}
              </td>
              <td className="pd-n">{fmtN(o.quantity)}</td>
              <td className="pd-n">{money(o.revenue)}</td>
            </tr>
          ))}
        </Panel>
      )}

      {selectedPanel === "revenue" && (
        <Panel
          title="Attributed revenue"
          count={detail.revenue.length}
          note="Revenue split by source and attribution type."
          empty="No attributed revenue for this product in the selected range."
          head={<><th>Source</th><th>Attribution</th><th className="pd-n">Orders</th><th className="pd-n">Units</th><th className="pd-n">Revenue</th></>}
          foot={
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="pd-n">{fmtN(summary.attributedOrders)}</td>
                <td className="pd-n">{fmtN(summary.attributedUnits)}</td>
                <td className="pd-n">{money(summary.attributedRevenue)}</td>
              </tr>
            </tfoot>
          }
        >
          {detail.revenue.map((row) => (
            <tr key={`${row.source}:${row.type}`}>
              <td>{sourceLabel(row.source)}</td>
              <td><span className={`pd-badge ${row.type === "DIRECT" ? "pd-badge--b" : "pd-badge--a"}`}>{typeLabel(row.type)}</span></td>
              <td className="pd-n">{fmtN(row.orders)}</td>
              <td className="pd-n">{fmtN(row.units)}</td>
              <td className="pd-n">{money(row.revenue)}</td>
            </tr>
          ))}
        </Panel>
      )}
    </>
  );
}

export function ProductDetailPage({
  productId,
  variantId,
  from,
  to,
  onBack,
}: {
  productId: string;
  variantId?: string;
  from: string;
  to: string;
  onBack: () => void;
}) {
  const fetcher = useFetcher<FetcherData>();
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${productId}|${variantId ?? ""}|${from}|${to}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    fetcher.load(
      `/app/api/analytics/product/${encodeURIComponent(productId)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ""}`,
    );
  }, [productId, variantId, from, to, fetcher]);

  const detail = isDetail(fetcher.data) ? fetcher.data : null;
  const error =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const loading = fetcher.state !== "idle" && !detail;
  const selectedVariant = detail?.product.variants.find(
    (variant) => variant.variantId === variantId,
  );

  return (
    <div className="pd">
      <main className="pd-wrap">
        <button type="button" className="pd-back" onClick={onBack}>
          &larr; Back to analytics
        </button>

        <header className="pd-head">
          {detail?.product.imageUrl ? (
            <img className="pd-thumb" src={detail.product.imageUrl} alt="" width={44} height={44} loading="lazy" />
          ) : (
            <span className="pd-thumb" aria-hidden="true">♡</span>
          )}
          <div>
            <h1>{detail?.product.title ?? "Product details"}</h1>
            <p className="pd-sub">
              {detail
                ? `${variantId ? `Variant: ${selectedVariant?.title ?? variantId} · ` : ""}Wishlist, back-in-stock and attribution · ${from} to ${to}`
                : "Loading wishlist, back-in-stock and attribution data"}
            </p>
          </div>
        </header>

        {loading && <p className="pd-state" role="status">Loading product details…</p>}
        {error && <p className="pd-state pd-state--err" role="alert">{error}</p>}
        {detail && <DetailBody detail={detail} variantId={variantId} />}
      </main>
    </div>
  );
}