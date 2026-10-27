import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import productDetailStyles from "../components/analytics/product-detail.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import { getProductsByIds } from "../lib/shopify-data.server";
import db from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const type = params.type;
  const id = params.id?.trim() ?? "";
  if ((type !== "log" && type !== "alert") || !id) {
    throw new Response("Invalid notification detail", { status: 400 });
  }

  let detail:
    | {
        recipient: string;
        productId: string;
        variantId: string | null;
        kind: string;
        channel: string;
        status: string;
        createdAt: string;
        sentAt: string | null;
        error: string | null;
      }
    | null = null;

  if (type === "log") {
    const log = await db.notificationLog.findFirst({
      where: { id, shopId: shop.id },
      select: {
        id: true,
        subscriptionId: true,
        shopperId: true,
        productId: true,
        variantId: true,
        kind: true,
        channel: true,
        status: true,
        createdAt: true,
        sentAt: true,
        errorReason: true,
      },
    });
    if (!log) throw new Response("Notification not found", { status: 404 });
    const alert = log.subscriptionId
      ? await db.stockAlert.findFirst({
          where: { id: log.subscriptionId, shopId: shop.id },
          select: { email: true, phone: true, contactKey: true },
        })
      : null;
    detail = {
      recipient:
        alert?.email ?? alert?.phone ?? alert?.contactKey ?? log.shopperId,
      productId: log.productId,
      variantId: log.variantId,
      kind: log.kind,
      channel: log.channel,
      status: log.status,
      createdAt: log.createdAt.toISOString(),
      sentAt: log.sentAt?.toISOString() ?? null,
      error: log.errorReason,
    };
  } else {
    const alert = await db.stockAlert.findFirst({
      where: { id, shopId: shop.id, notifiedAt: { not: null } },
      select: {
        email: true,
        phone: true,
        contactKey: true,
        shopperId: true,
        customerId: true,
        productId: true,
        variantId: true,
        status: true,
        createdAt: true,
        notifiedAt: true,
        lastError: true,
      },
    });
    if (!alert) throw new Response("Notification not found", { status: 404 });
    detail = {
      recipient:
        alert.email ??
        alert.phone ??
        alert.contactKey ??
        alert.shopperId ??
        alert.customerId ??
        "Not recorded",
      productId: alert.productId,
      variantId: alert.variantId,
      kind: "RESTOCK",
      channel: "EMAIL",
      status: alert.status.toLowerCase(),
      createdAt: alert.createdAt.toISOString(),
      sentAt: alert.notifiedAt?.toISOString() ?? null,
      error: alert.lastError,
    };
  }

  const product = (await getProductsByIds(admin, [detail.productId], 1).catch(
    () => new Map(),
  )).get(detail.productId);
  const url = new URL(request.url);
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
    detail: {
      ...detail,
      product: product?.title ?? detail.productId,
      variant: detail.variantId
        ? product?.variants.find((variant) => variant.variantId === detail?.variantId)?.title ?? detail.variantId
        : "—",
    },
    returnTo,
  });
}

export const links = () => [
  { rel: "stylesheet", href: productDetailStyles },
];

export default function NotificationDetailPage() {
  const { detail, returnTo } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const date = (value: string | null) =>
    value ? new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "—";

  const fields = [
    ["Recipient", detail.recipient],
    ["Product", detail.product],
    ["Variant", detail.variant],
    ["Kind", detail.kind],
    ["Channel", detail.channel],
    ["Status", detail.status],
    ["Created", date(detail.createdAt)],
    ["Sent", date(detail.sentAt)],
  ];

  return (
    <div className="pd">
      <main className="pd-wrap">
        <button type="button" className="pd-back" onClick={() => navigate(returnTo)}>
          &larr; Back to analytics
        </button>
        <header className="pd-head">
          <div>
            <h1>Notification details</h1>
            <p className="pd-sub">{detail.product} · {detail.recipient}</p>
          </div>
        </header>
        <section className="pd-card">
          <div className="pd-card-head">
            <h2>This notification</h2>
            <span className="pd-badge">{detail.status}</span>
          </div>
          <dl className="pd-notification-grid">
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {detail.error && (
            <p className="pd-notification-error"><strong>Error:</strong> {detail.error}</p>
          )}
        </section>
      </main>
    </div>
  );
}