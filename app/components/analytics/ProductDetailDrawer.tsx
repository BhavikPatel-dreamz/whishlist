// import { useEffect, useRef, useState } from "react";
// import { useFetcher } from "@remix-run/react";
// import {
//   PRODUCT_DETAIL_ROW_LIMIT,
//   type ProductDetail,
// } from "../../lib/product-detail";

// type FetcherData = ProductDetail | { error: string };
// type ProductDetailPanel =
//   | "saves"
//   | "uniqueSavers"
//   | "subscriptions"
//   | "pendingAlerts"
//   | "notifications"
//   | "orders"
//   | "revenue";

// function isDetail(value: FetcherData | undefined): value is ProductDetail {
//   return Boolean(value && "summary" in value);
// }

// function fmtN(value: number) {
//   return value.toLocaleString("en-US");
// }

// function fmtMoney(value: number, currency: string | null) {
//   if (!currency) {
//     return value.toLocaleString("en-US", {
//       minimumFractionDigits: 2,
//       maximumFractionDigits: 2,
//     });
//   }
//   try {
//     return new Intl.NumberFormat("en-US", {
//       style: "currency",
//       currency,
//       minimumFractionDigits: 2,
//       maximumFractionDigits: 2,
//     }).format(value);
//   } catch {
//     return `${value.toFixed(2)} ${currency}`;
//   }
// }

// function fmtDate(iso: string | null) {
//   if (!iso) return "—";
//   return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
// }

// function sourceLabel(source: string) {
//   if (source === "WISHLIST") return "Wishlist";
//   if (source === "RESTOCK_ALERT") return "Back in stock";
//   return source;
// }

// function typeLabel(type: string) {
//   if (type === "DIRECT") return "Direct";
//   if (type === "ESTIMATED") return "Estimated";
//   return type;
// }

// function statusTone(status: string) {
//   const value = status.toUpperCase();
//   if (["SENT", "DELIVERED", "CONFIRMED"].includes(value)) return "ca-g";
//   if (["FAILED", "BOUNCED", "CANCELLED"].includes(value)) return "ca-r";
//   return "ca-a";
// }

// function Section({
//   title,
//   count,
//   note,
//   children,
// }: {
//   title: string;
//   count: number;
//   note: string;
//   children: React.ReactNode;
// }) {
//   return (
//     <section className="ca-detail-section">
//       <div className="ca-detail-head">
//         <h3 className="ca-h3">{title}</h3>
//         <span className="ca-badge">{fmtN(count)}</span>
//       </div>
//       <p className="ca-mu">{note}</p>
//       {children}
//     </section>
//   );
// }

// function LimitNote({ shown, total }: { shown: number; total: number }) {
//   if (total <= shown) return null;
//   return (
//     <p className="ca-mu">
//       Showing the first {fmtN(shown)} of {fmtN(total)}.
//     </p>
//   );
// }

// function DetailBody({
//   detail,
//   variantId,
// }: {
//   detail: ProductDetail;
//   variantId?: string;
// }) {
//   const [selectedPanel, setSelectedPanel] = useState<ProductDetailPanel | null>(null);
//   const { product, summary, range } = detail;
//   const currency = product.currencyCode;
//   const money = (value: number) => fmtMoney(value, currency);
//   const subscriptionVariant = product.variants.find(
//     (variant) => variant.variantId === variantId,
//   );

//   const kpis: Array<[ProductDetailPanel, string, string]> = [
//     ["saves", "Saves", fmtN(summary.saves)],
//     ["uniqueSavers", "Unique savers", fmtN(summary.uniqueSavers)],
//     ["subscriptions", "Subscriptions", fmtN(summary.subscriptions)],
//     ["pendingAlerts", "Pending alerts", fmtN(summary.pendingAlerts)],
//     ["notifications", "Notifications sent", fmtN(summary.notificationsSent)],
//   ];

//   const savers = detail.savers.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
//   const subscriptions = detail.subscriptions.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
//   const pendingAlerts = detail.pendingAlerts.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
//   const notifications = detail.notifications.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
//   const orders = detail.orders.slice(0, PRODUCT_DETAIL_ROW_LIMIT);

//   return (
//     <>
//       <div className="ca-drawer-meta">
//         <span className="ca-badge">{product.status}</span>
//         {product.price && currency && (
//           <span>{fmtMoney(Number(product.price), currency)}</span>
//         )}
//         <span>{fmtN(product.totalInventory)} in stock</span>
//         <span>
//           {range.from} to {range.to} (UTC)
//         </span>
//         {product.onlineStoreUrl && (
//           <a
//             className="ca-drawer-link"
//             href={product.onlineStoreUrl}
//             target="_blank"
//             rel="noopener noreferrer"
//           >
//             View product ↗
//           </a>
//         )}
//       </div>

//       <div className="ca-drawer-kpis">
//         {selectedPanel === null ? kpis.map(([panel, label, value]) => (
//           <button
//             className="ca-kpi ca-kpi-button"
//             key={panel}
//             type="button"
//             onClick={() => setSelectedPanel(panel)}
//             aria-label={`View ${label.toLowerCase()} details`}
//           >
//             <span>{label}</span>
//             <strong>{value}</strong>
//           </button>
//         )) : null}
//       </div>

//       {selectedPanel && (
//         <div className="ca-detail-view-head">
//           <button
//             type="button"
//             className="ca-link"
//             onClick={() => setSelectedPanel(null)}
//           >
//             &larr; Back to product metrics
//           </button>
//           <h3 className="ca-h3">
//             {kpis.find(([panel]) => panel === selectedPanel)?.[1]} details
//           </h3>
//         </div>
//       )}

//       {(selectedPanel === "saves" || selectedPanel === "uniqueSavers") && (
//       <Section
//         title={selectedPanel === "saves" ? "Saves" : "Unique savers"}
//         count={summary.uniqueSavers}
//         note={variantId
//           ? `Distinct customers or guest devices who saved this variant from ${range.from} to ${range.to}.`
//           : "Distinct customers or guest devices with a wishlist save in the selected range."}
//       >
//         {savers.length ? (
//           <div className="ca-tw">
//             <table className="ca-table ca-table--compact">
//               <thead>
//                 <tr>
//                   <th>Shopper</th>
//                   <th>Type</th>
//                   <th className="ca-n">Saves</th>
//                   <th>First saved</th>
//                   <th>Last saved</th>
//                   <th>Source</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {savers.map((saver) => (
//                   <tr key={saver.id}>
//                     <td title={saver.name}>{saver.name}</td>
//                     <td>
//                       <span
//                         className={`ca-badge ${
//                           saver.type === "customer" ? "ca-b" : "ca-a"
//                         }`}
//                       >
//                         {saver.type === "customer" ? "Customer" : "Guest"}
//                       </span>
//                     </td>
//                     <td className="ca-n">{fmtN(saver.saves)}</td>
//                     <td>{fmtDate(saver.firstSavedAt)}</td>
//                     <td>{fmtDate(saver.lastSavedAt)}</td>
//                     <td>
//                       {saver.source ?? "—"}
//                       {saver.device ? ` · ${saver.device}` : ""}
//                     </td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         ) : (
//           <p className="ca-drawer-empty">
//             No wishlist saves for this product in the selected range.
//           </p>
//         )}
//         <LimitNote shown={savers.length} total={detail.savers.length} />
//       </Section>
//       )}

//       {selectedPanel === "subscriptions" && (
//       <Section
//         title={subscriptionVariant ? `Subscriptions · ${subscriptionVariant.title}` : "Subscriptions"}
//         count={summary.subscriptions}
//         note={variantId
//           ? "All recorded subscriptions for this variant; other product details use the selected date range."
//           : "Back-in-stock alert subscriptions created in the selected range."}
//       >
//         {subscriptions.length ? (
//           <div className="ca-tw">
//             <table className="ca-table ca-table--compact">
//               <thead>
//                 <tr>
//                   <th>Contact</th>
//                   <th>Channel</th>
//                   <th>Variant</th>
//                   <th>Status</th>
//                   <th>Signed up</th>
//                   <th>Notified</th>
//                   <th>Purchase</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {subscriptions.map((alert) => (
//                   <tr key={alert.id}>
//                     <td>{alert.contact}</td>
//                     <td>{alert.channel === "sms" ? "SMS" : alert.channel}</td>
//                     <td>{alert.variantTitle}</td>
//                     <td>
//                       <span className={`ca-badge ${statusTone(alert.status)}`}>
//                         {alert.status}
//                       </span>
//                     </td>
//                     <td>{fmtDate(alert.createdAt)}</td>
//                     <td>{fmtDate(alert.notifiedAt)}</td>
//                     <td>
//                       {alert.purchasedAt
//                         ? `${alert.purchaseOrderId ?? "Order"} · ${fmtMoney(
//                             alert.purchaseRevenue ?? 0,
//                             alert.purchaseCurrency ?? currency,
//                           )}`
//                         : "—"}
//                     </td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         ) : (
//           <p className="ca-drawer-empty">
//             No back-in-stock subscriptions for this product in the selected
//             range.
//           </p>
//         )}
//         <LimitNote shown={subscriptions.length} total={detail.subscriptions.length} />
//       </Section>
//       )}

//       {selectedPanel === "pendingAlerts" && (
//       <Section
//         title="Pending alerts"
//         count={summary.pendingAlerts}
//         note="Waiting alerts (PENDING, CONFIRMED or SENDING) that have not been notified yet."
//       >
//         {pendingAlerts.length ? (
//           <div className="ca-tw">
//             <table className="ca-table ca-table--compact">
//               <thead>
//                 <tr>
//                   <th>Contact</th>
//                   <th>Channel</th>
//                   <th>Variant</th>
//                   <th>Status</th>
//                   <th>Reason</th>
//                   <th>Requested</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {pendingAlerts.map((alert) => (
//                   <tr key={alert.id}>
//                     <td>{alert.contact}</td>
//                     <td>{alert.channel === "sms" ? "SMS" : alert.channel}</td>
//                     <td>{alert.variantTitle}</td>
//                     <td>
//                       <span className={`ca-badge ${statusTone(alert.status)}`}>
//                         {alert.status}
//                       </span>
//                     </td>
//                     <td>{alert.pendingReason ?? "—"}</td>
//                     <td>{fmtDate(alert.createdAt)}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         ) : (
//           <p className="ca-drawer-empty">
//             No alerts are waiting for this product in the selected range.
//           </p>
//         )}
//         <LimitNote shown={pendingAlerts.length} total={detail.pendingAlerts.length} />
//       </Section>
//       )}

//       {selectedPanel === "notifications" && (
//       <Section
//         title="Notification sends"
//         count={detail.notifications.length}
//         note="Notification log entries created in the selected range. Sent does not confirm delivery or opening."
//       >
//         {notifications.length ? (
//           <div className="ca-tw">
//             <table className="ca-table ca-table--compact">
//               <thead>
//                 <tr>
//                   <th>Created</th>
//                   <th>Sent</th>
//                   <th>Recipient</th>
//                   <th>Channel</th>
//                   <th>Status</th>
//                   <th>Delivered</th>
//                   <th>Opened</th>
//                   <th>Clicked</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {notifications.map((log) => (
//                   <tr
//                     key={log.id}
//                     title={
//                       log.errorReason
//                         ? `Error: ${log.errorReason}`
//                         : log.retryCount
//                           ? `Retries: ${log.retryCount}`
//                           : undefined
//                     }
//                   >
//                     <td>{fmtDate(log.createdAt)}</td>
//                     <td>{fmtDate(log.sentAt)}</td>
//                     <td>{log.recipient}</td>
//                     <td>{log.channel}</td>
//                     <td>
//                       <span className={`ca-badge ${statusTone(log.status)}`}>
//                         {log.status}
//                       </span>
//                     </td>
//                     <td>{fmtDate(log.deliveredAt)}</td>
//                     <td>{fmtDate(log.openedAt)}</td>
//                     <td>{fmtDate(log.clickedAt)}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         ) : (
//           <p className="ca-drawer-empty">
//             No notifications recorded for this product in the selected range.
//           </p>
//         )}
//         <LimitNote shown={notifications.length} total={detail.notifications.length} />
//       </Section>
//       )}

//       {selectedPanel === "orders" && (
//       <Section
//         title="Attributed orders"
//         count={summary.attributedOrders}
//         note="Last-click attribution. Revenue is the attributed line-item total after discounts."
//       >
//         {orders.length ? (
//           <div className="ca-tw">
//             <table className="ca-table ca-table--compact">
//               <thead>
//                 <tr>
//                   <th>Order</th>
//                   <th>Date</th>
//                   <th>Customer</th>
//                   <th>Source</th>
//                   <th>Attribution</th>
//                   <th className="ca-n">Units</th>
//                   <th className="ca-n">Revenue</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {orders.map((order) => (
//                   <tr key={order.id}>
//                     <td>{order.orderNumber}</td>
//                     <td>{fmtDate(order.orderedAt)}</td>
//                     <td>{order.customer}</td>
//                     <td>{order.sources.map(sourceLabel).join(", ")}</td>
//                     <td>
//                       {order.types.map((type) => (
//                         <span
//                           key={type}
//                           className={`ca-badge ${
//                             type === "DIRECT" ? "ca-b" : "ca-a"
//                           }`}
//                         >
//                           {typeLabel(type)}
//                         </span>
//                       ))}
//                     </td>
//                     <td className="ca-n">{fmtN(order.quantity)}</td>
//                     <td className="ca-n">{money(order.revenue)}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         ) : (
//           <p className="ca-drawer-empty">
//             No attributed orders for this product in the selected range.
//           </p>
//         )}
//         <LimitNote shown={orders.length} total={detail.orders.length} />
//       </Section>
//       )}

//       {selectedPanel === "revenue" && (
//       <Section
//         title="Attributed revenue"
//         count={detail.revenue.length}
//         note="Revenue split by source and attribution type."
//       >
//         {detail.revenue.length ? (
//           <div className="ca-tw">
//             <table className="ca-table ca-table--compact">
//               <thead>
//                 <tr>
//                   <th>Source</th>
//                   <th>Attribution</th>
//                   <th className="ca-n">Orders</th>
//                   <th className="ca-n">Units</th>
//                   <th className="ca-n">Revenue</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {detail.revenue.map((row) => (
//                   <tr key={`${row.source}:${row.type}`}>
//                     <td>{sourceLabel(row.source)}</td>
//                     <td>
//                       <span
//                         className={`ca-badge ${
//                           row.type === "DIRECT" ? "ca-b" : "ca-a"
//                         }`}
//                       >
//                         {typeLabel(row.type)}
//                       </span>
//                     </td>
//                     <td className="ca-n">{fmtN(row.orders)}</td>
//                     <td className="ca-n">{fmtN(row.units)}</td>
//                     <td className="ca-n">{money(row.revenue)}</td>
//                   </tr>
//                 ))}
//               </tbody>
//               <tfoot>
//                 <tr>
//                   <td colSpan={2}>
//                     <strong>Total</strong>
//                   </td>
//                   <td className="ca-n">{fmtN(summary.attributedOrders)}</td>
//                   <td className="ca-n">{fmtN(summary.attributedUnits)}</td>
//                   <td className="ca-n">
//                     <strong>{money(summary.attributedRevenue)}</strong>
//                   </td>
//                 </tr>
//               </tfoot>
//             </table>
//           </div>
//         ) : (
//           <p className="ca-drawer-empty">
//             No attributed revenue for this product in the selected range.
//           </p>
//         )}
//       </Section>
//       )}
//     </>
//   );
// }

// export function ProductDetailPage({
//   productId,
//   variantId,
//   from,
//   to,
//   onBack,
// }: {
//   productId: string;
//   variantId?: string;
//   from: string;
//   to: string;
//   onBack: () => void;
// }) {
//   const fetcher = useFetcher<FetcherData>();
//   const loadedKey = useRef<string | null>(null);

//   useEffect(() => {
//     const key = `${productId}|${variantId ?? ""}|${from}|${to}`;
//     if (loadedKey.current === key) return;
//     loadedKey.current = key;
//     fetcher.load(
//       `/app/api/analytics/product/${encodeURIComponent(productId)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ""}`,
//     );
//   }, [productId, variantId, from, to, fetcher]);

//   const detail = isDetail(fetcher.data) ? fetcher.data : null;
//   const error =
//     fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
//   const loading = fetcher.state !== "idle" && !detail;
//   const selectedVariant = detail?.product.variants.find(
//     (variant) => variant.variantId === variantId,
//   );

//   return (
//     <div className="ca-body ca-box-sizing">
//       <main className="ca-product-page">
//         <header className="ca-product-page-head">
//           <button type="button" className="ca-link" onClick={onBack}>
//             &larr; Back to analytics
//           </button>
//           <div className="ca-drawer-title">
//             {detail?.product.imageUrl ? (
//               <img
//                 src={detail.product.imageUrl}
//                 alt=""
//                 width={44}
//                 height={44}
//                 loading="lazy"
//               />
//             ) : (
//               <span className="ca-drawer-thumb" aria-hidden="true">
//                 ♡
//               </span>
//             )}
//             <div>
//               <h1>
//                 {detail?.product.title ?? "Product details"}
//               </h1>
//               <p className="ca-mu">
//                 {detail
//                   ? `${variantId ? `Variant: ${selectedVariant?.title ?? variantId} · ` : ""}Wishlist, back-in-stock and attribution · ${from} to ${to}`
//                   : "Loading wishlist, back-in-stock and attribution data"}
//               </p>
//             </div>
//           </div>
//         </header>

//         <div className="ca-product-page-body">
//           {loading && (
//             <p className="ca-drawer-state" role="status">
//               Loading product details…
//             </p>
//           )}
//           {error && (
//             <p className="ca-drawer-state ca-r" role="alert">
//               {error}
//             </p>
//           )}
//           {detail && <DetailBody detail={detail} variantId={variantId} />}
//         </div>
//       </main>
//     </div>
//   );
// }

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "@remix-run/react";
import {
  PRODUCT_DETAIL_ROW_LIMIT,
  type ProductDetail,
} from "../../lib/product-detail";
import "./product-detail.css";

type FetcherData = ProductDetail | { error: string };
type ProductDetailPanel =
  | "saves"
  | "uniqueSavers"
  | "subscriptions"
  | "pendingAlerts"
  | "notifications"
  | "orders"
  | "revenue";

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
  shown,
  total,
  empty,
  head,
  foot,
  children,
}: {
  title: string;
  count: number;
  note: string;
  shown?: number;
  total?: number;
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
      {shown !== undefined && total !== undefined && total > shown && (
        <p className="pd-foot">Showing the first {fmtN(shown)} of {fmtN(total)}.</p>
      )}
    </section>
  );
}

function DetailBody({ detail, variantId }: { detail: ProductDetail; variantId?: string }) {
  const [selectedPanel, setSelectedPanel] = useState<ProductDetailPanel | null>(null);
  const { product, summary, range } = detail;
  const currency = product.currencyCode;
  const money = (value: number) => fmtMoney(value, currency);
  const subscriptionVariant = product.variants.find((v) => v.variantId === variantId);

  const kpis: Array<[ProductDetailPanel, string, string]> = [
    ["saves", "Saves", fmtN(summary.saves)],
    ["uniqueSavers", "Customer", fmtN(summary.uniqueSavers)],
    ["subscriptions", "Subscriptions", fmtN(summary.subscriptions)],
    ["pendingAlerts", "Pending alerts", fmtN(summary.pendingAlerts)],
    ["notifications", "Notifications sent", fmtN(summary.notificationsSent)],
  ];

  const savers = detail.savers.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const subscriptions = detail.subscriptions.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const pendingAlerts = detail.pendingAlerts.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const notifications = detail.notifications.slice(0, PRODUCT_DETAIL_ROW_LIMIT);
  const orders = detail.orders.slice(0, PRODUCT_DETAIL_ROW_LIMIT);

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

      {(selectedPanel === "saves" || selectedPanel === "uniqueSavers") && (
        <Panel
          title={selectedPanel === "saves" ? "Saves" : "Customer"}
          count={summary.uniqueSavers}
          note={variantId
            ? `Distinct customers or guest devices who saved this variant from ${range.from} to ${range.to}.`
            : "Distinct customers or guest devices with a wishlist save in the selected range."}
          shown={savers.length}
          total={detail.savers.length}
          empty="No wishlist saves for this product in the selected range."
          head={<><th>Shopper</th><th>Type</th><th className="pd-n">Saves</th><th>First saved</th><th>Last saved</th><th>Source</th></>}
        >
          {savers.map((s) => (
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
          shown={subscriptions.length}
          total={detail.subscriptions.length}
          empty="No back-in-stock subscriptions for this product in the selected range."
          head={<><th>Contact</th><th>Channel</th><th>Variant</th><th>Status</th><th>Signed up</th><th>Notified</th><th>Purchase</th></>}
        >
          {subscriptions.map((a) => (
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
          shown={pendingAlerts.length}
          total={detail.pendingAlerts.length}
          empty="No alerts are waiting for this product in the selected range."
          head={<><th>Contact</th><th>Channel</th><th>Variant</th><th>Status</th><th>Reason</th><th>Requested</th></>}
        >
          {pendingAlerts.map((a) => (
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
          shown={notifications.length}
          total={detail.notifications.length}
          empty="No notifications recorded for this product in the selected range."
          head={<><th>Created</th><th>Sent</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Delivered</th><th>Opened</th><th>Clicked</th></>}
        >
          {notifications.map((log) => (
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
          shown={orders.length}
          total={detail.orders.length}
          empty="No attributed orders for this product in the selected range."
          head={<><th>Order</th><th>Date</th><th>Customer</th><th>Source</th><th>Attribution</th><th className="pd-n">Units</th><th className="pd-n">Revenue</th></>}
        >
          {orders.map((o) => (
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