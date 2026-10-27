import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import productDetailStyles from "../components/analytics/product-detail.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import type { CustomerValueSegment } from "../lib/customer-value-detail";
import { loadCustomerValueDetail } from "../models/customer-value-detail.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const segment = params.segment;
  if (segment !== "guest" && segment !== "logged-in") {
    throw new Response("Invalid customer segment", { status: 400 });
  }

  const url = new URL(request.url);
  const range = paramsRange(parseAnalyticsParams(url.searchParams));
  const detail = await loadCustomerValueDetail(
    shop.id,
    admin,
    range,
    segment as CustomerValueSegment,
  );
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
  { rel: "stylesheet", href: productDetailStyles },
];

export default function CustomerValueDetailPage() {
  const { detail, from, to, returnTo } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(detail.rows.length / pageSize));
  const pageRows = detail.rows.slice((page - 1) * pageSize, page * pageSize);
  const firstRow = detail.rows.length ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, detail.rows.length);
  const formatMoney = (value: number) =>
    `$${Math.round(value).toLocaleString("en-US")}`;

  return (
    <div className="pd">
      <main className="pd-wrap">
        <button
          type="button"
          className="pd-back"
          onClick={() => navigate(returnTo)}
        >
          &larr; Back to analytics
        </button>
        <header className="pd-head">
          <div>
            <h1>{detail.title}</h1>
            <p className="pd-sub">
              {from} to {to} · Customer orders and products
            </p>
          </div>
        </header>
        <div className="pd-kpis">
          <div className="pd-kpi pd-kpi--static">
            <span>Customers</span>
            <strong>{detail.customers}</strong>
          </div>
          <div className="pd-kpi pd-kpi--static">
            <span>Orders</span>
            <strong>{detail.orders}</strong>
          </div>
          <div className="pd-kpi pd-kpi--static">
            <span>Products</span>
            <strong>{detail.products}</strong>
          </div>
        </div>
        <section className="pd-card">
          <div className="pd-card-head">
            <h2>Customer orders and products</h2>
            <span className="pd-count">{detail.rows.length}</span>
          </div>
          {detail.rows.length ? (
            <div className="pd-tw">
              <table className="pd-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>Source</th>
                    <th className="pd-n">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, index) => (
                    <tr key={`${row.order}:${row.product}:${index}`}>
                      <td>{row.customer}</td>
                      <td>{row.order}</td>
                      <td>{row.orderedAt?.slice(0, 10) ?? "-"}</td>
                      <td>{row.product}</td>
                      <td>{row.variant}</td>
                      <td>{row.source || "-"}</td>
                      <td className="pd-n">{formatMoney(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pd-pagination">
                <span>Showing {firstRow}–{lastRow} of {detail.rows.length}</span>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </button>
                <span>Page {page} of {pageCount}</span>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <p className="pd-empty">
              No customer orders or products in this date range.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}