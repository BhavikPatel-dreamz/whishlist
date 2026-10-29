import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import db from "../db.server";
import classicAnalyticsStyles from "../components/analytics/ClassicAnalytics.css?url";
import productDetailStyles from "../components/analytics/product-detail.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await requireAdminShop(request);
  const url = new URL(request.url);
  const contactKey = url.searchParams.get("contact")?.trim() ?? "";
  if (
    contactKey.length > 321 ||
    !/^(email|sms|whatsapp):.+$/i.test(contactKey)
  ) {
    throw new Response("Invalid alert contact", { status: 400 });
  }

  const alerts = await db.stockAlert.findMany({
    where: {
      shopId: shop.id,
      contactKey,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      phone: true,
      channel: true,
      productId: true,
      variantId: true,
      productTitle: true,
      variantTitle: true,
      status: true,
      attempts: true,
      lastError: true,
      createdAt: true,
    },
  });

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

  return json({
    contact:
      alerts[0]?.email ??
      alerts[0]?.phone ??
      contactKey.replace(/^(email|sms|whatsapp):/i, ""),
    channel: alerts[0]?.channel ?? contactKey.split(":", 1)[0],
    returnTo,
    alerts,
  });
}

export const links = () => [
  { rel: "stylesheet", href: classicAnalyticsStyles },
  { rel: "stylesheet", href: productDetailStyles },
];

function displayStatus(status: string) {
  return status === "CANCELLED" ? "Unsubscribed" : status;
}

function formatDate(value: string | Date | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function AlertCustomerDetails() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const unsubscribed = data.alerts.filter(
    (alert) => alert.status === "CANCELLED",
  ).length;

  return (
    <main className="pd pd-alert-customer">
      <div className="pd-wrap">
        <button type="button" className="pd-back" onClick={() => navigate(data.returnTo)}>
          &larr; Back to analytics
        </button>
        <header className="pd-head">
          <div>
            <h1>Back-in-stock alert details</h1>
            <p className="pd-sub">{data.contact} · {data.channel}</p>
          </div>
        </header>
        <div className="pd-meta">
          <span>{data.alerts.length} product alerts · All recorded history</span>
          <span>{unsubscribed} unsubscribed</span>
        </div>
        <section className="pd-card">
          <div className="pd-card-head">
            <h2>Product and alert history</h2>
            <span className="pd-count">{data.alerts.length}</span>
          </div>
          {data.alerts.length ? (
            <div className="pd-tw">
              <table className="pd-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Attempts / error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>{alert.productTitle ?? alert.productId}</td>
                      <td>{alert.variantTitle && alert.variantTitle !== "Default Title" ? alert.variantTitle : alert.variantId}</td>
                      <td><span className="pd-badge">{displayStatus(alert.status)}</span></td>
                      <td>{formatDate(alert.createdAt)}</td>
                      <td>{alert.attempts}{alert.lastError ? ` · ${alert.lastError}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pd-empty">No alert history found.</p>
          )}
        </section>
      </div>
    </main>
  );
}