import { Prisma } from "@prisma/client";
import db from "../db.server";
import { rangeBounds, type DateRange } from "../lib/analytics-params";
import type {
  OverviewDetail,
  OverviewDetailMetric,
  OverviewDetailRow,
} from "../lib/overview-detail";
import {
  formatMoney,
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
  type ProductSummary,
} from "../lib/shopify-data.server";
import { loadAnalyticsReport } from "./analytics-reports.server";

const LIMIT = 5;

/* ------------------------------------------------------------------ */
/*  Formatting                                                         */
/* ------------------------------------------------------------------ */

function count(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number, currency: string | null | undefined) {
  const amount = Number.isFinite(value) ? value.toFixed(2) : "0.00";
  return formatMoney(amount, currency ?? null) ?? amount;
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return "—";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return `${parsed.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function cleanContact(contactKey: string) {
  return contactKey.replace(/^(email|sms):/, "");
}

function guestLabel(value: string) {
  const short = value.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  return short ? `Guest · ${short}` : "Guest";
}

function subscriberLabel(row: {
  email: string | null;
  phone: string | null;
  contactKey: string;
}) {
  return row.email || row.phone || cleanContact(row.contactKey);
}

function channelLabel(value: string) {
  switch (value.toLowerCase()) {
    case "email":
      return "Email";
    case "sms":
      return "SMS";
    case "whatsapp":
      return "WhatsApp";
    case "push":
      return "Push";
    default:
      return value;
  }
}

function sourceLabel(value: string) {
  if (value === "WISHLIST") return "Wishlist";
  if (value === "RESTOCK_ALERT") return "Back in stock";
  return value;
}

function typeLabel(value: string) {
  if (value === "DIRECT") return "Direct";
  if (value === "ESTIMATED") return "Estimated";
  return value;
}

function statusLabel(value: string) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

async function productsFor(admin: GraphqlClient, ids: Array<string | null>) {
  const unique = uniqueIds(ids);
  if (!unique.length) return new Map<string, ProductSummary>();
  return getProductsByIds(admin, unique, 1).catch(
    () => new Map<string, ProductSummary>(),
  );
}

async function namesFor(admin: GraphqlClient, ids: Array<string | null>) {
  const unique = uniqueIds(ids);
  if (!unique.length) return new Map<string, string>();
  return getCustomerNamesByIds(admin, unique).catch(
    () => new Map<string, string>(),
  );
}

/* ------------------------------------------------------------------ */
/*  Report-backed breakdowns                                           */
/* ------------------------------------------------------------------ */

async function savesDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    page: "1",
    pageSize: String(LIMIT),
    sort: "saves",
    order: "desc",
  });
  const { response } = await loadAnalyticsReport(
    shopId,
    admin,
    "wishlisted-products",
    params,
  );
  return {
    metric: "saves",
    title: "Top 5 products by saves",
    description: "Products saved most often in the selected period.",
    columns: [
      { label: "Product" },
      { label: "Saves", align: "right" },
      { label: "Conversion", align: "right" },
    ],
    rows: response.rows.map((row) => ({
      productId: row.productId ? String(row.productId) : null,
      values: [
        String(row.title ?? row.productId ?? "Product"),
        count(Number(row.saves ?? 0)),
        percent(Number(row.conversionRate ?? row.conv ?? 0)),
      ],
    })),
    emptyMessage: "No product activity in this date range.",
    reportSlug: "wishlisted-products",
  };
}

async function conversionDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    page: "1",
    pageSize: String(LIMIT),
    sort: "conversionRate",
    order: "desc",
  });
  const { response } = await loadAnalyticsReport(
    shopId,
    admin,
    "wishlist-conversion",
    params,
  );
  return {
    metric: "wishlistConversionRate",
    title: "Top 5 products by conversion",
    description:
      "Products with the highest wishlist-to-purchase conversion in the selected period.",
    columns: [
      { label: "Product" },
      { label: "Saves", align: "right" },
      { label: "Orders", align: "right" },
      { label: "Conversion", align: "right" },
    ],
    rows: response.rows.map((row) => ({
      productId: row.productId ? String(row.productId) : null,
      values: [
        String(row.title ?? row.productId ?? "Product"),
        count(Number(row.saves ?? 0)),
        count(Number(row.purchases ?? 0)),
        percent(Number(row.conversionRate ?? 0)),
      ],
    })),
    emptyMessage: "No conversion activity in this date range.",
    reportSlug: "wishlist-conversion",
  };
}

/* ------------------------------------------------------------------ */
/*  People breakdowns                                                  */
/* ------------------------------------------------------------------ */

type SaverRow = {
  shopperId: string;
  customerId: string | null;
  saves: number;
  products: number;
  lastSavedAt: Date;
};

async function uniqueSaversDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const bounds = rangeBounds(range);
  let rows = await db.$queryRaw<SaverRow[]>(Prisma.sql`
    SELECT COALESCE("customerId", "shopperId") AS "shopperId",
           MAX("customerId") AS "customerId",
           COUNT(*)::int AS "saves",
           COUNT(DISTINCT "productId")::int AS "products",
           MAX("createdAt") AS "lastSavedAt"
    FROM "TrackingEvent"
    WHERE "shopId" = ${shopId}
      AND "type" = 'WISHLIST_SAVE'
      AND "createdAt" >= ${bounds.gte}
      AND "createdAt" < ${bounds.lt}
    GROUP BY COALESCE("customerId", "shopperId")
    ORDER BY "saves" DESC, "lastSavedAt" DESC
    LIMIT ${LIMIT}
  `);

  // Rows saved before event tracking existed still belong in the list.
  if (!rows.length) {
    rows = await db.$queryRaw<SaverRow[]>(Prisma.sql`
      SELECT COALESCE("customerId", "shopperId", "guestToken", "id") AS "shopperId",
             MAX("customerId") AS "customerId",
             COUNT(*)::int AS "saves",
             COUNT(DISTINCT "productId")::int AS "products",
             MAX("createdAt") AS "lastSavedAt"
      FROM "WishlistItem"
      WHERE "shopId" = ${shopId}
        AND "createdAt" >= ${bounds.gte}
        AND "createdAt" < ${bounds.lt}
      GROUP BY COALESCE("customerId", "shopperId", "guestToken", "id")
      ORDER BY "saves" DESC, "lastSavedAt" DESC
      LIMIT ${LIMIT}
    `);
  }

  const names = await namesFor(
    admin,
    rows.map((row) => row.customerId),
  );

  return {
    metric: "uniqueSavers",
    title: "Top 5 customer ",
    description:
      "Customers and guest devices with the most wishlist saves in the selected period.",
    columns: [
      { label: "Customer name" },
      { label: "Saves", align: "right" },
      { label: "Products", align: "right" },
      { label: "Last saved", align: "right" },
    ],
    rows: rows.map((row) => ({
      values: [
        row.customerId
          ? names.get(row.customerId) || `Customer ${row.customerId}`
          : guestLabel(row.shopperId),
        count(row.saves),
        count(row.products),
        dateLabel(row.lastSavedAt),
      ],
    })),
    emptyMessage: "No wishlist savers in this date range.",
    reportSlug: "top-intent-customers",
  };
}

type SubscriberRow = {
  contactKey: string;
  email: string | null;
  phone: string | null;
  channel: string;
  subscriptions: number;
  products: number;
  lastSubscribedAt: Date;
};

async function subscriptionsDetail(
  shopId: string,
  _range: DateRange,
): Promise<OverviewDetail> {
  const rows = await db.$queryRaw<SubscriberRow[]>(Prisma.sql`
    SELECT "contactKey",
           MAX("email") AS "email",
           MAX("phone") AS "phone",
           MAX("channel") AS "channel",
           COUNT(*)::int AS "subscriptions",
           COUNT(DISTINCT "productId")::int AS "products",
           MAX("createdAt") AS "lastSubscribedAt"
    FROM "StockAlert"
    WHERE "shopId" = ${shopId}
    GROUP BY "contactKey"
    ORDER BY "subscriptions" DESC, "lastSubscribedAt" DESC
    LIMIT ${LIMIT}
  `);

  return {
    metric: "alertSubscriptions",
    title: "Top 5 subscribers",
    description:
      "Subscribers with the most current back-in-stock subscriptions.",
    columns: [
      { label: "Subscriber" },
      { label: "Channel" },
      { label: "Subscriptions", align: "right" },
      { label: "Products", align: "right" },
      { label: "Last subscribed", align: "right" },
    ],
    rows: rows.map((row) => ({
      values: [
        subscriberLabel(row),
        channelLabel(row.channel),
        count(row.subscriptions),
        count(row.products),
        dateLabel(row.lastSubscribedAt),
      ],
    })),
    emptyMessage: "No back-in-stock subscriptions yet.",
    reportSlug: "alert-subscriptions",
  };
}

type PendingSubscriberRow = {
  contactKey: string;
  email: string | null;
  phone: string | null;
  channel: string;
  pending: number;
  products: number;
  oldestPendingAt: Date;
};

async function pendingAlertsDetail(shopId: string): Promise<OverviewDetail> {
  // Matches the KPI exactly: the overview counts every PENDING alert as a
  // current snapshot, without a date filter.
  const rows = await db.$queryRaw<PendingSubscriberRow[]>(Prisma.sql`
    SELECT "contactKey",
           MAX("email") AS "email",
           MAX("phone") AS "phone",
           MAX("channel") AS "channel",
           COUNT(*)::int AS "pending",
           COUNT(DISTINCT "productId")::int AS "products",
           MIN("createdAt") AS "oldestPendingAt"
    FROM "StockAlert"
    WHERE "shopId" = ${shopId}
      AND "status" = 'PENDING'
    GROUP BY "contactKey"
    ORDER BY "pending" DESC, "oldestPendingAt" ASC
    LIMIT ${LIMIT}
  `);

  return {
    metric: "pendingAlerts",
    title: "Top 5 pending subscribers",
    description:
      "Current pending alerts, grouped by subscriber. This is a live snapshot and is not limited to the selected date range.",
    columns: [
      { label: "Subscriber" },
      { label: "Channel" },
      { label: "Pending", align: "right" },
      { label: "Products", align: "right" },
      { label: "Oldest request", align: "right" },
    ],
    rows: rows.map((row) => ({
      values: [
        subscriberLabel(row),
        channelLabel(row.channel),
        count(row.pending),
        count(row.products),
        dateLabel(row.oldestPendingAt),
      ],
    })),
    emptyMessage: "No pending alerts right now.",
    reportSlug: "pending-alerts",
  };
}

/* ------------------------------------------------------------------ */
/*  Notification breakdowns                                            */
/* ------------------------------------------------------------------ */

type NotificationSource = {
  productId: string;
  subscriptionId: string | null;
  shopperId: string;
  channel: string;
  status: string;
};

async function notificationRecipients(
  shopId: string,
  admin: GraphqlClient,
  logs: NotificationSource[],
) {
  const [products, subscriptions] = await Promise.all([
    productsFor(
      admin,
      logs.map((log) => log.productId),
    ),
    db.stockAlert.findMany({
      where: {
        shopId,
        id: { in: uniqueIds(logs.map((log) => log.subscriptionId)) },
      },
      select: { id: true, email: true, phone: true, contactKey: true },
    }),
  ]);
  const subscriptionById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription]),
  );

  return logs.map((log) => {
    const subscription = log.subscriptionId
      ? subscriptionById.get(log.subscriptionId)
      : null;
    const recipient = subscription
      ? subscriberLabel(subscription)
      : log.shopperId || "Not recorded";
    return {
      productId: log.productId,
      title: products.get(log.productId)?.title ?? `Product ${log.productId}`,
      recipient,
      channel: channelLabel(log.channel),
      status: statusLabel(log.status),
    };
  });
}

async function notificationsSentDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const bounds = rangeBounds(range);
  // The KPI counts email back-in-stock alerts whose notifiedAt falls in the
  // range, so the drill-down uses the same source instead of NotificationLog.
  const alerts = await db.stockAlert.findMany({
    where: { shopId, channel: "email", notifiedAt: bounds },
    orderBy: [{ notifiedAt: "desc" }, { id: "asc" }],
    take: LIMIT,
    select: {
      productId: true,
      email: true,
      phone: true,
      contactKey: true,
      channel: true,
      status: true,
      notifiedAt: true,
    },
  });
  const products = await productsFor(
    admin,
    alerts.map((alert) => alert.productId),
  );

  return {
    metric: "notificationsSent",
    title: "Latest notification sends",
    description:
      "The five most recent email back-in-stock notifications in the selected period.",
    columns: [
      { label: "Product" },
      { label: "Recipient" },
      { label: "Channel" },
      { label: "Status" },
      { label: "Sent", align: "right" },
    ],
    rows: alerts.map((alert) => ({
      productId: alert.productId,
      values: [
        products.get(alert.productId)?.title ?? `Product ${alert.productId}`,
        subscriberLabel(alert),
        channelLabel(alert.channel),
        statusLabel(alert.status),
        dateLabel(alert.notifiedAt),
      ],
    })),
    emptyMessage: "No notifications were sent in this date range.",
    reportSlug: "notification-log",
  };
}

async function notificationClicksDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const bounds = rangeBounds(range);
  const [logs, convertedAlerts] = await Promise.all([
    db.notificationLog.findMany({
      where: { shopId, clickedAt: bounds },
      orderBy: [{ clickedAt: "desc" }, { id: "asc" }],
      take: LIMIT,
      select: {
        productId: true,
        subscriptionId: true,
        shopperId: true,
        channel: true,
        status: true,
        clickedAt: true,
      },
    }),
    db.stockAlert.findMany({
      where: { shopId, convertedAt: bounds },
      orderBy: [{ convertedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        productId: true,
        shopperId: true,
        customerId: true,
        contactKey: true,
        channel: true,
        status: true,
        convertedAt: true,
      },
    }),
  ]);
  const loggedAlertIds = new Set(
    logs.flatMap((log) => (log.subscriptionId ? [log.subscriptionId] : [])),
  );
  const fallbackAlerts = convertedAlerts
    .filter((alert) => !loggedAlertIds.has(alert.id))
    .slice(0, LIMIT);
  const entries = [
    ...logs.flatMap((log) =>
      log.clickedAt ? [{ source: log, clickedAt: log.clickedAt }] : [],
    ),
    ...fallbackAlerts.flatMap((alert) =>
      alert.convertedAt
        ? [
            {
              source: {
                productId: alert.productId,
                subscriptionId: alert.id,
                shopperId:
                  alert.shopperId ?? alert.customerId ?? alert.contactKey,
                channel: alert.channel,
                status: alert.status,
              },
              clickedAt: alert.convertedAt,
            },
          ]
        : [],
    ),
  ]
    .sort((left, right) => right.clickedAt.getTime() - left.clickedAt.getTime())
    .slice(0, LIMIT);
  const recipients = await notificationRecipients(
    shopId,
    admin,
    entries.map((entry) => entry.source),
  );

  return {
    metric: "notificationClicks",
    title: "Latest notification clicks",
    description:
      "The five most recent notification clicks in the selected period.",
    columns: [
      { label: "Product" },
      { label: "Recipient" },
      { label: "Channel" },
      { label: "Clicked", align: "right" },
    ],
    rows: recipients.map((row, index) => ({
      productId: row.productId,
      values: [
        row.title,
        row.recipient,
        row.channel,
        dateLabel(entries[index]?.clickedAt),
      ],
    })),
    emptyMessage: "No notification clicks in this date range.",
    reportSlug: "notification-delivery",
  };
}

/* ------------------------------------------------------------------ */
/*  Order / revenue breakdowns                                         */
/* ------------------------------------------------------------------ */

async function attributedOrdersDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    page: "1",
    pageSize: String(LIMIT),
    sort: "date",
    order: "desc",
  });
  const { response } = await loadAnalyticsReport(
    shopId,
    admin,
    "wishlist-orders",
    params,
  );
  const rows: OverviewDetailRow[] = response.rows.map((row) => ({
    values: [
      String(row.orderNumber ?? row.orderId ?? "Order"),
      String(row.wishlistedProducts ?? "—"),
      String(row.customer ?? "Guest"),
      count(Number(row.productCount ?? 0)),
      money(Number(row.value ?? 0), null),
    ],
  }));

  return {
    metric: "wishlistOrders",
    title: "Latest attributed orders",
    description:
      "The five most recent orders containing wishlist products in the selected period.",
    columns: [
      { label: "Order" },
      { label: "Product" },
      { label: "Customer" },
      { label: "Attribution" },
      { label: "Revenue", align: "right" },
    ],
    rows,
    emptyMessage: "No attributed orders in this date range.",
    reportSlug: "wishlist-orders",
  };
}

type RevenueProductRow = {
  productId: string;
  orders: number;
  units: number;
  revenue: Prisma.Decimal;
};

async function attributedRevenueDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<OverviewDetail> {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    page: "1",
    pageSize: String(LIMIT),
    sort: "revenue",
    order: "desc",
  });
  const { response } = await loadAnalyticsReport(
    shopId,
    admin,
    "revenue-attribution",
    params,
  );

  return {
    metric: "attributedRevenue",
    title: "Top 5 attributed revenue sources",
    description:
      "Revenue split by source and attribution type in the selected period.",
    columns: [
      { label: "Source" },
      { label: "Attribution" },
      { label: "Orders", align: "right" },
      { label: "Revenue", align: "right" },
      { label: "Average order", align: "right" },
    ],
    rows: response.rows.map((row) => ({
      values: [
        sourceLabel(String(row.source ?? "")),
        typeLabel(String(row.type ?? "")),
        count(Number(row.orders ?? 0)),
        money(Number(row.revenue ?? 0), null),
        money(Number(row.averageOrderValue ?? 0), null),
      ],
    })),
    emptyMessage: "No attributed revenue in this date range.",
    reportSlug: "revenue-attribution",
  };
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

/**
 * Builds the "Top 5" breakdown shown when a merchant clicks an Overview KPI
 * card. Each metric is intentionally different: product metrics rank products,
 * saver/subscriber metrics rank people, and notification/order metrics show
 * the latest records. Only five rows are loaded, so this stays cheap.
 */
export async function loadOverviewDetail(
  shopId: string,
  admin: GraphqlClient,
  metric: OverviewDetailMetric,
  range: DateRange,
): Promise<OverviewDetail> {
  switch (metric) {
    case "saves":
      return savesDetail(shopId, admin, range);
    case "uniqueSavers":
      return uniqueSaversDetail(shopId, admin, range);
    case "alertSubscriptions":
      return subscriptionsDetail(shopId, range);
    case "pendingAlerts":
      return pendingAlertsDetail(shopId);
    case "notificationsSent":
      return notificationsSentDetail(shopId, admin, range);
    case "notificationClicks":
      return notificationClicksDetail(shopId, admin, range);
    case "wishlistOrders":
      return attributedOrdersDetail(shopId, admin, range);
    case "attributedRevenue":
      return attributedRevenueDetail(shopId, admin, range);
    case "wishlistConversionRate":
      return conversionDetail(shopId, admin, range);
  }
}
