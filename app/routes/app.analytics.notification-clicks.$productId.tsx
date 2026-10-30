import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import db from "../db.server";
import productDetailStyles from "../components/analytics/product-detail.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams, rangeBounds } from "../lib/analytics-params";
import { getCustomerNamesByIds, getProductsByIds } from "../lib/shopify-data.server";

const CHANNELS = new Set(["EMAIL", "SMS", "WHATSAPP", "PUSH"]);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const productId = params.productId?.trim() ?? "";
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel")?.toUpperCase() ?? "";
  if (!productId || productId.length > 128 || !CHANNELS.has(channel)) {
    throw new Response("Invalid notification click detail", { status: 400 });
  }

  const range = paramsRange(parseAnalyticsParams(url.searchParams));
  const bounds = rangeBounds(range);
  const [reportLogs, convertedAlerts, subscribeClicks] = await Promise.all([
    db.notificationLog.findMany({
      where: {
        shopId: shop.id,
        productId,
        channel: channel as "EMAIL" | "SMS" | "WHATSAPP" | "PUSH",
        OR: [{ sentAt: bounds }, { clickedAt: bounds }],
      },
      orderBy: { clickedAt: "desc" },
      select: {
        shopperId: true,
        subscriptionId: true,
        wishlistItemId: true,
        clickedAt: true,
      },
    }),
    db.stockAlert.findMany({
      where: {
        shopId: shop.id,
        productId,
        channel: channel.toLowerCase(),
        convertedAt: bounds,
      },
      select: {
        id: true,
        customerId: true,
        email: true,
        phone: true,
        contactKey: true,
        shopperId: true,
        convertedAt: true,
      },
    }),
    db.trackingEvent.findMany({
      where: {
        shopId: shop.id,
        type: "ALERT_SUBSCRIBE_CLICK",
        productId,
        channel: channel.toLowerCase(),
        createdAt: bounds,
      },
      select: { customerId: true, shopperId: true, createdAt: true },
    }),
  ]);
  const clickedLogs = reportLogs.filter(
    (log) => log.clickedAt && log.clickedAt >= bounds.gte && log.clickedAt < bounds.lt,
  );
  const loggedAlertIds = new Set(
    reportLogs.flatMap((log) => log.subscriptionId ? [log.subscriptionId] : []),
  );
  const unloggedConversions = convertedAlerts.filter(
    (alert) => !loggedAlertIds.has(alert.id),
  );
  const clickedSubscriptionIds = [
    ...new Set(clickedLogs.flatMap((log) => log.subscriptionId ? [log.subscriptionId] : [])),
  ];
  const clickedWishlistItemIds = [
    ...new Set(clickedLogs.flatMap((log) => log.wishlistItemId ? [log.wishlistItemId] : [])),
  ];
  const unresolvedShopperIds = [
    ...new Set(
      subscribeClicks
        .filter((click) => !click.customerId && !/^\d+$/.test(click.shopperId))
        .map((click) => click.shopperId),
    ),
  ];
  const [alerts, items, alertsByShopper, itemsByShopper] = await Promise.all([
    db.stockAlert.findMany({
      where: {
        shopId: shop.id,
        id: { in: clickedSubscriptionIds },
      },
      select: {
        id: true,
        customerId: true,
        email: true,
        phone: true,
        contactKey: true,
      },
    }),
    db.wishlistItem.findMany({
      where: {
        shopId: shop.id,
        id: { in: clickedWishlistItemIds },
      },
      select: { id: true, customerId: true },
    }),
    unresolvedShopperIds.length
      ? db.stockAlert.findMany({
          where: {
            shopId: shop.id,
            shopperId: { in: unresolvedShopperIds },
            customerId: { not: null },
          },
          select: {
            shopperId: true,
            customerId: true,
            email: true,
            phone: true,
            contactKey: true,
          },
        })
      : Promise.resolve([]),
    unresolvedShopperIds.length
      ? db.wishlistItem.findMany({
          where: {
            shopId: shop.id,
            shopperId: { in: unresolvedShopperIds },
            customerId: { not: null },
          },
          select: { shopperId: true, customerId: true },
        })
      : Promise.resolve([]),
  ]);
  const alertsById = new Map(alerts.map((alert) => [alert.id, alert]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const identityByShopper = new Map(
    alertsByShopper.flatMap((alert) => alert.shopperId ? [[alert.shopperId, alert] as const] : []),
  );
  const customerByShopper = new Map(
    [...alertsByShopper, ...itemsByShopper].flatMap((record) =>
      record.shopperId && record.customerId
        ? [[record.shopperId, record.customerId] as const]
        : [],
    ),
  );
  const customers = new Set<string>();
  const groups = new Map<
    string,
    { customerId: string | null; contact: string; clicks: number; lastClickedAt: string }
  >();
  const addClick = (customerId: string | null, contact: string, clickedAt: Date) => {
    const key = customerId ? `customer:${customerId}` : `shopper:${contact}`;
    const group = groups.get(key) ?? {
      customerId,
      contact,
      clicks: 0,
      lastClickedAt: "",
    };
    group.clicks += 1;
    const clickedAtIso = clickedAt.toISOString();
    if (clickedAtIso > group.lastClickedAt) group.lastClickedAt = clickedAtIso;
    groups.set(key, group);
    if (customerId) customers.add(customerId);
  };

  for (const log of clickedLogs) {
    const alert = log.subscriptionId ? alertsById.get(log.subscriptionId) : null;
    const item = log.wishlistItemId ? itemsById.get(log.wishlistItemId) : null;
    const customerId =
      alert?.customerId ??
      item?.customerId ??
      (/^\d+$/.test(log.shopperId) ? log.shopperId : null);
    const contact =
      alert?.email ?? alert?.phone ?? alert?.contactKey ?? log.shopperId;
    if (log.clickedAt) addClick(customerId, contact, log.clickedAt);
  }
  for (const alert of unloggedConversions) {
    const customerId = alert.customerId ?? (/^\d+$/.test(alert.shopperId ?? "") ? alert.shopperId : null);
    const contact = alert.email ?? alert.phone ?? alert.contactKey ?? alert.shopperId ?? "Unknown contact";
    if (alert.convertedAt) addClick(customerId, contact, alert.convertedAt);
  }
  for (const click of subscribeClicks) {
    const identity = identityByShopper.get(click.shopperId);
    const customerId =
      click.customerId ??
      (/^\d+$/.test(click.shopperId)
        ? click.shopperId
        : customerByShopper.get(click.shopperId) ?? null);
    const contact =
      identity?.email ?? identity?.phone ?? identity?.contactKey ?? click.shopperId;
    addClick(customerId, contact, click.createdAt);
  }

  const [customerNames, product] = await Promise.all([
    getCustomerNamesByIds(admin, [...customers]).catch(() => new Map()),
    getProductsByIds(admin, [productId], 1).catch(() => new Map()),
  ]);
  const rows = [...groups.values()].map((group) => ({
    ...group,
    customer: group.customerId
      ? customerNames.get(group.customerId) ?? `Customer ${group.customerId}`
      : group.contact,
  }));

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
    product: product.get(productId)?.title ?? productId,
    channel,
    from: range.from,
    to: range.to,
    rows,
    returnTo,
  });
}

export const links = () => [{ rel: "stylesheet", href: productDetailStyles }];

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function NotificationClickDetails() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <main className="pd">
      <div className="pd-wrap">
        <button type="button" className="pd-back" onClick={() => navigate(data.returnTo)}>
          &larr; Back to analytics
        </button>
        <header className="pd-head">
          <div>
            <h1>Product click details</h1>
            <p className="pd-sub">{data.product} · {data.channel} · {data.from} to {data.to}</p>
          </div>
        </header>
        <section className="pd-card">
          <div className="pd-card-head">
            <h2>Customers who clicked</h2>
            <span className="pd-count">{data.rows.reduce((total, row) => total + row.clicks, 0)} clicks</span>
          </div>
          {data.rows.length ? (
            <div className="pd-tw">
              <table className="pd-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Contact</th>
                    <th>Clicks</th>
                    <th>Last clicked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.customerId ?? row.contact}>
                      <td>{row.customer}</td>
                      <td>{row.contact}</td>
                      <td>{row.clicks}</td>
                      <td>{formatDate(row.lastClickedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pd-empty">No clicked customer records for this product and date range.</p>
          )}
        </section>
      </div>
    </main>
  );
}