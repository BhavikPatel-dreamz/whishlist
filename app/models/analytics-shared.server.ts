import { Prisma } from "@prisma/client";
import db from "../db.server";
import { periodDelta } from "../lib/metrics";
import {
  type DateRange,
  type GroupBy,
  rangeBounds,
  rangeDays,
  rangeLength,
  today,
} from "../lib/analytics-params";

/**
 * Shared query helpers for the analytics reports.
 *
 * Reports read their summaries from the `DailyStat` rollup and only fall back to
 * the raw tables for drill-downs, so these helpers keep the rollup SQL in one
 * place (ANALYTICS_REPORTS_SPEC.md section 3, rule 2).
 */

/** The sums of every daily counter over a range. */
export type DailyTotals = {
  productViews: number;
  wishlistSaves: number;
  wishlistRemoves: number;
  uniqueSavers: number;
  wishlistAddToCart: number;
  shares: number;
  shareVisits: number;
  alertSubscriptions: number;
  notificationsSent: number;
  notificationsDelivered: number;
  notificationsOpened: number;
  notificationClicks: number;
  unsubscribes: number;
  wishlistOrders: number;
  restockOrders: number;
  wishlistRevenueDirect: number;
  wishlistRevenueEstimated: number;
  restockRevenueDirect: number;
  restockRevenueEstimated: number;
};

async function liveDailyTotals(
  shopId: string,
  range: DateRange,
): Promise<DailyTotals> {
  const bounds = rangeBounds(range);
  const [
    events,
    wishlist,
    removed,
    subscriptions,
    notifications,
    emailAlertsSent,
    stockAlertClicks,
    attributions,
    uniqueEvents,
    wishlistOrders,
    restockPurchases,
  ] = await Promise.all([
    db.trackingEvent.groupBy({
      by: ["type"],
      where: { shopId, createdAt: bounds },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ saves: number; uniqueSavers: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS saves,
        COUNT(DISTINCT COALESCE(NULLIF("shopperId", ''), "customerId", "guestToken"))::int AS "uniqueSavers"
      FROM "WishlistItem"
      WHERE "shopId" = ${shopId} AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
    `),
    db.wishlistEvent.count({ where: { shopId, createdAt: bounds } }),
    db.stockAlert.count({ where: { shopId, createdAt: bounds } }),
    db.$queryRaw<
      Array<{
        sent: number;
        delivered: number;
        opened: number;
        clicks: number;
        unsubscribes: number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "sentAt" >= ${bounds.gte} AND "sentAt" < ${bounds.lt})::int AS sent,
        COUNT(*) FILTER (WHERE "deliveredAt" >= ${bounds.gte} AND "deliveredAt" < ${bounds.lt})::int AS delivered,
        COUNT(*) FILTER (WHERE "openedAt" >= ${bounds.gte} AND "openedAt" < ${bounds.lt})::int AS opened,
        COUNT(*) FILTER (WHERE "clickedAt" >= ${bounds.gte} AND "clickedAt" < ${bounds.lt})::int AS clicks,
        COUNT(*) FILTER (WHERE "unsubscribedAt" >= ${bounds.gte} AND "unsubscribedAt" < ${bounds.lt})::int AS unsubscribes
      FROM "NotificationLog"
      WHERE "shopId" = ${shopId} AND "channel" = 'EMAIL'
    `),
    db.stockAlert.count({
      where: { shopId, channel: "email", notifiedAt: bounds },
    }),
    db.stockAlert.count({ where: { shopId, convertedAt: bounds } }),
    db.attribution.groupBy({
      by: ["source", "type"],
      where: { shopId, model: "last_click", orderedAt: bounds },
      _count: { _all: true },
      _sum: { revenue: true },
    }),
    db.$queryRaw<Array<{ uniqueSavers: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "shopperId")::int AS "uniqueSavers"
      FROM "TrackingEvent"
      WHERE "shopId" = ${shopId} AND "type" = 'WISHLIST_SAVE'
        AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
    `),
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "orderId")::int AS count
      FROM "WishlistOrder"
      WHERE "shopId" = ${shopId} AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
    `),
    db.stockAlert.aggregate({
      where: {
        shopId,
        purchasedAt: bounds,
        purchaseOrderId: { not: null },
      },
      _count: { _all: true },
      _sum: { purchaseRevenue: true },
    }),
  ]);
  const countEvent = (type: string) =>
    events.find((event) => event.type === type)?._count._all ?? 0;
  const revenueFor = (
    source: "WISHLIST" | "RESTOCK_ALERT",
    type: "DIRECT" | "ESTIMATED",
  ) => attributions.find((row) => row.source === source && row.type === type);
  const [notification] = notifications;
  const [wishlistRows] = wishlist;

  return {
    productViews: countEvent("PRODUCT_VIEW"),
    wishlistSaves: Math.max(
      countEvent("WISHLIST_SAVE"),
      wishlistRows?.saves ?? 0,
    ),
    wishlistRemoves: Math.max(countEvent("WISHLIST_REMOVE"), removed),
    uniqueSavers: Math.max(
      uniqueEvents[0]?.uniqueSavers ?? 0,
      wishlistRows?.uniqueSavers ?? 0,
    ),
    wishlistAddToCart: countEvent("WISHLIST_ADD_TO_CART"),
    shares: countEvent("WISHLIST_SHARE"),
    shareVisits: countEvent("WISHLIST_SHARE_VISIT"),
    alertSubscriptions: subscriptions,
    notificationsSent: emailAlertsSent,
    notificationsDelivered: notification?.delivered ?? 0,
    notificationsOpened: notification?.opened ?? 0,
    notificationClicks: Math.max(
      countEvent("NOTIFICATION_CLICK"),
      notification?.clicks ?? 0,
      stockAlertClicks,
    ),
    unsubscribes: notification?.unsubscribes ?? 0,
    wishlistOrders: Math.max(
      (revenueFor("WISHLIST", "DIRECT")?._count._all ?? 0) +
        (revenueFor("WISHLIST", "ESTIMATED")?._count._all ?? 0),
      wishlistOrders[0]?.count ?? 0,
    ),
    restockOrders: Math.max(
      (revenueFor("RESTOCK_ALERT", "DIRECT")?._count._all ?? 0) +
        (revenueFor("RESTOCK_ALERT", "ESTIMATED")?._count._all ?? 0),
      restockPurchases._count._all,
    ),
    wishlistRevenueDirect: Number(
      revenueFor("WISHLIST", "DIRECT")?._sum.revenue ?? 0,
    ),
    wishlistRevenueEstimated: Number(
      revenueFor("WISHLIST", "ESTIMATED")?._sum.revenue ?? 0,
    ),
    restockRevenueDirect: Math.max(
      Number(revenueFor("RESTOCK_ALERT", "DIRECT")?._sum.revenue ?? 0),
      Number(restockPurchases._sum.purchaseRevenue ?? 0),
    ),
    restockRevenueEstimated: Number(
      revenueFor("RESTOCK_ALERT", "ESTIMATED")?._sum.revenue ?? 0,
    ),
  };
}

/** Sums the daily rollup for a range. */
export async function dailyTotals(
  shopId: string,
  range: DateRange,
): Promise<DailyTotals> {
  const [row] = await db.$queryRaw<
    Array<{
      productViews: number | null;
      dayCount: number;
      wishlistSaves: number | null;
      wishlistRemoves: number | null;
      uniqueSavers: number | null;
      wishlistAddToCart: number | null;
      shares: number | null;
      shareVisits: number | null;
      alertSubscriptions: number | null;
      notificationsSent: number | null;
      notificationsDelivered: number | null;
      notificationsOpened: number | null;
      notificationClicks: number | null;
      unsubscribes: number | null;
      wishlistOrders: number | null;
      restockOrders: number | null;
      wishlistRevenueDirect: string | number | null;
      wishlistRevenueEstimated: string | number | null;
      restockRevenueDirect: string | number | null;
      restockRevenueEstimated: string | number | null;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(DISTINCT "date")::int AS "dayCount",
      COALESCE(SUM("productViews"), 0)::int           AS "productViews",
      COALESCE(SUM("wishlistSaves"), 0)::int          AS "wishlistSaves",
      COALESCE(SUM("wishlistRemoves"), 0)::int        AS "wishlistRemoves",
      COALESCE(SUM("uniqueSavers"), 0)::int           AS "uniqueSavers",
      COALESCE(SUM("wishlistAddToCart"), 0)::int      AS "wishlistAddToCart",
      COALESCE(SUM("shares"), 0)::int                 AS "shares",
      COALESCE(SUM("shareVisits"), 0)::int            AS "shareVisits",
      COALESCE(SUM("alertSubscriptions"), 0)::int     AS "alertSubscriptions",
      COALESCE(SUM("notificationsSent"), 0)::int      AS "notificationsSent",
      COALESCE(SUM("notificationsDelivered"), 0)::int AS "notificationsDelivered",
      COALESCE(SUM("notificationsOpened"), 0)::int    AS "notificationsOpened",
      COALESCE(SUM("notificationClicks"), 0)::int     AS "notificationClicks",
      COALESCE(SUM("unsubscribes"), 0)::int           AS "unsubscribes",
      COALESCE(SUM("wishlistOrders"), 0)::int         AS "wishlistOrders",
      COALESCE(SUM("restockOrders"), 0)::int          AS "restockOrders",
      COALESCE(SUM("wishlistRevenueDirect"), 0)      AS "wishlistRevenueDirect",
      COALESCE(SUM("wishlistRevenueEstimated"), 0)   AS "wishlistRevenueEstimated",
      COALESCE(SUM("restockRevenueDirect"), 0)       AS "restockRevenueDirect",
      COALESCE(SUM("restockRevenueEstimated"), 0)    AS "restockRevenueEstimated"
    FROM "DailyStat"
    WHERE "shopId" = ${shopId}
      AND "date" >= ${range.from}::date
      AND "date" <= ${range.to}::date
  `);

  if (range.to >= today() || !row || row.dayCount < rangeLength(range)) {
    return liveDailyTotals(shopId, range);
  }

  const [storedAlertClicks, alertSubscriptions] = await Promise.all([
    db.stockAlert.count({
      where: { shopId, convertedAt: rangeBounds(range) },
    }),
    db.stockAlert.count({
      where: { shopId, createdAt: rangeBounds(range) },
    }),
  ]);
  const money = (value: string | number | null) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    productViews: row.productViews ?? 0,
    wishlistSaves: row.wishlistSaves ?? 0,
    wishlistRemoves: row.wishlistRemoves ?? 0,
    uniqueSavers: row.uniqueSavers ?? 0,
    wishlistAddToCart: row.wishlistAddToCart ?? 0,
    shares: row.shares ?? 0,
    shareVisits: row.shareVisits ?? 0,
    alertSubscriptions,
    notificationsSent: row.notificationsSent ?? 0,
    notificationsDelivered: row.notificationsDelivered ?? 0,
    notificationsOpened: row.notificationsOpened ?? 0,
    notificationClicks: Math.max(
      row.notificationClicks ?? 0,
      storedAlertClicks,
    ),
    unsubscribes: row.unsubscribes ?? 0,
    wishlistOrders: row.wishlistOrders ?? 0,
    restockOrders: row.restockOrders ?? 0,
    wishlistRevenueDirect: money(row.wishlistRevenueDirect),
    wishlistRevenueEstimated: money(row.wishlistRevenueEstimated),
    restockRevenueDirect: money(row.restockRevenueDirect),
    restockRevenueEstimated: money(row.restockRevenueEstimated),
  };
}

/**
 * Buckets a day into the series key for a grouping. Weeks start on Monday, which
 * is what Postgres' `date_trunc('week', …)` does.
 */
export function bucketKey(day: string, groupBy: GroupBy): string {
  if (groupBy === "day") return day;
  const date = new Date(`${day}T00:00:00Z`);
  if (groupBy === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
  }
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - weekday * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Every bucket key a range covers, in order. */
export function rangeBuckets(range: DateRange, groupBy: GroupBy): string[] {
  const buckets: string[] = [];
  for (const day of rangeDays(range)) {
    const key = bucketKey(day, groupBy);
    if (buckets[buckets.length - 1] !== key) buckets.push(key);
  }
  return buckets;
}

export type DailySeriesRow = {
  bucket: string;
  productViews: number;
  wishlistSaves: number;
  alertSubscriptions: number;
  notificationsSent: number;
  notificationClicks: number;
  wishlistAddToCart: number;
  wishlistOrders: number;
  restockOrders: number;
};

/**
 * The daily counters over a range, grouped into day, week or month buckets.
 * Buckets without activity are still returned so a chart shows a flat line
 * instead of a gap.
 */
export async function dailySeries(
  shopId: string,
  range: DateRange,
  groupBy: GroupBy = "day",
): Promise<DailySeriesRow[]> {
  const [rows, savedItemRows, subscriptionRows] = await Promise.all([
    db.$queryRaw<
      Array<{
        bucket: string;
        productViews: number | null;
        wishlistSaves: number | null;
        alertSubscriptions: number | null;
        notificationsSent: number | null;
        notificationClicks: number | null;
        wishlistAddToCart: number | null;
        wishlistOrders: number | null;
        restockOrders: number | null;
      }>
    >(Prisma.sql`
    SELECT
      date_trunc(${groupBy}, "date")::date::text AS "bucket",
      COALESCE(SUM("productViews"), 0)::int           AS "productViews",
      COALESCE(SUM("wishlistSaves"), 0)::int          AS "wishlistSaves",
      COALESCE(SUM("alertSubscriptions"), 0)::int     AS "alertSubscriptions",
      COALESCE(SUM("notificationsSent"), 0)::int      AS "notificationsSent",
      COALESCE(SUM("notificationClicks"), 0)::int     AS "notificationClicks",
      COALESCE(SUM("wishlistAddToCart"), 0)::int      AS "wishlistAddToCart",
      COALESCE(SUM("wishlistOrders"), 0)::int         AS "wishlistOrders",
      COALESCE(SUM("restockOrders"), 0)::int          AS "restockOrders"
    FROM "DailyStat"
    WHERE "shopId" = ${shopId}
      AND "date" >= ${range.from}::date
      AND "date" <= ${range.to}::date
    GROUP BY 1
    ORDER BY 1
    `),
    db.$queryRaw<Array<{ bucket: string; saves: number }>>(Prisma.sql`
      SELECT
        date_trunc(${groupBy}, "createdAt")::date::text AS "bucket",
        COUNT(*)::int AS "saves"
      FROM "WishlistItem"
      WHERE "shopId" = ${shopId}
        AND "createdAt" >= ${range.from}::date
        AND "createdAt" < (${range.to}::date + INTERVAL '1 day')
      GROUP BY 1
    `),
    db.stockAlert.groupBy({
      by: ["createdAt"],
      where: { shopId, createdAt: rangeBounds(range) },
      _count: { _all: true },
    }),
  ]);
  const savedSavesByBucket = new Map(
    savedItemRows.map((row) => [row.bucket, row.saves]),
  );
  const subscriptionsByBucket = new Map<string, number>();
  for (const subscription of subscriptionRows) {
    const bucket = bucketKey(
      subscription.createdAt.toISOString().slice(0, 10),
      groupBy,
    );
    subscriptionsByBucket.set(
      bucket,
      (subscriptionsByBucket.get(bucket) ?? 0) + subscription._count._all,
    );
  }

  if (rows.length < rangeLength(range)) {
    const bounds = rangeBounds(range);
    const [events, sentAlerts] = await Promise.all([
      db.trackingEvent.groupBy({
        by: ["createdAt", "type"],
        where: {
          shopId,
          createdAt: bounds,
          type: {
            in: [
              "PRODUCT_VIEW",
              "WISHLIST_SAVE",
              "WISHLIST_ADD_TO_CART",
              "NOTIFICATION_CLICK",
            ],
          },
        },
        _count: { _all: true },
      }),
      db.stockAlert.groupBy({
        by: ["notifiedAt"],
        where: { shopId, channel: "email", notifiedAt: bounds },
        _count: { _all: true },
      }),
    ]);
    const liveByDay = new Map<string, DailySeriesRow>();
    const dayFor = (date: Date) => {
      const day = date.toISOString().slice(0, 10);
      const row = liveByDay.get(day) ?? {
        bucket: day,
        productViews: 0,
        wishlistSaves: 0,
        alertSubscriptions: 0,
        notificationsSent: 0,
        notificationClicks: 0,
        wishlistAddToCart: 0,
        wishlistOrders: 0,
        restockOrders: 0,
      };
      liveByDay.set(day, row);
      return row;
    };
    for (const event of events) {
      const row = dayFor(event.createdAt);
      if (event.type === "PRODUCT_VIEW") row.productViews += event._count._all;
      if (event.type === "WISHLIST_SAVE")
        row.wishlistSaves += event._count._all;
      if (event.type === "WISHLIST_ADD_TO_CART")
        row.wishlistAddToCart += event._count._all;
      if (event.type === "NOTIFICATION_CLICK")
        row.notificationClicks += event._count._all;
    }
    for (const alert of sentAlerts) {
      if (!alert.notifiedAt) continue;
      const row = dayFor(alert.notifiedAt);
      row.notificationsSent += alert._count._all;
    }
    const buckets = new Map<string, DailySeriesRow>();
    for (const day of rangeDays(range)) {
      const row = liveByDay.get(day) ?? {
        bucket: day,
        productViews: 0,
        wishlistSaves: 0,
        alertSubscriptions: 0,
        notificationsSent: 0,
        notificationClicks: 0,
        wishlistAddToCart: 0,
        wishlistOrders: 0,
        restockOrders: 0,
      };
      const key = bucketKey(day, groupBy);
      const bucket = buckets.get(key) ?? { ...row, bucket: key };
      if (buckets.has(key)) {
        bucket.productViews += row.productViews;
        bucket.wishlistSaves += row.wishlistSaves;
        bucket.alertSubscriptions += row.alertSubscriptions;
        bucket.notificationsSent += row.notificationsSent;
        bucket.notificationClicks += row.notificationClicks;
        bucket.wishlistAddToCart += row.wishlistAddToCart;
        bucket.wishlistOrders += row.wishlistOrders;
        bucket.restockOrders += row.restockOrders;
      }
      buckets.set(key, bucket);
    }
    return [...buckets.values()].map((bucket) => ({
      ...bucket,
      alertSubscriptions: subscriptionsByBucket.get(bucket.bucket) ?? 0,
      wishlistSaves: Math.max(
        bucket.wishlistSaves,
        savedSavesByBucket.get(bucket.bucket) ?? 0,
      ),
    }));
  }

  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return rangeBuckets(range, groupBy).map((bucket) => {
    const row = byBucket.get(bucket);
    return {
      bucket,
      productViews: row?.productViews ?? 0,
      wishlistSaves: Math.max(
        row?.wishlistSaves ?? 0,
        savedSavesByBucket.get(bucket) ?? 0,
      ),
      alertSubscriptions: subscriptionsByBucket.get(bucket) ?? 0,
      notificationsSent: row?.notificationsSent ?? 0,
      notificationClicks: row?.notificationClicks ?? 0,
      wishlistAddToCart: row?.wishlistAddToCart ?? 0,
      wishlistOrders: row?.wishlistOrders ?? 0,
      restockOrders: row?.restockOrders ?? 0,
    };
  });
}

/**
 * Compares two sets of counters and returns the relative change for each key.
 * A metric with no previous value has a change of 0 rather than an infinite one.
 */
export function compareTotals(
  current: Record<string, number>,
  previous: Record<string, number>,
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const key of Object.keys(current)) {
    delta[key] = periodDelta(current[key], previous[key] ?? 0);
  }
  return delta;
}

/** Slices rows to the requested page and describes the pagination. */
export function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number,
): {
  rows: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
} {
  const total = rows.length;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const current = Math.min(Math.max(page, 1), pageCount);
  const start = (current - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: { page: current, pageSize, total, pageCount },
  };
}

/**
 * Sorts rows by a field, honouring the requested direction. Values are compared
 * numerically when both sides are numbers and as text otherwise.
 */
export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  sort: string | null,
  order: "asc" | "desc",
): T[] {
  if (!sort) return rows;
  const factor = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    if (left === undefined || left === null) return 1;
    if (right === undefined || right === null) return -1;
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * factor;
    }
    return (
      String(left).localeCompare(String(right), undefined, { numeric: true }) *
      factor
    );
  });
}

/** Keeps the rows whose text fields contain the search term. */
export function searchRows<T extends Record<string, unknown>>(
  rows: T[],
  query: string | null,
  fields: string[],
): T[] {
  const term = query?.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) =>
    fields.some((field) =>
      String(row[field] ?? "")
        .toLowerCase()
        .includes(term),
    ),
  );
}

/** How many days a range covers — used to size rolling windows. */
export { rangeLength };
