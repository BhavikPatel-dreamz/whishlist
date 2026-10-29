/**
 * DailyStat rollup job (ANALYTICS_REPORTS_SPEC.md section 4).
 *
 * Computes one `DailyStat` row per shop per day from the raw event and order
 * tables. Designed to be idempotent: re-running for a date range overwrites the
 * same rows, so a replayed job never double-counts.
 *
 * Schedule:
 *   - Hourly: roll up today (incomplete day, safe to overwrite)
 *   - Nightly: roll up yesterday (complete day)
 *   - On demand: backfill an arbitrary date range
 */

import { Prisma } from "@prisma/client";
import db from "../db.server";
import type { DateRange } from "../lib/analytics-params";

const DAY_MS = 86400000;

export type RollupResult = {
  shops: number;
  days: number;
  rowsUpserted: number;
  errors: Array<{ shopId: string; date: string; error: string }>;
};

/**
 * The attribution revenue already written for an order day. These are the
 * authoritative per-day, per-source revenue figures — DailyStat just mirrors
 * them so report summaries never have to join the Attribution table.
 */
async function attributedRevenueByDay(
  shopId: string,
  bounds: { gte: Date; lt: Date },
): Promise<{
  [dateKey: string]: {
    wishlistDirect: number;
    wishlistEstimated: number;
    restockDirect: number;
    restockEstimated: number;
    wishlistOrders: number;
    restockOrders: number;
  };
}> {
  const rows = await db.attribution.groupBy({
    by: ["orderedAt", "source", "type"],
    where: {
      shopId,
      orderedAt: bounds,
    },
    _sum: { revenue: true },
    _count: { _all: true },
  });

  const byDay: RollupRevenueMap = {};
  for (const row of rows) {
    const dateKey = row.orderedAt.toISOString().slice(0, 10);
    const day = (byDay[dateKey] ??= {
      wishlistDirect: 0,
      wishlistEstimated: 0,
      restockDirect: 0,
      restockEstimated: 0,
      wishlistOrders: 0,
      restockOrders: 0,
    });
    const revenue = Number(row._sum.revenue ?? 0);
    const orders = row._count._all;
    if (row.source === "WISHLIST") {
      if (row.type === "DIRECT") {
        day.wishlistDirect += revenue;
        day.wishlistOrders += orders;
      } else {
        day.wishlistEstimated += revenue;
        day.wishlistOrders += orders;
      }
    } else {
      if (row.type === "DIRECT") {
        day.restockDirect += revenue;
        day.restockOrders += orders;
      } else {
        day.restockEstimated += revenue;
        day.restockOrders += orders;
      }
    }
  }
  return byDay;
}

type RollupRevenueMap = {
  [dateKey: string]: {
    wishlistDirect: number;
    wishlistEstimated: number;
    restockDirect: number;
    restockEstimated: number;
    wishlistOrders: number;
    restockOrders: number;
  };
};

/**
 * Event counters per shop per day from TrackingEvent.
 */
async function eventCountersByDay(
  shopId: string,
  bounds: { gte: Date; lt: Date },
): Promise<{
  [dateKey: string]: {
    productViews: number;
    wishlistSaves: number;
    wishlistRemoves: number;
    wishlistAddToCart: number;
    shares: number;
    shareVisits: number;
    alertSubscriptions: number;
    notificationClicks: number;
    uniqueSavers: number;
  };
}> {
  const [rows, storedClicks, subscriptions, uniqueSavers, itemSavers, logClicks] =
    await Promise.all([
      db.trackingEvent.groupBy({
        by: ["createdAt", "type"],
        where: { shopId, createdAt: bounds },
        _count: { _all: true },
      }),
      db.stockAlert.groupBy({
        by: ["convertedAt"],
        where: { shopId, convertedAt: bounds },
        _count: { _all: true },
      }),
      db.stockAlert.groupBy({
        by: ["createdAt"],
        where: { shopId, createdAt: bounds },
        _count: { _all: true },
      }),
      db.$queryRaw<Array<{ day: string; uniqueSavers: number }>>(Prisma.sql`
        SELECT "createdAt"::date::text AS day,
          COUNT(DISTINCT "shopperId")::int AS "uniqueSavers"
        FROM "TrackingEvent"
        WHERE "shopId" = ${shopId}
          AND "type" = 'WISHLIST_SAVE'
          AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
        GROUP BY 1
      `),
      db.$queryRaw<Array<{ day: string; uniqueSavers: number }>>(Prisma.sql`
        SELECT "createdAt"::date::text AS day,
          COUNT(DISTINCT COALESCE(NULLIF("shopperId", ''), "customerId", "guestToken"))::int AS "uniqueSavers"
        FROM "WishlistItem"
        WHERE "shopId" = ${shopId}
          AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
        GROUP BY 1
      `),
      db.$queryRaw<Array<{ day: string; clicks: number }>>(Prisma.sql`
        SELECT "clickedAt"::date::text AS day, COUNT(*)::int AS clicks
        FROM "NotificationLog"
        WHERE "shopId" = ${shopId}
          AND "channel" = 'EMAIL'
          AND "clickedAt" >= ${bounds.gte} AND "clickedAt" < ${bounds.lt}
        GROUP BY 1
      `),
    ]);

  const byDay: RollupEventMap = {};
  const dayFor = (date: Date | string) => {
    const dateKey =
      typeof date === "string" ? date : date.toISOString().slice(0, 10);
    return (byDay[dateKey] ??= {
      productViews: 0,
      wishlistSaves: 0,
      wishlistRemoves: 0,
      wishlistAddToCart: 0,
      shares: 0,
      shareVisits: 0,
      alertSubscriptions: 0,
      notificationClicks: 0,
      uniqueSavers: 0,
    });
  };
  for (const row of rows) {
    const day = dayFor(row.createdAt);
    switch (row.type) {
      case "PRODUCT_VIEW":
        day.productViews += row._count._all;
        break;
      case "WISHLIST_SAVE":
        day.wishlistSaves += row._count._all;
        break;
      case "WISHLIST_REMOVE":
        day.wishlistRemoves += row._count._all;
        break;
      case "WISHLIST_ADD_TO_CART":
        day.wishlistAddToCart += row._count._all;
        break;
      case "WISHLIST_SHARE":
        day.shares += row._count._all;
        break;
      case "WISHLIST_SHARE_VISIT":
        day.shareVisits += row._count._all;
        break;
      case "NOTIFICATION_CLICK":
        day.notificationClicks += row._count._all;
        break;
      case "ALERT_SUBSCRIBE_CLICK":
        day.notificationClicks += row._count._all;
        break;
    }
  }
  for (const subscription of subscriptions) {
    const day = dayFor(subscription.createdAt);
    day.alertSubscriptions += subscription._count._all;
  }
  for (const click of storedClicks) {
    if (!click.convertedAt) continue;
    const day = dayFor(click.convertedAt);
    day.notificationClicks = Math.max(
      day.notificationClicks,
      click._count._all,
    );
  }
  for (const click of logClicks) {
    const day = dayFor(click.day);
    day.notificationClicks = Math.max(day.notificationClicks, click.clicks);
  }
  for (const row of uniqueSavers) {
    const day = dayFor(row.day);
    day.uniqueSavers = Math.max(day.uniqueSavers, row.uniqueSavers);
  }
  for (const row of itemSavers) {
    const day = dayFor(row.day);
    day.uniqueSavers = Math.max(day.uniqueSavers, row.uniqueSavers);
  }
  return byDay;
}

type RollupEventMap = {
  [dateKey: string]: {
    productViews: number;
    wishlistSaves: number;
    wishlistRemoves: number;
    wishlistAddToCart: number;
    shares: number;
    shareVisits: number;
    alertSubscriptions: number;
    notificationClicks: number;
    uniqueSavers: number;
  };
};

/**
 * Notification delivery counters per shop per day from NotificationLog.
 * Uses conditional aggregation so one query returns all counters per day.
 */
async function notificationCountersByDay(
  shopId: string,
  bounds: { gte: Date; lt: Date },
): Promise<{
  [dateKey: string]: {
    notificationsSent: number;
    notificationsDelivered: number;
    notificationsOpened: number;
    unsubscribes: number;
  };
}> {
  const [rows, sentAlerts] = await Promise.all([
    db.$queryRaw<
      Array<{
        sentDate: string;
        notificationsSent: number;
        notificationsDelivered: number;
        notificationsOpened: number;
        unsubscribes: number;
      }>
    >(Prisma.sql`
    SELECT
      "sentAt"::date::text AS "sentDate",
      COUNT(*)::int AS "notificationsSent",
      COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS "notificationsDelivered",
      COUNT(*) FILTER (WHERE "openedAt" IS NOT NULL)::int AS "notificationsOpened",
      COUNT(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL)::int AS "unsubscribes"
    FROM "NotificationLog"
    WHERE "shopId" = ${shopId}
      AND "sentAt" >= ${bounds.gte}
      AND "sentAt" < ${bounds.lt}
    GROUP BY 1
  `),
    db.$queryRaw<Array<{ sentDate: string; notificationsSent: number }>>(
      Prisma.sql`
        SELECT "notifiedAt"::date::text AS "sentDate", COUNT(*)::int AS "notificationsSent"
        FROM "StockAlert"
        WHERE "shopId" = ${shopId} AND "channel" = 'email'
          AND "notifiedAt" >= ${bounds.gte} AND "notifiedAt" < ${bounds.lt}
        GROUP BY 1
      `,
    ),
  ]);

  const byDay: RollupNotifMap = {};
  for (const row of sentAlerts) {
    byDay[row.sentDate] = {
      notificationsSent: row.notificationsSent,
      notificationsDelivered: 0,
      notificationsOpened: 0,
      unsubscribes: 0,
    };
  }
  for (const row of rows) {
    const prior = byDay[row.sentDate]?.notificationsSent ?? 0;
    byDay[row.sentDate] = {
      // Match liveDailyTotals: prefer StockAlert notifiedAt, keep log delivery fields.
      notificationsSent: Math.max(prior, row.notificationsSent),
      notificationsDelivered: row.notificationsDelivered,
      notificationsOpened: row.notificationsOpened,
      unsubscribes: row.unsubscribes,
    };
  }
  return byDay;
}

type RollupNotifMap = {
  [dateKey: string]: {
    notificationsSent: number;
    notificationsDelivered: number;
    notificationsOpened: number;
    unsubscribes: number;
  };
};

/** All calendar days a range covers, as `YYYY-MM-DD`. */
function rangeDays(range: DateRange): string[] {
  const days: string[] = [];
  const end = Date.parse(`${range.to}T00:00:00Z`);
  for (
    let cursor = Date.parse(`${range.from}T00:00:00Z`);
    cursor <= end;
    cursor += DAY_MS
  ) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Roll up a single shop for a single date. Reads the raw counters for that
 * date only, then upserts the DailyStat row.
 */
async function rollupShopDay(
  shopId: string,
  date: string,
): Promise<{ upserted: boolean }> {
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + DAY_MS);
  const bounds = { gte: start, lt: end };

  const [events, revenue, notifications] = await Promise.all([
    eventCountersByDay(shopId, bounds),
    attributedRevenueByDay(shopId, bounds),
    notificationCountersByDay(shopId, bounds),
  ]);

  const dayEvents = events[date] ?? {
    productViews: 0,
    wishlistSaves: 0,
    wishlistRemoves: 0,
    wishlistAddToCart: 0,
    shares: 0,
    shareVisits: 0,
    alertSubscriptions: 0,
    notificationClicks: 0,
    uniqueSavers: 0,
  };
  const dayRevenue = revenue[date] ?? {
    wishlistDirect: 0,
    wishlistEstimated: 0,
    restockDirect: 0,
    restockEstimated: 0,
    wishlistOrders: 0,
    restockOrders: 0,
  };
  const dayNotifs = notifications[date] ?? {
    notificationsSent: 0,
    notificationsDelivered: 0,
    notificationsOpened: 0,
    unsubscribes: 0,
  };

  const payload = {
    productViews: dayEvents.productViews,
    wishlistSaves: dayEvents.wishlistSaves,
    wishlistRemoves: dayEvents.wishlistRemoves,
    uniqueSavers: dayEvents.uniqueSavers,
    wishlistAddToCart: dayEvents.wishlistAddToCart,
    shares: dayEvents.shares,
    shareVisits: dayEvents.shareVisits,
    alertSubscriptions: dayEvents.alertSubscriptions,
    notificationClicks: dayEvents.notificationClicks,
    notificationsSent: dayNotifs.notificationsSent,
    notificationsDelivered: dayNotifs.notificationsDelivered,
    notificationsOpened: dayNotifs.notificationsOpened,
    unsubscribes: dayNotifs.unsubscribes,
    wishlistOrders: dayRevenue.wishlistOrders,
    restockOrders: dayRevenue.restockOrders,
    wishlistRevenueDirect: new Prisma.Decimal(
      dayRevenue.wishlistDirect.toFixed(2),
    ),
    wishlistRevenueEstimated: new Prisma.Decimal(
      dayRevenue.wishlistEstimated.toFixed(2),
    ),
    restockRevenueDirect: new Prisma.Decimal(
      dayRevenue.restockDirect.toFixed(2),
    ),
    restockRevenueEstimated: new Prisma.Decimal(
      dayRevenue.restockEstimated.toFixed(2),
    ),
  };

  await db.dailyStat.upsert({
    where: { shopId_date: { shopId, date: new Date(date) } },
    update: payload,
    create: {
      shopId,
      date: new Date(date),
      ...payload,
    },
  });

  return { upserted: true };
}

/**
 * Roll up every shop for a date range. Each shop/date is independent, so a
 * failure for one shop does not abort the rest.
 */
export async function rollupRange(
  range: DateRange,
  options: { concurrency?: number } = {},
): Promise<RollupResult> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 16));
  const days = rangeDays(range);
  const shops = await db.shop.findMany({ select: { id: true } });

  // Every (shop, day) pair is a unit of work. Workers pull from a shared queue.
  const queue: Array<{ shopId: string; date: string }> = [];
  for (const shop of shops) {
    for (const date of days) {
      queue.push({ shopId: shop.id, date });
    }
  }

  const result: RollupResult = {
    shops: shops.length,
    days: days.length,
    rowsUpserted: 0,
    errors: [],
  };

  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= queue.length) break;
      const { shopId, date } = queue[index];
      try {
        await rollupShopDay(shopId, date);
        result.rowsUpserted += 1;
      } catch (error) {
        result.errors.push({
          shopId,
          date,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

/**
 * Roll up today (incomplete day — safe to re-run hourly). Used by the hourly
 * schedule so today's stats are always near-real-time.
 */
export async function rollupToday(now = new Date()): Promise<RollupResult> {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  return rollupRange({ from: today, to: today });
}

/**
 * Roll up yesterday (complete day). Used by the nightly schedule.
 */
export async function rollupYesterday(now = new Date()): Promise<RollupResult> {
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  )
    .toISOString()
    .slice(0, 10);
  return rollupRange({ from: yesterday, to: yesterday });
}

/**
 * Backfill an arbitrary date range for all shops. Use once after deploying the
 * rollup, or whenever historical data needs recomputing.
 */
export async function backfillRange(
  from: string,
  to: string,
  options?: { concurrency?: number },
): Promise<RollupResult> {
  return rollupRange({ from, to }, options);
}
