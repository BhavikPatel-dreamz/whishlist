import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import {
  PRODUCT_DETAIL_ROW_LIMIT,
  type ProductDetail,
} from "../../lib/product-detail";

type FetcherData = ProductDetail | { error: string };

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
  if (["SENT", "DELIVERED", "CONFIRMED"].includes(value)) return "ca-g";
  if (["FAILED", "BOUNCED", "CANCELLED"].includes(value)) return "ca-r";
  return "ca-a";
}

function Section({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ca-detail-section">
      <div className="ca-detail-head">
        <h3 className="ca-h3">{title}</h3>
        <span className="ca-badge">{fmtN(count)}</span>
      </div>
      <p className="ca-mu">{note}</p>
      {children}
    </section>
  );
}

function LimitNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="ca-mu">
      Showing the first {fmtN(shown)} of {fmtN(total)}.
    </p>
  );
}

function DetailBody({
  detail,
  variantId,
}: {
  detail: ProductDetail;
  variantId?: string;
}) {
  const { product, summary, range, revenueLabel } = detail;
  const currency = product.currencyCode;
  const money = (value: number) => fmtMoney(value, currency);
  const subscriptionVariant = product.variants.find(
    (variant) => variant.variantId === variantId,
  );

  const kpis: Array<[string, string]> = [
    ["Saves", fmtN(summary.saves)],
    ["Unique savers", fmtN(summary.uniqueSavers)],
    ["Subscriptions", fmtN(summary.subscriptions)],
    ["Pending alerts", fmtN(summary.pendingAlerts)],
    ["Notifications sent", fmtN(summary.notificationsSent)],
    ["Attributed orders", fmtN(summary.attributedOrders)],
    ["Attributed revenue", money(summary.attributedRevenue)],
  ];

  const savers = detail.savers.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const subscriptions = detail.subscriptions.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const pendingAlerts = detail.pendingAlerts.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const notifications = detail.notifications.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const orders = detail.orders.slice(0, PRODUCT_DETAIL_ROW_LIMIT);

  return (
    <>
      <div className="ca-drawer-meta">
        <span className="ca-badge">{product.status}</span>
        {product.price && currency && (
          <span>{fmtMoney(Number(product.price), currency)}</span>
        )}
        <span>{fmtN(product.totalInventory)} in stock</span>
        <span>
          {range.from} to {range.to} (UTC)
        </span>
        {product.onlineStoreUrl && (
          <a
            className="ca-drawer-link"
            href={product.onlineStoreUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View product ↗
          </a>
        )}
      </div>

      <div className="ca-drawer-kpis">
        {kpis.map(([label, value]) => (
          <div className="ca-kpi" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <Section
        title="Unique savers"
        count={summary.uniqueSavers}
        note={variantId
          ? `Distinct customers or guest devices who saved this variant from ${range.from} to ${range.to}.`
          : "Distinct customers or guest devices with a wishlist save in the selected range."}
      >
        {savers.length ? (
          <div className="ca-tw">
            <table className="ca-table ca-table--compact">
              <thead>
                <tr>
                  <th>Shopper</th>
                  <th>Type</th>
                  <th className="ca-n">Saves</th>
                  <th>First saved</th>
                  <th>Last saved</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {savers.map((saver) => (
                  <tr key={saver.id}>
                    <td title={saver.name}>{saver.name}</td>
                    <td>
                      <span
                        className={`ca-badge ${
                          saver.type === "customer" ? "ca-b" : "ca-a"
                        }`}
                      >
                        {saver.type === "customer" ? "Customer" : "Guest"}
                      </span>
                    </td>
                    <td className="ca-n">{fmtN(saver.saves)}</td>
                    <td>{fmtDate(saver.firstSavedAt)}</td>
                    <td>{fmtDate(saver.lastSavedAt)}</td>
                    <td>
                      {saver.source ?? "—"}
                      {saver.device ? ` · ${saver.device}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ca-drawer-empty">
            No wishlist saves for this product in the selected range.
          </p>
        )}
        <LimitNote shown={savers.length} total={detail.savers.length} />
      </Section>

      <Section
        title={subscriptionVariant ? `Subscriptions · ${subscriptionVariant.title}` : "Subscriptions"}
        count={summary.subscriptions}
        note={variantId
          ? "All recorded subscriptions for this variant; other product details use the selected date range."
          : "Back-in-stock alert subscriptions created in the selected range."}
      >
        {subscriptions.length ? (
          <div className="ca-tw">
            <table className="ca-table ca-table--compact">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Channel</th>
                  <th>Variant</th>
                  <th>Status</th>
                  <th>Signed up</th>
                  <th>Notified</th>
                  <th>Purchase</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((alert) => (
                  <tr key={alert.id}>
                    <td>{alert.contact}</td>
                    <td>{alert.channel === "sms" ? "SMS" : alert.channel}</td>
                    <td>{alert.variantTitle}</td>
                    <td>
                      <span className={`ca-badge ${statusTone(alert.status)}`}>
                        {alert.status}
                      </span>
                    </td>
                    <td>{fmtDate(alert.createdAt)}</td>
                    <td>{fmtDate(alert.notifiedAt)}</td>
                    <td>
                      {alert.purchasedAt
                        ? `${alert.purchaseOrderId ?? "Order"} · ${fmtMoney(
                            alert.purchaseRevenue ?? 0,
                            alert.purchaseCurrency ?? currency,
                          )}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ca-drawer-empty">
            No back-in-stock subscriptions for this product in the selected
            range.
          </p>
        )}
        <LimitNote shown={subscriptions.length} total={detail.subscriptions.length} />
      </Section>

      <Section
        title="Pending alerts"
        count={summary.pendingAlerts}
        note="Waiting alerts (PENDING, CONFIRMED or SENDING) that have not been notified yet."
      >
        {pendingAlerts.length ? (
          <div className="ca-tw">
            <table className="ca-table ca-table--compact">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Channel</th>
                  <th>Variant</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {pendingAlerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>{alert.contact}</td>
                    <td>{alert.channel === "sms" ? "SMS" : alert.channel}</td>
                    <td>{alert.variantTitle}</td>
                    <td>
                      <span className={`ca-badge ${statusTone(alert.status)}`}>
                        {alert.status}
                      </span>
                    </td>
                    <td>{alert.pendingReason ?? "—"}</td>
                    <td>{fmtDate(alert.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ca-drawer-empty">
            No alerts are waiting for this product in the selected range.
          </p>
        )}
        <LimitNote shown={pendingAlerts.length} total={detail.pendingAlerts.length} />
      </Section>

      <Section
        title="Notification sends"
        count={detail.notifications.length}
        note="Notification log entries created in the selected range. Sent does not confirm delivery or opening."
      >
        {notifications.length ? (
          <div className="ca-tw">
            <table className="ca-table ca-table--compact">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Sent</th>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Delivered</th>
                  <th>Opened</th>
                  <th>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((log) => (
                  <tr
                    key={log.id}
                    title={
                      log.errorReason
                        ? `Error: ${log.errorReason}`
                        : log.retryCount
                          ? `Retries: ${log.retryCount}`
                          : undefined
                    }
                  >
                    <td>{fmtDate(log.createdAt)}</td>
                    <td>{fmtDate(log.sentAt)}</td>
                    <td>{log.recipient}</td>
                    <td>{log.channel}</td>
                    <td>
                      <span className={`ca-badge ${statusTone(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td>{fmtDate(log.deliveredAt)}</td>
                    <td>{fmtDate(log.openedAt)}</td>
                    <td>{fmtDate(log.clickedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ca-drawer-empty">
            No notifications recorded for this product in the selected range.
          </p>
        )}
        <LimitNote shown={notifications.length} total={detail.notifications.length} />
      </Section>

      <Section
        title="Attributed orders"
        count={summary.attributedOrders}
        note="Last-click attribution. Revenue is the attributed line-item total after discounts."
      >
        {orders.length ? (
          <div className="ca-tw">
            <table className="ca-table ca-table--compact">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Source</th>
                  <th>Attribution</th>
                  <th className="ca-n">Units</th>
                  <th className="ca-n">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.orderNumber}</td>
                    <td>{fmtDate(order.orderedAt)}</td>
                    <td>{order.customer}</td>
                    <td>{order.sources.map(sourceLabel).join(", ")}</td>
                    <td>
                      {order.types.map((type) => (
                        <span
                          key={type}
                          className={`ca-badge ${
                            type === "DIRECT" ? "ca-b" : "ca-a"
                          }`}
                        >
                          {typeLabel(type)}
                        </span>
                      ))}
                    </td>
                    <td className="ca-n">{fmtN(order.quantity)}</td>
                    <td className="ca-n">{money(order.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ca-drawer-empty">
            No attributed orders for this product in the selected range.
          </p>
        )}
        <LimitNote shown={orders.length} total={detail.orders.length} />
      </Section>

      <Section
        title="Attributed revenue"
        count={detail.revenue.length}
        note={
          detail.revenue.length
            ? `Revenue split by source and attribution type. This product's revenue is ${revenueLabel}.`
            : "Revenue split by source and attribution type."
        }
      >
        {detail.revenue.length ? (
          <div className="ca-tw">
            <table className="ca-table ca-table--compact">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Attribution</th>
                  <th className="ca-n">Orders</th>
                  <th className="ca-n">Units</th>
                  <th className="ca-n">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {detail.revenue.map((row) => (
                  <tr key={`${row.source}:${row.type}`}>
                    <td>{sourceLabel(row.source)}</td>
                    <td>
                      <span
                        className={`ca-badge ${
                          row.type === "DIRECT" ? "ca-b" : "ca-a"
                        }`}
                      >
                        {typeLabel(row.type)}
                      </span>
                    </td>
                    <td className="ca-n">{fmtN(row.orders)}</td>
                    <td className="ca-n">{fmtN(row.units)}</td>
                    <td className="ca-n">{money(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    <strong>Total</strong>
                  </td>
                  <td className="ca-n">{fmtN(summary.attributedOrders)}</td>
                  <td className="ca-n">{fmtN(summary.attributedUnits)}</td>
                  <td className="ca-n">
                    <strong>{money(summary.attributedRevenue)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="ca-drawer-empty">
            No attributed revenue for this product in the selected range.
          </p>
        )}
      </Section>
    </>
  );
}

export function ProductDetailDrawer({
  productId,
  variantId,
  from,
  to,
  onClose,
}: {
  productId: string;
  variantId?: string;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<FetcherData>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${productId}|${variantId ?? ""}|${from}|${to}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    fetcher.load(
      `/app/api/analytics/product/${encodeURIComponent(productId)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ""}`,
    );
  }, [productId, variantId, from, to, fetcher]);

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
  const error =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const loading = fetcher.state !== "idle" && !detail;
  const selectedVariant = detail?.product.variants.find(
    (variant) => variant.variantId === variantId,
  );

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
        aria-labelledby="ca-drawer-title"
      >
        <header className="ca-drawer-head">
          <div className="ca-drawer-title">
            {detail?.product.imageUrl ? (
              <img
                src={detail.product.imageUrl}
                alt=""
                width={44}
                height={44}
                loading="lazy"
              />
            ) : (
              <span className="ca-drawer-thumb" aria-hidden="true">
                ♡
              </span>
            )}
            <div>
              <h2 id="ca-drawer-title">
                {detail?.product.title ?? "Product details"}
              </h2>
              <p className="ca-mu">
                {detail
                  ? `${variantId ? `Variant: ${selectedVariant?.title ?? variantId} · ` : ""}Wishlist, back-in-stock and attribution · ${from} to ${to}`
                  : "Loading wishlist, back-in-stock and attribution data"}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="ca-drawer-close"
            onClick={onClose}
            aria-label="Close product details"
          >
            ✕
          </button>
        </header>

        <div className="ca-drawer-body">
          {loading && (
            <p className="ca-drawer-state" role="status">
              Loading product details…
            </p>
          )}
          {error && (
            <p className="ca-drawer-state ca-r" role="alert">
              {error}
            </p>
          )}
          {detail && (
            <DetailBody detail={detail} variantId={variantId} />
          )}
        </div>
      </aside>
    </div>
  );
}
