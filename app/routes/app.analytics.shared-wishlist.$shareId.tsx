import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import classicAnalyticsStyles from "../components/analytics/ClassicAnalytics.css?url";
import productDetailStyles from "../components/analytics/product-detail.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import { loadSharedWishlistOrderDetail } from "../models/analytics-reports.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const shareId = params.shareId?.trim() ?? "";
  if (!/^[\w-]{16,64}$/.test(shareId)) {
    throw new Response("Invalid shared wishlist id", { status: 400 });
  }

  const url = new URL(request.url);
  const range = paramsRange(parseAnalyticsParams(url.searchParams));
  const detail = await loadSharedWishlistOrderDetail(shop.id, admin, shareId, range);
  if (!detail) throw new Response("Shared wishlist not found", { status: 404 });

  const returnToParam = url.searchParams.get("returnTo") ?? "";
  let returnTo = "/app";
  try {
    const target = new URL(returnToParam, url.origin);
    if (
      target.origin === url.origin &&
      (target.pathname === "/app" || target.pathname.startsWith("/app/"))
    ) {
      returnTo = `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    returnTo = "/app";
  }

  return json({ detail, from: range.from, to: range.to, returnTo });
}

export const links = () => [
  { rel: "stylesheet", href: classicAnalyticsStyles },
  { rel: "stylesheet", href: productDetailStyles },
];

export default function SharedWishlistDetailPage() {
  const { detail, from, to, returnTo } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const totalRevenue = detail.orders.reduce((sum, order) => sum + order.revenue, 0);
  const formatAmount = (value: number) => value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="pd">
      <main className="pd-wrap">
        <button type="button" className="pd-back" onClick={() => navigate(returnTo)}>
          &larr; Back to analytics
        </button>
        <header className="pd-head">
          <span className="pd-thumb pd-customer-mark" aria-hidden="true">↗</span>
          <div>
            <h1>{detail.listName}</h1>
            <p className="pd-sub">
              Shared by {detail.sharedBy} · {detail.channel} · {from} to {to}
            </p>
          </div>
        </header>
        <div className="pd-kpis">
          <div className="pd-kpi pd-kpi--static"><span>Orders after visit</span><strong>{detail.orders.length ? new Set(detail.orders.map((order) => order.orderId)).size : 0}</strong></div>
          <div className="pd-kpi pd-kpi--static"><span>Order lines</span><strong>{detail.orders.length}</strong></div>
          <div className="pd-kpi pd-kpi--static"><span>Attributed revenue</span><strong>{formatAmount(totalRevenue)}</strong></div>
        </div>
        <section className="pd-card">
          <div className="pd-card-head">
            <h2>Products in this share</h2>
            <span className="pd-count">{detail.products.length}</span>
          </div>
          {detail.products.length ? (
            <ul className="pd-share-list">
              {detail.products.map((product) => (
                <li className="pd-share-product" key={product.productId}>
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="pd-share-placeholder" aria-hidden="true" />
                  )}
                  <span>{product.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pd-empty">No products were recorded in this share.</p>
          )}
        </section>
        <section className="pd-card">
          <div className="pd-card-head">
            <h2>Orders from this shared wishlist</h2>
            <span className="pd-count">{new Set(detail.orders.map((order) => order.orderId)).size}</span>
          </div>
          <p className="pd-note">Products purchased after a visitor opened this shared wishlist during the selected date range.</p>
          {detail.orders.length ? (
            <div className="pd-tw">
              <table className="pd-table">
                <thead>
                  <tr><th>Order</th><th>Date</th><th>Customer</th><th>Product</th><th className="pd-n">Quantity</th><th className="pd-n">Revenue</th></tr>
                </thead>
                <tbody>
                  {detail.orders.map((order) => (
                    <tr key={`${order.orderId}:${order.productId}:${order.orderNumber}`}>
                      <td>{order.orderNumber}</td>
                      <td>{order.orderedAt.slice(0, 10)}</td>
                      <td>{order.customer}</td>
                      <td>{order.product}</td>
                      <td className="pd-n">{order.quantity}</td>
                      <td className="pd-n">{formatAmount(order.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pd-empty">No attributed orders from this shared wishlist in the selected date range.</p>
          )}
        </section>
      </main>
    </div>
  );
}
