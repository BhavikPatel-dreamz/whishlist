import { Prisma } from "@prisma/client";
import db from "../db.server";
import {
  compareRange,
  paramsRange,
  parseAnalyticsParams,
  rangeBounds,
  type AnalyticsParams,
  type DateRange,
} from "../lib/analytics-params";
import { buildFunnel, rates, REVENUE_LABEL, safeRate } from "../lib/metrics";
import { gqlRequest } from "../lib/graphql.server";
import {
  compareTotals,
  dailySeries,
  dailyTotals,
  paginate,
  searchRows,
  sortRows,
} from "./analytics-shared.server";
import {
  REPORT_CSV_COLUMNS,
  type ReportResponse,
  type ReportRow,
  type ReportSlug,
} from "../lib/report-contract";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
  type ProductSummary,
} from "../lib/shopify-data.server";
import { loadInventoryVariants } from "./out-of-stock.server";
import { getShopSettings } from "./shop-settings.server";
import {
  getShopPlan,
  nextPlanForLogUpgrade,
  planNotificationLogLimit,
} from "../lib/billing/plan.server";

type ReportData = {
  summary: Record<string, number>;
  delta: Record<string, number>;
  series: Array<Record<string, string | number>>;
  rows: ReportRow[];
  revenueLabel: string;
};

const EMPTY_DELTA: Record<string, number> = {};

function totalsSummary(totals: Awaited<ReturnType<typeof dailyTotals>>) {
  return {
    productViews: totals.productViews,
    saves: totals.wishlistSaves,
    uniqueSavers: totals.uniqueSavers,
    wishlistRemoves: totals.wishlistRemoves,
    wishlistAddToCart: totals.wishlistAddToCart,
    alertSubscriptions: totals.alertSubscriptions,
    notificationsSent: totals.notificationsSent,
    notificationsDelivered: totals.notificationsDelivered,
    notificationsOpened: totals.notificationsOpened,
    notificationClicks: totals.notificationClicks,
    unsubscribes: totals.unsubscribes,
    wishlistOrders: totals.wishlistOrders,
    restockOrders: totals.restockOrders,
    saveRate: rates.saveRate(totals.wishlistSaves, totals.productViews),
    saveToCartRate: rates.saveToCartRate(
      totals.wishlistAddToCart,
      totals.wishlistSaves,
    ),
    wishlistConversionRate: rates.wishlistConversion(
      totals.wishlistOrders,
      totals.wishlistSaves,
    ),
    notificationRate: rates.notificationRate(
      totals.notificationsSent,
      totals.alertSubscriptions,
    ),
    openRate: rates.openRate(
      totals.notificationsOpened,
      totals.notificationsDelivered,
    ),
    clickRate: rates.clickRate(
      totals.notificationClicks,
      totals.notificationsDelivered,
    ),
    wishlistRevenueDirect: totals.wishlistRevenueDirect,
    wishlistRevenueEstimated: totals.wishlistRevenueEstimated,
    restockRevenueDirect: totals.restockRevenueDirect,
    restockRevenueEstimated: totals.restockRevenueEstimated,
    attributedRevenue:
      totals.wishlistRevenueDirect +
      totals.wishlistRevenueEstimated +
      totals.restockRevenueDirect +
      totals.restockRevenueEstimated,
  };
}

function revenueLabel(direct: number, estimated: number) {
  if (direct > 0 && estimated > 0) return REVENUE_LABEL.mixed;
  return estimated > 0 ? REVENUE_LABEL.estimated : REVENUE_LABEL.direct;
}

type WishlistOrderRevenue = {
  total: number;
  wishlistDirect: number;
  wishlistEstimated: number;
  restockDirect: number;
  restockEstimated: number;
};

type ShopifyOrderDetails = {
  total: number;
  customerId: string | null;
  email: string | null;
};

export async function loadShopifyOrderDetails(
  admin: GraphqlClient,
  rawOrderIds: string[],
): Promise<Map<string, ShopifyOrderDetails>> {
  const orderIds = [...new Set(rawOrderIds)];
  const details = new Map<string, ShopifyOrderDetails>();
  for (let index = 0; index < orderIds.length; index += 100) {
    const ids = orderIds
      .slice(index, index + 100)
      .map((id) =>
        id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`,
      );
    const result = await gqlRequest<{
      nodes: Array<{
        id: string;
        email: string | null;
        customer: { id: string } | null;
        totalPriceSet: { shopMoney: { amount: string } };
      } | null>;
    }>(
      admin,
      `query CustomerValueOrderDetails($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            email
            customer { id }
            totalPriceSet { shopMoney { amount } }
          }
        }
      }`,
      { variables: { ids } },
    ).catch(() => ({ nodes: [] }));
    for (const order of result.nodes) {
      if (!order) continue;
      details.set(order.id.split("/").pop()!, {
        total: Number(order.totalPriceSet.shopMoney.amount) || 0,
        customerId: order.customer?.id.split("/").pop() ?? null,
        email: order.email,
      });
    }
  }
  return details;
}

async function loadWishlistOrderRevenue(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<Map<string, WishlistOrderRevenue>> {
  const orders = await db.wishlistOrder.findMany({
    where: { shopId, createdAt: rangeBounds(range) },
    select: { orderId: true },
  });
  const orderIds = [...new Set(orders.map((order) => order.orderId))];
  if (!orderIds.length) return new Map();

  const attributions = await db.attribution.findMany({
    where: {
      shopId,
      orderId: { in: orderIds },
      model: "last_click",
      orderedAt: rangeBounds(range),
    },
    select: { orderId: true, source: true, type: true, revenue: true },
  });
  const attributedByOrder = new Map<
    string,
    Omit<WishlistOrderRevenue, "total">
  >();
  for (const attribution of attributions) {
    const amount = Number(attribution.revenue);
    const group = attributedByOrder.get(attribution.orderId) ?? {
      wishlistDirect: 0,
      wishlistEstimated: 0,
      restockDirect: 0,
      restockEstimated: 0,
    };
    const sourceKey =
      attribution.source === "WISHLIST" ? "wishlist" : "restock";
    const typeKey = attribution.type === "DIRECT" ? "Direct" : "Estimated";
    const key = `${sourceKey}${typeKey}` as keyof typeof group;
    group[key] += amount;
    attributedByOrder.set(attribution.orderId, group);
  }
  const totals = await loadShopifyOrderDetails(admin, orderIds);
  return new Map(
    [...totals].map(([orderId, details]) => {
      const attribution = attributedByOrder.get(orderId);
      return [
        orderId,
        {
          total: details.total,
          wishlistDirect: attribution?.wishlistDirect ?? 0,
          wishlistEstimated: attribution?.wishlistEstimated ?? 0,
          restockDirect: attribution?.restockDirect ?? 0,
          restockEstimated: attribution?.restockEstimated ?? 0,
        },
      ];
    }),
  );
}

function reconciledOrderRevenue(order: WishlistOrderRevenue) {
  const attributed =
    order.wishlistDirect +
    order.wishlistEstimated +
    order.restockDirect +
    order.restockEstimated;
  if (attributed <= 0) {
    return {
      wishlistDirect: order.total,
      wishlistEstimated: 0,
      restockDirect: 0,
      restockEstimated: 0,
    };
  }
  const scale = order.total / attributed;
  return {
    wishlistDirect: order.wishlistDirect * scale,
    wishlistEstimated: order.wishlistEstimated * scale,
    restockDirect: order.restockDirect * scale,
    restockEstimated: order.restockEstimated * scale,
  };
}

async function addWishlistOrderTotals(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  totals: Awaited<ReturnType<typeof dailyTotals>>,
) {
  const orderTotals = await loadWishlistOrderRevenue(shopId, admin, range);
  const adjusted = { ...totals };
  for (const order of orderTotals.values()) {
    const replacement = reconciledOrderRevenue(order);
    adjusted.wishlistRevenueDirect +=
      replacement.wishlistDirect - order.wishlistDirect;
    adjusted.wishlistRevenueEstimated +=
      replacement.wishlistEstimated - order.wishlistEstimated;
    adjusted.restockRevenueDirect +=
      replacement.restockDirect - order.restockDirect;
    adjusted.restockRevenueEstimated +=
      replacement.restockEstimated - order.restockEstimated;
  }
  return adjusted;
}

async function removedAbandonedData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  params: AnalyticsParams,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const { abandonedAfterDays } = await getShopSettings(shopId);
  const cutoff = new Date(Date.now() - abandonedAfterDays * DAY_MS);
  const [saveEvents, removeEvents, periodItems, abandonedItems] =
    await Promise.all([
      db.trackingEvent.groupBy({
        by: ["productId"],
        where: {
          shopId,
          type: "WISHLIST_SAVE",
          createdAt: bounds,
          productId: { not: null },
        },
        _count: { _all: true },
      }),
      db.wishlistEvent.groupBy({
        by: ["productId"],
        where: { shopId, type: "remove", createdAt: bounds },
        _count: { _all: true },
      }),
      db.wishlistItem.findMany({
        where: { shopId, createdAt: bounds },
        select: {
          productId: true,
          shopperId: true,
          customerId: true,
          guestToken: true,
        },
      }),
      db.wishlistItem.findMany({
        where: { shopId, createdAt: { lt: cutoff } },
        select: {
          productId: true,
          createdAt: true,
          shopperId: true,
          customerId: true,
          guestToken: true,
        },
      }),
    ]);

  const activeProductIds = [
    ...new Set(abandonedItems.map((item) => item.productId)),
  ];
  const attributions = activeProductIds.length
    ? await db.attribution.findMany({
        where: {
          shopId,
          source: "WISHLIST",
          model: "last_click",
          productId: { in: activeProductIds },
        },
        select: {
          productId: true,
          customerId: true,
          shopperId: true,
          orderedAt: true,
        },
      })
    : [];
  const purchasesByShopperProduct = new Map<string, Date[]>();
  for (const attribution of attributions) {
    const identity = attribution.shopperId ?? attribution.customerId;
    if (!identity) continue;
    const key = `${attribution.productId}:${identity}`;
    const dates = purchasesByShopperProduct.get(key) ?? [];
    dates.push(attribution.orderedAt);
    purchasesByShopperProduct.set(key, dates);
  }

  const byProduct = new Map<
    string,
    { removes: number; saves: number; abandoned: number }
  >();
  const groupFor = (productId: string) => {
    const group = byProduct.get(productId) ?? {
      removes: 0,
      saves: 0,
      abandoned: 0,
    };
    byProduct.set(productId, group);
    return group;
  };
  for (const event of saveEvents) {
    if (!event.productId) continue;
    const group = groupFor(event.productId);
    group.saves = Math.max(group.saves, event._count._all);
  }
  for (const event of removeEvents) {
    groupFor(event.productId).removes = event._count._all;
  }
  const savesByProduct = new Map<string, number>();
  for (const item of periodItems) {
    savesByProduct.set(
      item.productId,
      (savesByProduct.get(item.productId) ?? 0) + 1,
    );
  }
  for (const [productId, count] of savesByProduct) {
    const group = groupFor(productId);
    group.saves = Math.max(group.saves, count);
  }
  for (const item of abandonedItems) {
    const identity = item.shopperId ?? item.customerId ?? item.guestToken;
    const purchases = identity
      ? (purchasesByShopperProduct.get(`${item.productId}:${identity}`) ?? [])
      : [];
    const hasPurchased = purchases.some(
      (orderedAt) => orderedAt >= item.createdAt,
    );
    if (!hasPurchased) groupFor(item.productId).abandoned += 1;
  }

  const productIds = [...byProduct.keys()];
  const products = await getProductsByIds(admin, productIds, 1).catch(
    () => new Map<string, ProductSummary>(),
  );
  const rows = [...byProduct.entries()].map(([productId, group]) => ({
    title: products.get(productId)?.title ?? productId,
    saves: group.saves,
    removes: group.removes,
    abandonedSaves: group.abandoned,
    abandonRate: rates.wishlistShopperRate(group.abandoned, group.saves),
  }));
  return {
    summary: {
      saves: rows.reduce((sum, row) => sum + row.saves, 0),
      removes: rows.reduce((sum, row) => sum + row.removes, 0),
      abandonedSaves: rows.reduce((sum, row) => sum + row.abandonedSaves, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

/*
  if (!orderIds.length) return new Map();

  const attributions = await db.attribution.findMany({
    where: {
      shopId,
      orderId: { in: orderIds },
      model: "last_click",
      orderedAt: rangeBounds(range),
    },
    select: { orderId: true, source: true, type: true, revenue: true },
  });
  const attributedByOrder = new Map<
    string,
    Omit<WishlistOrderRevenue, "total">
  >();
  for (const attribution of attributions) {
    const amount = Number(attribution.revenue);
    const group = attributedByOrder.get(attribution.orderId) ?? {
      wishlistDirect: 0,
      wishlistEstimated: 0,
      restockDirect: 0,
      restockEstimated: 0,
    };
    const sourceKey =
      attribution.source === "WISHLIST" ? "wishlist" : "restock";
    const typeKey = attribution.type === "DIRECT" ? "Direct" : "Estimated";
    const key = `${sourceKey}${typeKey}` as keyof typeof group;
    group[key] += amount;
    attributedByOrder.set(attribution.orderId, group);
  }

  const totals = await loadShopifyOrderDetails(admin, orderIds);

  return new Map(
    [...totals].map(([orderId, details]) => {
      const attribution = attributedByOrder.get(orderId);
      return [
        orderId,
        {
          total: details.total,
          wishlistDirect: attribution?.wishlistDirect ?? 0,
          wishlistEstimated: attribution?.wishlistEstimated ?? 0,
          restockDirect: attribution?.restockDirect ?? 0,
          restockEstimated: attribution?.restockEstimated ?? 0,
        },
      ];
    }),
  );
}

function reconciledOrderRevenue(order: WishlistOrderRevenue) {
  const attributed =
    order.wishlistDirect +
    order.wishlistEstimated +
    order.restockDirect +
    order.restockEstimated;
  if (attributed <= 0) {
    return {
      wishlistDirect: order.total,
      wishlistEstimated: 0,
      restockDirect: 0,
      restockEstimated: 0,
    };
  }
  const scale = order.total / attributed;
  return {
    wishlistDirect: order.wishlistDirect * scale,
    wishlistEstimated: order.wishlistEstimated * scale,
    restockDirect: order.restockDirect * scale,
    restockEstimated: order.restockEstimated * scale,
  };
}

async function addWishlistOrderTotals(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  totals: Awaited<ReturnType<typeof dailyTotals>>,
) {
  const orderTotals = await loadWishlistOrderRevenue(shopId, admin, range);
  const adjusted = { ...totals };
  for (const order of orderTotals.values()) {
    const replacement = reconciledOrderRevenue(order);
    adjusted.wishlistRevenueDirect +=
      replacement.wishlistDirect - order.wishlistDirect;
    adjusted.wishlistRevenueEstimated +=
      replacement.wishlistEstimated - order.wishlistEstimated;
    adjusted.restockRevenueDirect +=
      replacement.restockDirect - order.restockDirect;
    adjusted.restockRevenueEstimated +=
      replacement.restockEstimated - order.restockEstimated;
  }
  return adjusted;
}
*/

async function overviewData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  previous: DateRange | null,
  groupBy: AnalyticsParams["groupBy"],
): Promise<ReportData> {
  const totals = await addWishlistOrderTotals(
    shopId,
    admin,
    range,
    await dailyTotals(shopId, range),
  );
  const previousTotals = previous
    ? await addWishlistOrderTotals(
        shopId,
        admin,
        previous,
        await dailyTotals(shopId, previous),
      )
    : null;
  const currentSeries = await dailySeries(shopId, range, groupBy);
  const previousSeries = previous
    ? await dailySeries(shopId, previous, groupBy)
    : null;
  const [pendingAlerts, totalAlertSubscriptions, previousAlertSubscriptions] =
    await Promise.all([
      db.stockAlert.count({ where: { shopId, status: "PENDING" } }),
      // This is a current subscription snapshot, matching the "Total
      // subscriptions" KPI on the Alert subscriptions report.
      db.stockAlert.count({ where: { shopId } }),
      previous
        ? db.stockAlert.count({
            where: {
              shopId,
              createdAt: { lt: rangeBounds(previous).lt },
            },
          })
        : Promise.resolve(0),
    ]);
  const currentTrendExtras = await overviewTrendExtras(shopId, range, groupBy);
  const previousTrendExtras = previous
    ? await overviewTrendExtras(shopId, previous, groupBy)
    : null;
  const summary = {
    ...totalsSummary(totals),
    alertSubscriptions: totalAlertSubscriptions,
    pendingAlerts,
  };
  const previousSummary: Record<string, number> = previousTotals
    ? {
        ...totalsSummary(previousTotals),
        alertSubscriptions: previousAlertSubscriptions,
      }
    : {};
  const delta = previousTotals
    ? compareTotals(summary, previousSummary)
    : EMPTY_DELTA;
  delete delta.pendingAlerts;
  const series = currentSeries.map((row, index) => {
    const currentExtras = currentTrendExtras.get(row.bucket);
    const previousRow = previousSeries?.[index];
    const previousExtras = previousRow
      ? previousTrendExtras?.get(previousRow.bucket)
      : undefined;
    const wishlistOrders = currentExtras?.wishlistOrders ?? row.wishlistOrders;
    const previousWishlistOrders =
      previousExtras?.wishlistOrders ?? previousRow?.wishlistOrders ?? 0;
    return {
      date: row.bucket,
      saves: row.wishlistSaves,
      uniqueSavers: currentExtras?.uniqueSavers ?? 0,
      subscriptions: row.alertSubscriptions,
      pendingAlerts,
      notificationsSent: row.notificationsSent,
      notificationClicks: row.notificationClicks,
      wishlistOrders,
      attributedRevenue: currentExtras?.attributedRevenue ?? 0,
      wishlistConversionRate: safeRate(wishlistOrders, row.wishlistSaves),
      ...(previousSeries
        ? {
            previousSaves: previousRow?.wishlistSaves ?? 0,
            previousUniqueSavers: previousExtras?.uniqueSavers ?? 0,
            previousSubscriptions: previousRow?.alertSubscriptions ?? 0,
            previousPendingAlerts: pendingAlerts,
            previousNotificationsSent: previousRow?.notificationsSent ?? 0,
            previousNotificationClicks: previousRow?.notificationClicks ?? 0,
            previousWishlistOrders,
            previousAttributedRevenue: previousExtras?.attributedRevenue ?? 0,
            previousWishlistConversionRate: safeRate(
              previousWishlistOrders,
              previousRow?.wishlistSaves ?? 0,
            ),
          }
        : {}),
    };
  });
  const rows = Object.entries(summary).map(([metric, value]) => ({
    metric,
    value,
    previous: previousSummary[metric] ?? 0,
    change: delta[metric] ?? 0,
  }));
  return {
    summary,
    delta,
    series,
    rows,
    revenueLabel: revenueLabel(
      totals.wishlistRevenueDirect + totals.restockRevenueDirect,
      totals.wishlistRevenueEstimated + totals.restockRevenueEstimated,
    ),
  };
}

async function overviewTrendExtras(
  shopId: string,
  range: DateRange,
  groupBy: AnalyticsParams["groupBy"],
) {
  const bounds = rangeBounds(range);
  const [eventSavers, itemSavers, attributions] = await Promise.all([
    db.$queryRaw<Array<{ bucket: string; count: number }>>(Prisma.sql`
      SELECT date_trunc(${groupBy}, "createdAt")::date::text AS "bucket",
        COUNT(DISTINCT "shopperId")::int AS "count"
      FROM "TrackingEvent"
      WHERE "shopId" = ${shopId} AND "type" = 'WISHLIST_SAVE'
        AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
      GROUP BY 1
    `),
    db.$queryRaw<Array<{ bucket: string; count: number }>>(Prisma.sql`
      SELECT date_trunc(${groupBy}, "createdAt")::date::text AS "bucket",
        COUNT(DISTINCT COALESCE(NULLIF("shopperId", ''), "customerId", "guestToken"))::int AS "count"
      FROM "WishlistItem"
      WHERE "shopId" = ${shopId}
        AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
      GROUP BY 1
    `),
    db.$queryRaw<
      Array<{
        bucket: string;
        wishlistOrders: number;
        attributedRevenue: number;
      }>
    >(Prisma.sql`
      SELECT date_trunc(${groupBy}, "orderedAt")::date::text AS "bucket",
        COUNT(*) FILTER (WHERE "source" = 'WISHLIST')::int AS "wishlistOrders",
        COALESCE(SUM("revenue"), 0)::float8 AS "attributedRevenue"
      FROM "Attribution"
      WHERE "shopId" = ${shopId}
        AND "model" = 'last_click'
        AND "orderedAt" >= ${bounds.gte} AND "orderedAt" < ${bounds.lt}
      GROUP BY 1
    `),
  ]);
  const result = new Map<
    string,
    { uniqueSavers: number; wishlistOrders: number; attributedRevenue: number }
  >();
  const getBucket = (bucket: string) => {
    const row = result.get(bucket) ?? {
      uniqueSavers: 0,
      wishlistOrders: 0,
      attributedRevenue: 0,
    };
    result.set(bucket, row);
    return row;
  };
  for (const row of eventSavers) {
    const bucket = getBucket(row.bucket);
    bucket.uniqueSavers = Math.max(bucket.uniqueSavers, row.count);
  }
  for (const row of itemSavers) {
    const bucket = getBucket(row.bucket);
    bucket.uniqueSavers = Math.max(bucket.uniqueSavers, row.count);
  }
  for (const row of attributions) {
    const bucket = getBucket(row.bucket);
    bucket.wishlistOrders = row.wishlistOrders;
    bucket.attributedRevenue = row.attributedRevenue;
  }
  return result;
}

async function activityData(
  shopId: string,
  range: DateRange,
  previous: DateRange | null,
  groupBy: AnalyticsParams["groupBy"],
): Promise<ReportData> {
  const [
    totals,
    previousTotals,
    currentSeries,
    previousSeries,
    currentExtras,
    previousExtras,
  ] = await Promise.all([
    dailyTotals(shopId, range),
    previous ? dailyTotals(shopId, previous) : Promise.resolve(null),
    dailySeries(shopId, range, groupBy),
    previous ? dailySeries(shopId, previous, groupBy) : Promise.resolve(null),
    overviewTrendExtras(shopId, range, groupBy),
    previous
      ? overviewTrendExtras(shopId, previous, groupBy)
      : Promise.resolve(null),
  ]);
  const series = currentSeries.map((row, index) => {
    const previousRow = previousSeries?.[index];
    return {
      date: row.bucket,
      saves: row.wishlistSaves,
      uniqueSavers: currentExtras.get(row.bucket)?.uniqueSavers ?? 0,
      subscriptions: row.alertSubscriptions,
      notificationsSent: row.notificationsSent,
      ...(previousSeries
        ? {
            previousSaves: previousRow?.wishlistSaves ?? 0,
            previousUniqueSavers:
              previousRow && previousExtras
                ? (previousExtras.get(previousRow.bucket)?.uniqueSavers ?? 0)
                : 0,
            previousSubscriptions: previousRow?.alertSubscriptions ?? 0,
            previousNotificationsSent: previousRow?.notificationsSent ?? 0,
          }
        : {}),
    };
  });
  const summary = totalsSummary(totals);
  return {
    summary,
    delta: previousTotals
      ? compareTotals(summary, totalsSummary(previousTotals))
      : EMPTY_DELTA,
    series,
    rows: series,
    revenueLabel: revenueLabel(
      totals.wishlistRevenueDirect + totals.restockRevenueDirect,
      totals.wishlistRevenueEstimated + totals.restockRevenueEstimated,
    ),
  };
}

async function funnelData(
  shopId: string,
  range: DateRange,
  previous: DateRange | null,
): Promise<ReportData> {
  const [totals, previousTotals] = await Promise.all([
    dailyTotals(shopId, range),
    previous ? dailyTotals(shopId, previous) : Promise.resolve(null),
  ]);
  const wishlist = buildFunnel([
    ["views", "Product views", totals.productViews],
    ["saves", "Wishlist saves", totals.wishlistSaves],
    ["cart", "Added to cart", totals.wishlistAddToCart],
    ["purchases", "Wishlist purchases", totals.wishlistOrders],
  ]);
  const restock = buildFunnel([
    ["subscribed", "Subscribed", totals.alertSubscriptions],
    ["notified", "Notified", totals.notificationsSent],
    ["clicked", "Clicked", totals.notificationClicks],
    ["purchased", "Purchased", totals.restockOrders],
  ]);
  const summary = totalsSummary(totals);
  return {
    summary,
    delta: previousTotals
      ? compareTotals(summary, totalsSummary(previousTotals))
      : EMPTY_DELTA,
    series: [],
    rows: [
      ...wishlist.map((stage) => ({
        funnel: "Wishlist",
        stage: stage.label,
        count: stage.count,
        rateFromPrevious: stage.rateFromPrevious,
        dropOff: stage.dropOff,
        dropOffRate: stage.dropOffRate,
      })),
      ...restock.map((stage) => ({
        funnel: "Back in stock",
        stage: stage.label,
        count: stage.count,
        rateFromPrevious: stage.rateFromPrevious,
        dropOff: stage.dropOff,
        dropOffRate: stage.dropOffRate,
      })),
    ],
    revenueLabel: revenueLabel(
      totals.wishlistRevenueDirect + totals.restockRevenueDirect,
      totals.wishlistRevenueEstimated + totals.restockRevenueEstimated,
    ),
  };
}

async function revenueData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const [entries, orderTotals] = await Promise.all([
    db.attribution.findMany({
      where: {
        shopId,
        model: "last_click",
        orderedAt: rangeBounds(range),
      },
      select: { source: true, type: true, orderId: true, revenue: true },
    }),
    loadWishlistOrderRevenue(shopId, admin, range),
  ]);
  const groups = new Map<
    string,
    { source: string; type: string; orders: Set<string>; revenue: number }
  >();
  const addRevenue = (
    source: string,
    type: string,
    orderId: string,
    revenue: number,
  ) => {
    const key = `${source}:${type}`;
    const group = groups.get(key) ?? {
      source,
      type,
      orders: new Set<string>(),
      revenue: 0,
    };
    group.orders.add(orderId);
    group.revenue += revenue;
    groups.set(key, group);
  };
  for (const entry of entries) {
    if (orderTotals.has(entry.orderId)) continue;
    addRevenue(entry.source, entry.type, entry.orderId, Number(entry.revenue));
  }
  for (const [orderId, order] of orderTotals) {
    const revenue = reconciledOrderRevenue(order);
    if (revenue.wishlistDirect > 0)
      addRevenue("WISHLIST", "DIRECT", orderId, revenue.wishlistDirect);
    if (revenue.wishlistEstimated > 0)
      addRevenue("WISHLIST", "ESTIMATED", orderId, revenue.wishlistEstimated);
    if (revenue.restockDirect > 0)
      addRevenue("RESTOCK_ALERT", "DIRECT", orderId, revenue.restockDirect);
    if (revenue.restockEstimated > 0)
      addRevenue(
        "RESTOCK_ALERT",
        "ESTIMATED",
        orderId,
        revenue.restockEstimated,
      );
  }
  const rows = [...groups.values()].map((group) => ({
    source: group.source,
    type: group.type,
    orders: group.orders.size,
    revenue: group.revenue,
    revenueLabel: group.type.toLowerCase(),
    averageOrderValue: safeRate(group.revenue, group.orders.size),
  }));
  const totals = await dailyTotals(shopId, range);
  return {
    summary: {
      orders: new Set([
        ...entries.map((entry) => entry.orderId),
        ...orderTotals.keys(),
      ]).size,
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      averageOrderValue: safeRate(
        rows.reduce((sum, row) => sum + row.revenue, 0),
        new Set([
          ...entries.map((entry) => entry.orderId),
          ...orderTotals.keys(),
        ]).size,
      ),
      directRevenue: rows
        .filter((row) => row.type === "DIRECT")
        .reduce((sum, row) => sum + row.revenue, 0),
      estimatedRevenue: rows
        .filter((row) => row.type === "ESTIMATED")
        .reduce((sum, row) => sum + row.revenue, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: revenueLabel(
      totals.wishlistRevenueDirect + totals.restockRevenueDirect,
      totals.wishlistRevenueEstimated + totals.restockRevenueEstimated,
    ),
  };
}

async function wishlistProductData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  conversion: boolean,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [
    events,
    uniqueRows,
    wishlistedVariants,
    wishlistItems,
    attributions,
    wishlistOrders,
  ] = await Promise.all([
    db.trackingEvent.groupBy({
      by: ["productId", "type"],
      where: {
        shopId,
        createdAt: bounds,
        productId: { not: null },
        type: {
          in: ["PRODUCT_VIEW", "WISHLIST_SAVE", "WISHLIST_ADD_TO_CART"],
        },
      },
      _count: { _all: true },
    }),
    db.$queryRaw<
      Array<{ productId: string; uniqueShoppers: number }>
    >(Prisma.sql`
      SELECT "productId", COUNT(DISTINCT "shopperId")::int AS "uniqueShoppers"
      FROM "TrackingEvent"
      WHERE "shopId" = ${shopId}
        AND "type" = 'WISHLIST_SAVE'
        AND "productId" IS NOT NULL
        AND "createdAt" >= ${bounds.gte}
        AND "createdAt" < ${bounds.lt}
      GROUP BY "productId"
    `),
    db.trackingEvent.groupBy({
      by: ["productId", "variantId"],
      where: {
        shopId,
        type: "WISHLIST_SAVE",
        createdAt: bounds,
        productId: { not: null },
        variantId: { not: null },
      },
    }),
    db.wishlistItem.findMany({
      where: { shopId, createdAt: bounds },
      select: {
        productId: true,
        variantId: true,
        shopperId: true,
        customerId: true,
        guestToken: true,
      },
    }),
    db.attribution.findMany({
      where: {
        shopId,
        source: "WISHLIST",
        model: "last_click",
        orderedAt: bounds,
      },
      select: {
        orderId: true,
        productId: true,
        orderedAt: true,
        touchAt: true,
        revenue: true,
        type: true,
      },
    }),
    db.wishlistOrder.findMany({
      where: { shopId, createdAt: bounds },
      select: { orderId: true, productId: true },
    }),
  ]);
  const groups = new Map<
    string,
    {
      views: number;
      saves: number;
      addsToCart: number;
      uniqueShoppers: number;
      purchases: number;
      revenue: number;
      directRevenue: number;
      estimatedRevenue: number;
      daysToPurchase: number;
    }
  >();
  const groupFor = (productId: string) => {
    const group = groups.get(productId) ?? {
      views: 0,
      saves: 0,
      addsToCart: 0,
      uniqueShoppers: 0,
      purchases: 0,
      revenue: 0,
      directRevenue: 0,
      estimatedRevenue: 0,
      daysToPurchase: 0,
    };
    groups.set(productId, group);
    return group;
  };
  for (const event of events) {
    if (!event.productId) continue;
    const group = groupFor(event.productId);
    if (event.type === "PRODUCT_VIEW") group.views = event._count._all;
    if (event.type === "WISHLIST_SAVE") group.saves = event._count._all;
    if (event.type === "WISHLIST_ADD_TO_CART")
      group.addsToCart = event._count._all;
  }
  for (const row of uniqueRows)
    groupFor(row.productId).uniqueShoppers = row.uniqueShoppers;
  // Only variants that were actually wishlisted during this period belong in
  // this report. Do not count every variant configured on the Shopify product.
  const variantIdsByProduct = new Map<string, Set<string>>();
  const addWishlistedVariant = (
    productId: string,
    variantId: string | null,
  ) => {
    if (!variantId) return;
    const ids = variantIdsByProduct.get(productId) ?? new Set<string>();
    ids.add(variantId);
    variantIdsByProduct.set(productId, ids);
  };
  for (const row of wishlistedVariants) {
    if (row.productId && row.variantId) {
      addWishlistedVariant(row.productId, row.variantId);
    }
  }
  const wishlistCounts = new Map<string, number>();
  const wishlistShoppers = new Map<string, Set<string>>();
  for (const item of wishlistItems) {
    addWishlistedVariant(item.productId, item.variantId);
    wishlistCounts.set(
      item.productId,
      (wishlistCounts.get(item.productId) ?? 0) + 1,
    );
    const identity = item.shopperId ?? item.customerId ?? item.guestToken;
    if (!identity) continue;
    const shoppers = wishlistShoppers.get(item.productId) ?? new Set<string>();
    shoppers.add(identity);
    wishlistShoppers.set(item.productId, shoppers);
  }
  for (const [productId, count] of wishlistCounts) {
    const group = groupFor(productId);
    group.saves = Math.max(group.saves, count);
    group.uniqueShoppers = Math.max(
      group.uniqueShoppers,
      wishlistShoppers.get(productId)?.size ?? 0,
    );
  }
  const purchaseOrdersByProduct = new Map<string, Set<string>>();
  const recordPurchase = (productId: string, orderId: string) => {
    const orderIds =
      purchaseOrdersByProduct.get(productId) ?? new Set<string>();
    orderIds.add(orderId);
    purchaseOrdersByProduct.set(productId, orderIds);
  };
  for (const order of wishlistOrders) {
    recordPurchase(order.productId, order.orderId);
  }
  for (const attribution of attributions) {
    const group = groupFor(attribution.productId);
    recordPurchase(attribution.productId, attribution.orderId);
    const revenue = Number(attribution.revenue);
    group.revenue += revenue;
    if (attribution.type === "DIRECT") group.directRevenue += revenue;
    else group.estimatedRevenue += revenue;
    group.daysToPurchase +=
      (attribution.orderedAt.getTime() - attribution.touchAt.getTime()) /
      86400000;
  }
  for (const [productId, orderIds] of purchaseOrdersByProduct) {
    groupFor(productId).purchases = orderIds.size;
  }

  const productIds = [...groups.keys()];
  // Variant count and names are shown in this report, so fetch the variants
  // instead of the default single-variant product summary.
  const products = await getProductsByIds(admin, productIds, 250).catch(
    () => new Map<string, ProductSummary>(),
  );
  const rows = productIds.map((productId) => {
    const group = groups.get(productId)!;
    const wishlistedVariantIds =
      variantIdsByProduct.get(productId) ?? new Set();
    const productVariants = products.get(productId)?.variants ?? [];
    const matchedVariants = productVariants.filter((variant) =>
      wishlistedVariantIds.has(variant.variantId),
    );
    const matchedIds = new Set(
      matchedVariants.map((variant) => variant.variantId),
    );
    const variantNames = [
      ...matchedVariants.map((variant) => variant.title),
      ...[...wishlistedVariantIds].filter((id) => !matchedIds.has(id)),
    ];
    const revenueType = revenueLabel(
      group.directRevenue,
      group.estimatedRevenue,
    );
    return conversion
      ? {
          productId,
          title: products.get(productId)?.title ?? productId,
          collection:
            products
              .get(productId)
              ?.collections.map((item) => item.title)
              .join(", ") || "—",
          saves: group.saves,
          purchases: group.purchases,
          conversionRate: rates.wishlistConversion(
            group.purchases,
            group.saves,
          ),
          averageDaysToPurchase: safeRate(
            group.daysToPurchase,
            group.purchases,
          ),
          revenue: group.revenue,
          revenueLabel: revenueType,
        }
      : {
          productId,
          title: products.get(productId)?.title ?? productId,
          variantCount: wishlistedVariantIds.size,
          variantNames: variantNames.join(", ") || "—",
          saves: group.saves,
          uniqueShoppers: group.uniqueShoppers,
          saveRate: rates.saveRate(group.saves, group.views),
          addsToCart: group.addsToCart,
          purchases: group.purchases,
          conversionRate: rates.wishlistConversion(
            group.purchases,
            group.saves,
          ),
        };
  });
  if (conversion) {
    const conversionRows = rows as Array<Record<string, unknown>>;
    conversionRows.sort(
      (left, right) =>
        Number(right.conversionRate ?? 0) - Number(left.conversionRate ?? 0),
    );
    const bestCount = Math.max(1, Math.ceil(conversionRows.length * 0.25));
    const averageCount = Math.ceil(conversionRows.length * 0.5);
    conversionRows.forEach((row, index) => {
      row.rank =
        index < bestCount
          ? "Best"
          : index < bestCount + averageCount
            ? "Average"
            : "Needs attention";
    });
  }
  const saves = rows.reduce((sum, row) => sum + row.saves, 0);
  const purchases = rows.reduce((sum, row) => sum + row.purchases, 0);
  const totalViews = [...groups.values()].reduce(
    (sum, group) => sum + group.views,
    0,
  );
  const addsToCart = [...groups.values()].reduce(
    (sum, group) => sum + group.addsToCart,
    0,
  );
  const uniqueShoppers = new Set(
    wishlistItems
      .map((item) => item.shopperId ?? item.customerId ?? item.guestToken)
      .filter((identity): identity is string => Boolean(identity)),
  ).size;
  const summary = {
    products: rows.length,
    variantCount: [...variantIdsByProduct.values()].reduce(
      (sum, variantIds) => sum + variantIds.size,
      0,
    ),
    saves,
    purchases,
    uniqueShoppers,
    saveRate: rates.saveRate(saves, totalViews),
    addsToCart,
    conversionRate: rates.wishlistConversion(purchases, saves),
    averageDaysToPurchase: safeRate(
      [...groups.values()].reduce(
        (sum, group) => sum + group.daysToPurchase,
        0,
      ),
      purchases,
    ),
    revenue: rows.reduce(
      (sum, row) => sum + (typeof row.revenue === "number" ? row.revenue : 0),
      0,
    ),
  };
  return {
    summary,
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: conversion
      ? revenueLabel(
          rows.reduce(
            (sum, row) =>
              sum + (typeof row.revenue === "number" ? row.revenue : 0),
            0,
          ),
          0,
        )
      : REVENUE_LABEL.direct,
  };
}

async function alertSubscriptionData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const [all, recent] = await Promise.all([
    db.$queryRaw<
      Array<{
        productId: string;
        variantId: string;
        productTitle: string | null;
        variantTitle: string | null;
        totalSubscriptions: number;
        notified: number;
        waiting: number;
      }>
    >(Prisma.sql`
      SELECT "productId", "variantId",
        MAX("productTitle") AS "productTitle",
        MAX("variantTitle") AS "variantTitle",
        COUNT(*)::int AS "totalSubscriptions",
        COUNT(*) FILTER (WHERE "notifiedAt" IS NOT NULL)::int AS "notified",
        COUNT(*) FILTER (WHERE "notifiedAt" IS NULL)::int AS "waiting"
      FROM "StockAlert"
      WHERE "shopId" = ${shopId}
      GROUP BY "productId", "variantId"
    `),
    db.stockAlert.groupBy({
      by: ["productId", "variantId"],
      where: { shopId, createdAt: rangeBounds(range) },
      _count: { _all: true },
    }),
  ]);
  const recentCounts = new Map(
    recent.map((row) => [`${row.productId}:${row.variantId}`, row._count._all]),
  );
  const rows = all
    .map((row) => {
      const key = `${row.productId}:${row.variantId}`;
      return {
        productId: row.productId,
        variantId: row.variantId,
        title: row.productTitle ?? row.productId,
        variantTitle: row.variantTitle ?? row.variantId,
        totalSubscriptions: row.totalSubscriptions,
        newSubscriptions: recentCounts.get(key) ?? 0,
        notified: row.notified,
        waiting: row.waiting,
      };
    })
    .sort((left, right) => right.totalSubscriptions - left.totalSubscriptions);
  return {
    summary: {
      variants: rows.length,
      subscriptions: rows.reduce((sum, row) => sum + row.totalSubscriptions, 0),
      newSubscriptions: rows.reduce(
        (sum, row) => sum + row.newSubscriptions,
        0,
      ),
      notified: rows.reduce((sum, row) => sum + row.notified, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function alertCustomersData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const groups = await db.stockAlert.groupBy({
    by: ["contactKey"],
    where: { shopId, createdAt: rangeBounds(range) },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const rows = groups
    .map((group) => {
      const [channel, contact] = group.contactKey.split(":", 2);
      return {
        contact: contact ?? group.contactKey,
        channel: channel === "sms" ? "SMS" : "Email",
        requests: group._count._all,
        lastRequestedAt: group._max.createdAt?.toISOString() ?? "",
      };
    })
    .sort(
      (left, right) =>
        right.requests - left.requests ||
        right.lastRequestedAt.localeCompare(left.lastRequestedAt),
    );
  return {
    summary: {
      customers: rows.length,
      requests: rows.reduce((total, row) => total + row.requests, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function pendingAlertData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const alerts = await db.stockAlert.findMany({
    where: {
      shopId,
      status: "PENDING",
      createdAt: rangeBounds(range),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      customerId: true,
      email: true,
      phone: true,
      channel: true,
      productId: true,
      variantId: true,
      productTitle: true,
      variantTitle: true,
      createdAt: true,
      pendingReason: true,
    },
  });
  const rows = alerts.map((alert) => ({
    id: alert.id,
    shopper: alert.customerId ?? alert.email ?? alert.phone ?? "Guest",
    contact: alert.email ?? alert.phone ?? "Not recorded",
    channel: alert.channel,
    productId: alert.productId,
    title: alert.productTitle ?? alert.productId,
    variantId: alert.variantId,
    variantTitle: alert.variantTitle ?? alert.variantId,
    signedUpAt: alert.createdAt.toISOString(),
    pendingReason: alert.pendingReason ?? "out_of_stock",
  }));
  const pendingVariants = new Set(
    alerts.map((alert) => `${alert.productId}:${alert.variantId}`),
  ).size;
  return {
    summary: { pendingVariants, pendingAlerts: rows.length },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function restockConversionData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [alerts, notificationLogs] = await Promise.all([
    db.stockAlert.findMany({
      where: {
        shopId,
        OR: [
          { createdAt: bounds },
          { notifiedAt: bounds },
          { convertedAt: bounds },
          { purchasedAt: bounds },
        ],
      },
      select: {
        productId: true,
        productTitle: true,
        createdAt: true,
        notifiedAt: true,
        convertedAt: true,
        purchasedAt: true,
        purchaseRevenue: true,
      },
    }),
    db.notificationLog.findMany({
      where: { shopId, kind: "RESTOCK", sentAt: rangeBounds(range) },
      select: { productId: true, deliveredAt: true, openedAt: true },
    }),
  ]);
  const groups = new Map<
    string,
    {
      title: string;
      subscribed: number;
      notified: number;
      clicked: number;
      purchased: number;
      revenue: number;
      delivered: number;
      opened: number;
    }
  >();
  const inRange = (date: Date | null) =>
    date !== null && date >= bounds.gte && date < bounds.lt;
  for (const alert of alerts) {
    const group = groups.get(alert.productId) ?? {
      title: alert.productTitle ?? alert.productId,
      subscribed: 0,
      notified: 0,
      clicked: 0,
      purchased: 0,
      revenue: 0,
      delivered: 0,
      opened: 0,
    };
    if (inRange(alert.createdAt)) group.subscribed++;
    if (inRange(alert.notifiedAt)) group.notified++;
    if (inRange(alert.convertedAt)) group.clicked++;
    if (inRange(alert.purchasedAt)) {
      group.purchased++;
      group.revenue += Number(alert.purchaseRevenue ?? 0);
    }
    groups.set(alert.productId, group);
  }
  for (const log of notificationLogs) {
    const group = groups.get(log.productId) ?? {
      title: log.productId,
      subscribed: 0,
      notified: 0,
      clicked: 0,
      purchased: 0,
      revenue: 0,
      delivered: 0,
      opened: 0,
    };
    if (log.deliveredAt) group.delivered++;
    if (log.openedAt) group.opened++;
    groups.set(log.productId, group);
  }
  const rows = [...groups].map(([productId, group]) => ({
    productId,
    title: group.title,
    subscribed: group.subscribed,
    notified: group.notified,
    clicked: group.clicked,
    purchased: group.purchased,
    notificationRate: rates.notificationRate(group.notified, group.subscribed),
    openRate: rates.openRate(group.opened, group.delivered),
    clickRate: rates.clickRate(group.clicked, group.notified),
    conversionRate: rates.restockConversion(group.purchased, group.subscribed),
    revenue: group.revenue,
    revenueLabel: "direct",
  }));
  const subscribed = rows.reduce((sum, row) => sum + row.subscribed, 0);
  const notified = rows.reduce((sum, row) => sum + row.notified, 0);
  return {
    summary: {
      subscribed,
      notified,
      clicked: rows.reduce((sum, row) => sum + row.clicked, 0),
      purchased: rows.reduce((sum, row) => sum + row.purchased, 0),
      notificationRate: rates.notificationRate(notified, subscribed),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function notificationDeliveryData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  params: AnalyticsParams,
): Promise<ReportData> {
  const channel = ["EMAIL", "SMS", "WHATSAPP", "PUSH"].includes(
    params.channel ?? "",
  )
    ? (params.channel as "EMAIL" | "SMS" | "WHATSAPP" | "PUSH")
    : undefined;
  const [logs, convertedAlerts, subscribeClicks] = await Promise.all([
    db.notificationLog.findMany({
      where: {
        shopId,
        OR: [{ sentAt: rangeBounds(range) }, { clickedAt: rangeBounds(range) }],
        ...(channel ? { channel } : {}),
      },
      select: {
        id: true,
        subscriptionId: true,
        productId: true,
        channel: true,
        status: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
        unsubscribedAt: true,
      },
    }),
    db.stockAlert.findMany({
      where: {
        shopId,
        convertedAt: rangeBounds(range),
        ...(channel ? { channel: channel.toLowerCase() } : {}),
      },
      select: {
        id: true,
        productId: true,
        channel: true,
      },
    }),
    db.trackingEvent.findMany({
      where: {
        shopId,
        type: "ALERT_SUBSCRIBE_CLICK",
        createdAt: rangeBounds(range),
        productId: { not: null },
        ...(channel ? { channel: channel.toLowerCase() } : {}),
      },
      select: { productId: true, channel: true },
    }),
  ]);
  const loggedAlertIds = new Set(
    logs.flatMap((log) => (log.subscriptionId ? [log.subscriptionId] : [])),
  );
  const unloggedConversions = convertedAlerts.filter(
    (alert) => !loggedAlertIds.has(alert.id),
  );
  const [products, purchases] = await Promise.all([
    getProductsByIds(
      admin,
      [
        ...new Set([
          ...logs.map((log) => log.productId),
          ...unloggedConversions.map((alert) => alert.productId),
          ...subscribeClicks.flatMap((click) =>
            click.productId ? [click.productId] : [],
          ),
        ]),
      ],
      1,
    ).catch(() => new Map<string, ProductSummary>()),
    logs.length
      ? db.attribution.findMany({
          where: {
            shopId,
            source: "WISHLIST",
            model: "last_click",
            notificationLogId: { in: logs.map((log) => log.id) },
            orderedAt: rangeBounds(range),
          },
          select: {
            notificationLogId: true,
            productId: true,
            orderId: true,
            revenue: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const groups = new Map<
    string,
    {
      productId: string;
      title: string;
      imageUrl: string | null;
      channel: string;
      sent: number;
      delivered: number;
      bounced: number;
      opened: number;
      clicked: number;
      unsubscribed: number;
      orderIds: Set<string>;
      revenue: number;
    }
  >();
  const logsById = new Map(logs.map((log) => [log.id, log]));
  const getGroup = (productId: string, channelName: string) => {
    const key = `${productId}:${channelName}`;
    const group = groups.get(key) ?? {
      productId,
      title: products.get(productId)?.title ?? productId,
      imageUrl: products.get(productId)?.imageUrl ?? null,
      channel: channelName,
      sent: 0,
      delivered: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      unsubscribed: 0,
      orderIds: new Set<string>(),
      revenue: 0,
    };
    groups.set(key, group);
    return group;
  };
  for (const log of logs) {
    const group = getGroup(log.productId, log.channel);
    group.sent++;
    if (log.deliveredAt || log.status === "delivered") group.delivered++;
    if (log.status === "bounced") group.bounced++;
    if (log.openedAt) group.opened++;
    if (log.clickedAt) group.clicked++;
    if (log.unsubscribedAt) group.unsubscribed++;
  }
  for (const alert of unloggedConversions) {
    getGroup(alert.productId, alert.channel.toUpperCase()).clicked++;
  }
  for (const click of subscribeClicks) {
    if (!click.productId || !click.channel) continue;
    getGroup(click.productId, click.channel.toUpperCase()).clicked++;
  }
  for (const purchase of purchases) {
    const log = purchase.notificationLogId
      ? logsById.get(purchase.notificationLogId)
      : undefined;
    if (!log) continue;
    const group = getGroup(purchase.productId, log.channel);
    group.orderIds.add(purchase.orderId);
    group.revenue += Number(purchase.revenue);
  }
  const rows = [...groups.values()].map((group) => ({
    productId: group.productId,
    title: group.title,
    imageUrl: group.imageUrl,
    channel: group.channel,
    sent: group.sent,
    delivered: group.delivered,
    bounced: group.bounced,
    opened: group.opened,
    clicked: group.clicked,
    purchased: group.orderIds.size,
    revenue: group.revenue,
    unsubscribed: group.unsubscribed,
    openRate: rates.openRate(group.opened, group.delivered),
    clickRate: rates.clickRate(group.clicked, group.delivered),
    purchaseRate: safeRate(group.orderIds.size, group.clicked),
    bounceRate: safeRate(group.bounced, group.sent),
  }));
  return {
    summary: {
      sent: rows.reduce((sum, row) => sum + row.sent, 0),
      delivered: rows.reduce((sum, row) => sum + row.delivered, 0),
      bounced: rows.reduce((sum, row) => sum + row.bounced, 0),
      opened: rows.reduce((sum, row) => sum + row.opened, 0),
      clicked: rows.reduce((sum, row) => sum + row.clicked, 0),
      unsubscribed: rows.reduce((sum, row) => sum + row.unsubscribed, 0),
      purchased: new Set(purchases.map((purchase) => purchase.orderId)).size,
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

/* ============================================================================
   Phase 2 & 3 report data loaders
   ============================================================================ */

type SharedWishlistVisit = {
  shareId: string;
  shopperId: string;
  channel: string;
  at: Date;
  productIds: string[];
};

type SharedWishlistOrderLine = {
  orderId: string;
  orderNumber: string;
  orderedAt: Date;
  customerId: string | null;
  productId: string;
  quantity: number;
  revenue: number;
};

type SharedWishlistAttribution = Omit<SharedWishlistOrderLine, "revenue"> & {
  lineItemId: string;
  shopperId: string | null;
  revenue: Prisma.Decimal | number;
};

function sharedWishlistVisits(
  events: Array<{
    type: string;
    shopperId: string;
    channel: string | null;
    createdAt: Date;
    meta: Prisma.JsonValue | null;
  }>,
): SharedWishlistVisit[] {
  return events.flatMap((event) => {
    if (
      event.type !== "WISHLIST_SHARE_VISIT" ||
      !event.meta ||
      typeof event.meta !== "object" ||
      Array.isArray(event.meta)
    )
      return [];
    const meta = event.meta as Record<string, unknown>;
    if (typeof meta.shareId !== "string" || !Array.isArray(meta.productIds))
      return [];
    return [
      {
        shareId: meta.shareId,
        shopperId: event.shopperId,
        channel: event.channel ?? "link",
        at: event.createdAt,
        productIds: meta.productIds.filter(
          (id): id is string => typeof id === "string",
        ),
      },
    ];
  });
}

function matchSharedWishlistOrders(
  visits: SharedWishlistVisit[],
  attributions: SharedWishlistAttribution[],
) {
  const ordersByShare = new Map<string, Map<string, SharedWishlistOrderLine>>();
  for (const attribution of attributions) {
    const attributionShopperId =
      attribution.shopperId ?? attribution.customerId;
    if (!attributionShopperId) continue;
    const visit = visits
      .filter(
        (candidate) =>
          (candidate.shopperId === attributionShopperId ||
            (attribution.customerId &&
              candidate.shopperId === attribution.customerId)) &&
          candidate.at < attribution.orderedAt &&
          candidate.productIds.includes(attribution.productId),
      )
      .sort((left, right) => right.at.getTime() - left.at.getTime())[0];
    if (!visit) continue;
    const orderLines = ordersByShare.get(visit.shareId) ?? new Map();
    const key = `${attribution.orderId}:${attribution.lineItemId}`;
    if (!orderLines.has(key)) {
      orderLines.set(key, {
        orderId: attribution.orderId,
        orderNumber: attribution.orderNumber,
        orderedAt: attribution.orderedAt,
        customerId: attribution.customerId,
        productId: attribution.productId,
        quantity: attribution.quantity,
        revenue: Number(attribution.revenue),
      });
    }
    ordersByShare.set(visit.shareId, orderLines);
  }
  return new Map(
    [...ordersByShare].map(([shareId, lines]) => [
      shareId,
      [...lines.values()],
    ]),
  );
}

async function sharedWishlistsData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const [events, shares, attributions] = await Promise.all([
    db.trackingEvent.findMany({
      where: {
        shopId,
        type: { in: ["WISHLIST_SHARE", "WISHLIST_SHARE_VISIT"] },
        createdAt: rangeBounds(range),
      },
      select: {
        type: true,
        channel: true,
        shopperId: true,
        createdAt: true,
        meta: true,
      },
    }),
    db.wishlistShare.findMany({
      where: { shopId, createdAt: rangeBounds(range) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerId: true,
        mode: true,
        listName: true,
        products: true,
        createdAt: true,
      },
    }),
    db.attribution.findMany({
      where: {
        shopId,
        source: "WISHLIST",
        model: { in: ["last_click", "any_touch"] },
        orderedAt: rangeBounds(range),
      },
      select: {
        lineItemId: true,
        shopperId: true,
        customerId: true,
        orderId: true,
        orderNumber: true,
        productId: true,
        quantity: true,
        revenue: true,
        orderedAt: true,
      },
    }),
  ]);
  const byChannel = new Map<
    string,
    { shares: number; visits: number; ordersAfterVisit: Set<string> }
  >();
  const visits = sharedWishlistVisits(events);
  for (const share of shares) {
    const channel = share.mode || "direct";
    const group = byChannel.get(channel) ?? {
      shares: 0,
      visits: 0,
      ordersAfterVisit: new Set<string>(),
    };
    group.shares++;
    byChannel.set(channel, group);
  }
  for (const event of events) {
    const channel = event.channel ?? "direct";
    const group = byChannel.get(channel) ?? {
      shares: 0,
      visits: 0,
      ordersAfterVisit: new Set<string>(),
    };
    if (event.type === "WISHLIST_SHARE_VISIT") {
      group.visits++;
    }
    byChannel.set(channel, group);
  }
  const ordersByShare = matchSharedWishlistOrders(visits, attributions);
  const orderIdsByShare = new Map(
    [...ordersByShare].map(([shareId, orders]) => [
      shareId,
      new Set(orders.map((order) => order.orderId)),
    ]),
  );
  const snapshots = shares.map((share) =>
    Array.isArray(share.products)
      ? (share.products as Array<{ productId: string; handle: string | null }>)
      : [],
  );
  const productIds = [
    ...new Set(
      snapshots.flatMap((items) => items.map((item) => item.productId)),
    ),
  ];
  const customerIds = [
    ...new Set(
      shares
        .map((share) => share.customerId)
        .filter((customerId) => !customerId.startsWith("guest:")),
    ),
  ];
  const [products, customers] = await Promise.all([
    getProductsByIds(admin, productIds, 1).catch(() => new Map()),
    getCustomerNamesByIds(admin, customerIds).catch(() => new Map()),
  ]);
  const productTitles = snapshots.map((items) =>
    items.map(
      (item) =>
        products.get(item.productId)?.title ??
        item.handle ??
        `Product ${item.productId}`,
    ),
  );
  const rows = shares.map((share, index) => ({
    shareId: share.id,
    listName: share.listName ?? "My Wishlist",
    customer: share.customerId.startsWith("guest:")
      ? "Guest"
      : (customers.get(share.customerId) ?? `Customer ${share.customerId}`),
    channel: share.mode || "direct",
    products:
      productTitles[index].length > 2
        ? `${productTitles[index].slice(0, 2).join(", ")} +${productTitles[index].length - 2} more`
        : productTitles[index].join(", ") || "No products recorded",
    sharedAt: share.createdAt.toISOString(),
    ordersAfterVisit: orderIdsByShare.get(share.id)?.size ?? 0,
  }));
  const totalVisits = [...byChannel.values()].reduce(
    (sum, group) => sum + group.visits,
    0,
  );
  const ordersAfterVisit = new Set(
    [...ordersByShare.values()].flatMap((orders) =>
      orders.map((order) => order.orderId),
    ),
  );
  return {
    summary: {
      shares: shares.length,
      visits: totalVisits,
      ordersAfterVisit: ordersAfterVisit.size,
      visitToOrderRate: rates.clickToPurchase(
        ordersAfterVisit.size,
        totalVisits,
      ),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

export async function loadSharedWishlistOrderDetail(
  shopId: string,
  admin: GraphqlClient,
  shareId: string,
  range: DateRange,
) {
  const [share, events, attributions] = await Promise.all([
    db.wishlistShare.findFirst({
      where: { id: shareId, shopId },
      select: {
        id: true,
        customerId: true,
        mode: true,
        listName: true,
        products: true,
        createdAt: true,
      },
    }),
    db.trackingEvent.findMany({
      where: {
        shopId,
        type: "WISHLIST_SHARE_VISIT",
        createdAt: rangeBounds(range),
      },
      select: {
        type: true,
        channel: true,
        shopperId: true,
        createdAt: true,
        meta: true,
      },
    }),
    db.attribution.findMany({
      where: {
        shopId,
        source: "WISHLIST",
        model: { in: ["last_click", "any_touch"] },
        orderedAt: rangeBounds(range),
      },
      select: {
        lineItemId: true,
        shopperId: true,
        customerId: true,
        orderId: true,
        orderNumber: true,
        productId: true,
        quantity: true,
        revenue: true,
        orderedAt: true,
      },
    }),
  ]);
  if (!share) return null;

  const sharedProducts = Array.isArray(share.products)
    ? Array.from(
        new Map(
          (
            share.products as Array<{
              productId?: unknown;
              handle?: unknown;
            }>
          )
            .filter((item) => item && typeof item.productId === "string")
            .map((item) => [item.productId as string, item]),
        ).values(),
      )
    : [];

  const orders =
    matchSharedWishlistOrders(
      sharedWishlistVisits(events).filter((visit) => visit.shareId === shareId),
      attributions,
    ).get(shareId) ?? [];
  const [products, customers] = await Promise.all([
    getProductsByIds(
      admin,
      [
        ...new Set([
          ...orders.map((order) => order.productId),
          ...sharedProducts.map((item) => item.productId as string),
        ]),
      ],
      1,
    ).catch(() => new Map()),
    getCustomerNamesByIds(admin, [
      ...new Set(
        orders.flatMap((order) => (order.customerId ? [order.customerId] : [])),
      ),
    ]).catch(() => new Map()),
  ]);

  return {
    shareId: share.id,
    listName: share.listName ?? "My Wishlist",
    sharedBy: share.customerId.startsWith("guest:")
      ? "Guest"
      : (customers.get(share.customerId) ?? `Customer ${share.customerId}`),
    channel: share.mode,
    sharedAt: share.createdAt.toISOString(),
    products: sharedProducts.map((item) => {
      const productId = item.productId as string;
      const product = products.get(productId);
      return {
        productId,
        title:
          product?.title ??
          (typeof item.handle === "string" && item.handle
            ? item.handle
            : `Product ${productId}`),
        imageUrl: product?.imageUrl ?? null,
      };
    }),
    orders: orders.map((order) => ({
      ...order,
      orderedAt: order.orderedAt.toISOString(),
      customer: order.customerId
        ? (customers.get(order.customerId) ?? `Customer ${order.customerId}`)
        : "Guest visitor",
      product:
        products.get(order.productId)?.title ?? `Product ${order.productId}`,
    })),
  };
}

async function wishlistOrdersData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const [attributions, savedOrders] = await Promise.all([
    db.attribution.findMany({
      where: {
        shopId,
        source: "WISHLIST",
        model: "last_click",
        orderedAt: rangeBounds(range),
      },
      orderBy: { orderedAt: "desc" },
      select: {
        orderId: true,
        orderNumber: true,
        orderedAt: true,
        customerId: true,
        productId: true,
        revenue: true,
      },
      take: 200,
    }),
    db.wishlistOrder.findMany({
      where: { shopId, createdAt: rangeBounds(range) },
      orderBy: { createdAt: "desc" },
      select: { orderId: true, productId: true, createdAt: true },
    }),
  ]);
  const attributedProducts = new Set(
    attributions.map((row) => `${row.orderId}:${row.productId}`),
  );
  const legacyOrders = savedOrders.filter(
    (row) => !attributedProducts.has(`${row.orderId}:${row.productId}`),
  );
  const legacyOrderIds = [...new Set(legacyOrders.map((row) => row.orderId))];
  const orderDetails = new Map<
    string,
    { name: string; customer: string | null; total: number }
  >();
  for (let index = 0; index < legacyOrderIds.length; index += 100) {
    const ids = legacyOrderIds
      .slice(index, index + 100)
      .map((id) =>
        id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`,
      );
    const result = await gqlRequest<{
      nodes: Array<{
        id: string;
        name: string;
        customer: { displayName: string } | null;
        totalPriceSet: { shopMoney: { amount: string } };
      } | null>;
    }>(
      admin,
      `query WishlistOrderDetails($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            customer { displayName }
            totalPriceSet { shopMoney { amount } }
          }
        }
      }`,
      { variables: { ids } },
    ).catch(() => ({ nodes: [] }));
    for (const order of result.nodes) {
      if (!order) continue;
      orderDetails.set(order.id.split("/").pop()!, {
        name: order.name,
        customer: order.customer?.displayName ?? null,
        total: Number(order.totalPriceSet.shopMoney.amount) || 0,
      });
    }
  }
  const [products, customers] = await Promise.all([
    getProductsByIds(
      admin,
      [
        ...new Set([
          ...attributions.map((row) => row.productId),
          ...legacyOrders.map((row) => row.productId),
        ]),
      ],
      1,
    ).catch(() => new Map()),
    getCustomerNamesByIds(admin, [
      ...new Set(
        attributions.flatMap((row) => (row.customerId ? [row.customerId] : [])),
      ),
    ]),
  ]);
  const attributedRows = attributions.map((a) => ({
    orderId: a.orderId,
    orderNumber: a.orderNumber,
    productCount: 1,
    date: a.orderedAt.toISOString().slice(0, 10),
    customer: a.customerId
      ? (customers.get(a.customerId) ?? `Customer ${a.customerId}`)
      : "Guest",
    wishlistedProducts: products.get(a.productId)?.title ?? a.productId,
    value: Number(a.revenue),
  }));
  const legacyByOrder = new Map<
    string,
    { createdAt: Date; productIds: Set<string> }
  >();
  for (const order of legacyOrders) {
    const group = legacyByOrder.get(order.orderId) ?? {
      createdAt: order.createdAt,
      productIds: new Set<string>(),
    };
    if (order.createdAt < group.createdAt) group.createdAt = order.createdAt;
    group.productIds.add(order.productId);
    legacyByOrder.set(order.orderId, group);
  }
  const legacyRows = [...legacyByOrder].map(([orderId, order]) => {
    const details = orderDetails.get(orderId);
    return {
      orderId,
      orderNumber: details?.name ?? orderId,
      productCount: order.productIds.size,
      date: order.createdAt.toISOString().slice(0, 10),
      customer: details?.customer ?? "Not recorded",
      wishlistedProducts: [...order.productIds]
        .map((productId) => products.get(productId)?.title ?? productId)
        .join(", "),
      value: details?.total ?? 0,
    };
  });
  const rows = [...attributedRows, ...legacyRows];
  return {
    summary: {
      orders: new Set(rows.map((row) => row.orderId)).size,
      wishlistedProducts: rows.reduce((sum, row) => sum + row.productCount, 0),
      value: rows.reduce((sum, row) => sum + row.value, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.mixed,
  };
}

async function wishlistToCartData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [events, savedItems] = await Promise.all([
    db.trackingEvent.groupBy({
      by: ["productId", "type"],
      where: {
        shopId,
        type: { in: ["WISHLIST_SAVE", "WISHLIST_ADD_TO_CART"] },
        createdAt: bounds,
        productId: { not: null },
      },
      _count: { _all: true },
    }),
    db.wishlistItem.groupBy({
      by: ["productId"],
      where: { shopId, createdAt: bounds },
      _count: { _all: true },
    }),
  ]);
  const byProduct = new Map<string, { saves: number; addsToCart: number }>();
  for (const event of events) {
    if (!event.productId) continue;
    const group = byProduct.get(event.productId) ?? { saves: 0, addsToCart: 0 };
    if (event.type === "WISHLIST_SAVE") group.saves += event._count._all;
    else group.addsToCart += event._count._all;
    byProduct.set(event.productId, group);
  }
  for (const item of savedItems) {
    const group = byProduct.get(item.productId) ?? { saves: 0, addsToCart: 0 };
    group.saves = Math.max(group.saves, item._count._all);
    byProduct.set(item.productId, group);
  }
  const products = await getProductsByIds(
    admin,
    [...byProduct.keys()],
    1,
  ).catch(() => new Map());
  const rows = [...byProduct.entries()].map(([productId, group]) => ({
    title: products.get(productId)?.title ?? productId,
    saves: group.saves,
    addsToCart: group.addsToCart,
    addToCartRate: rates.saveToCartRate(group.addsToCart, group.saves),
  }));
  rows.sort((left, right) => right.addsToCart - left.addsToCart);
  return {
    summary: {
      saves: rows.reduce((s, r) => s + (r.saves as number), 0),
      addsToCart: rows.reduce((s, r) => s + (r.addsToCart as number), 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function variantDemandData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [events, uniqueRows, savedItems, uniqueShopperRows] = await Promise.all(
    [
      db.trackingEvent.groupBy({
        by: ["productId", "variantId"],
        where: {
          shopId,
          type: "WISHLIST_SAVE",
          createdAt: bounds,
          productId: { not: null },
          variantId: { not: null },
        },
        _count: { _all: true },
      }),
      db.$queryRaw<
        Array<{ productId: string; variantId: string; shoppers: number }>
      >(Prisma.sql`
      SELECT "productId", "variantId", COUNT(DISTINCT "shopperId")::int AS shoppers
      FROM "TrackingEvent"
      WHERE "shopId" = ${shopId} AND "type" = 'WISHLIST_SAVE'
        AND "productId" IS NOT NULL AND "variantId" IS NOT NULL
        AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
      GROUP BY "productId", "variantId"
    `),
      db.wishlistItem.findMany({
        where: {
          shopId,
          createdAt: bounds,
          variantId: { not: null },
        },
        select: {
          productId: true,
          variantId: true,
          shopperId: true,
          customerId: true,
          guestToken: true,
        },
      }),
      db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT shopper)::int AS count
      FROM (
        SELECT COALESCE(NULLIF("shopperId", ''), "customerId") AS shopper
        FROM "TrackingEvent"
        WHERE "shopId" = ${shopId} AND "type" = 'WISHLIST_SAVE'
          AND "productId" IS NOT NULL AND "variantId" IS NOT NULL
          AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
        UNION
        SELECT COALESCE(NULLIF("shopperId", ''), "customerId", "guestToken") AS shopper
        FROM "WishlistItem"
        WHERE "shopId" = ${shopId} AND "variantId" IS NOT NULL
          AND "createdAt" >= ${bounds.gte} AND "createdAt" < ${bounds.lt}
      ) AS shoppers
      WHERE shopper IS NOT NULL
    `),
    ],
  );
  const shoppersByVariant = new Map(
    uniqueRows.map((row) => [
      `${row.productId}:${row.variantId}`,
      row.shoppers,
    ]),
  );
  const savedByVariant = new Map<
    string,
    { saves: number; shoppers: Set<string> }
  >();
  for (const item of savedItems) {
    if (!item.variantId) continue;
    const key = `${item.productId}:${item.variantId}`;
    const group = savedByVariant.get(key) ?? { saves: 0, shoppers: new Set() };
    group.saves++;
    const shopper = item.shopperId ?? item.customerId ?? item.guestToken;
    if (shopper) group.shoppers.add(shopper);
    savedByVariant.set(key, group);
  }
  const eventByVariant = new Map(
    events.map((event) => [
      `${event.productId}:${event.variantId}`,
      event._count._all,
    ]),
  );
  const variantKeys = new Set([
    ...eventByVariant.keys(),
    ...savedByVariant.keys(),
  ]);
  const products = await getProductsByIds(admin, [
    ...new Set([...variantKeys].map((key) => key.slice(0, key.indexOf(":")))),
  ]).catch(() => new Map<string, ProductSummary>());
  const rows = [...variantKeys].map((key) => {
    const separator = key.indexOf(":");
    const productId = key.slice(0, separator);
    const variantId = key.slice(separator + 1);
    const saved = savedByVariant.get(key);
    const variantTitle = products
      .get(productId)
      ?.variants.find((variant) => variant.variantId === variantId)?.title;
    return {
      productId,
      title: products.get(productId)?.title ?? productId,
      variantTitle: variantTitle ?? variantId,
      variantId,
      saves: Math.max(eventByVariant.get(key) ?? 0, saved?.saves ?? 0),
      uniqueShoppers: Math.max(
        shoppersByVariant.get(key) ?? 0,
        saved?.shoppers.size ?? 0,
      ),
    };
  });
  return {
    summary: {
      variantCount: variantKeys.size,
      saves: rows.reduce((sum, row) => sum + row.saves, 0),
      uniqueShoppers: uniqueShopperRows[0]?.count ?? 0,
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function saveSourcesData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const events = await db.trackingEvent.groupBy({
    by: ["source", "device", "customerId"],
    where: {
      shopId,
      type: "WISHLIST_SAVE",
      createdAt: rangeBounds(range),
    },
    _count: { _all: true },
  });
  const rows = events.map((e) => ({
    source: e.source ?? "unknown",
    device: e.device ?? "unknown",
    customerType: e.customerId ? "customer" : "guest",
    saves: e._count._all,
  }));
  return {
    summary: { saves: rows.reduce((s, r) => s + (r.saves as number), 0) },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function reminderPerformanceData(
  shopId: string,
  range: DateRange,
  params: AnalyticsParams,
): Promise<ReportData> {
  const logs = await db.notificationLog.findMany({
    where: {
      shopId,
      kind: { in: ["WISHLIST_REMINDER", "PRICE_DROP"] },
      sentAt: rangeBounds(range),
    },
    select: {
      id: true,
      kind: true,
      channel: true,
      openedAt: true,
      clickedAt: true,
    },
  });
  const conversions = logs.length
    ? await db.attribution.findMany({
        where: {
          shopId,
          source: "WISHLIST",
          model: "last_click",
          notificationLogId: { in: logs.map((log) => log.id) },
          orderedAt: rangeBounds(range),
        },
        select: { notificationLogId: true, lineItemId: true },
      })
    : [];
  const convertedByLog = new Map<string, Set<string>>();
  for (const conversion of conversions) {
    if (!conversion.notificationLogId) continue;
    const lineItems =
      convertedByLog.get(conversion.notificationLogId) ?? new Set<string>();
    lineItems.add(conversion.lineItemId);
    convertedByLog.set(conversion.notificationLogId, lineItems);
  }
  const byKindAndChannel = new Map<
    string,
    {
      kind: string;
      channel: string;
      sent: number;
      opened: number;
      clicked: number;
      converted: number;
    }
  >();
  for (const log of logs) {
    const key = `${log.kind}:${log.channel}`;
    const group = byKindAndChannel.get(key) ?? {
      kind: log.kind,
      channel: log.channel,
      sent: 0,
      opened: 0,
      clicked: 0,
      converted: 0,
    };
    group.sent += 1;
    if (log.openedAt) group.opened += 1;
    if (log.clickedAt) group.clicked += 1;
    group.converted += convertedByLog.get(log.id)?.size ?? 0;
    byKindAndChannel.set(key, group);
  }
  const rows = [...byKindAndChannel.values()].map((group) => ({
    kind: group.kind,
    channel: group.channel,
    sent: group.sent,
    opened: group.opened,
    clicked: group.clicked,
    converted: group.converted,
    conversionRate: rates.clickToPurchase(group.converted, group.clicked),
  }));
  const summaryRows = params.channel
    ? rows.filter(
        (row) => row.channel.toLowerCase() === params.channel!.toLowerCase(),
      )
    : rows;
  return {
    summary: {
      sent: summaryRows.reduce((sum, row) => sum + row.sent, 0),
      opened: summaryRows.reduce((sum, row) => sum + row.opened, 0),
      clicked: summaryRows.reduce((sum, row) => sum + row.clicked, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function guestToCustomerData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [eventWeeks, itemWeeks] = await Promise.all([
    db.$queryRaw<
      Array<{ week: string; guestSaves: number; mergedToCustomer: number }>
    >(Prisma.sql`
      SELECT
        date_trunc('week', "createdAt")::date::text AS "week",
        COUNT(DISTINCT "shopperId") FILTER (
          WHERE "shopperId" <> COALESCE("customerId", '')
        )::int AS "guestSaves",
        COUNT(DISTINCT "shopperId") FILTER (
          WHERE "customerId" IS NOT NULL AND "shopperId" <> "customerId"
        )::int AS "mergedToCustomer"
      FROM "TrackingEvent"
      WHERE "shopId" = ${shopId}
        AND "type" = 'WISHLIST_SAVE'
        AND "createdAt" >= ${bounds.gte}
        AND "createdAt" < ${bounds.lt}
      GROUP BY 1
    `),
    db.$queryRaw<
      Array<{ week: string; guestSaves: number; mergedToCustomer: number }>
    >(Prisma.sql`
      SELECT
        date_trunc('week', "createdAt")::date::text AS "week",
        COUNT(DISTINCT COALESCE(NULLIF("shopperId", ''), "guestToken"))
          FILTER (WHERE "customerId" IS NULL)::int AS "guestSaves",
        0::int AS "mergedToCustomer"
      FROM "WishlistItem"
      WHERE "shopId" = ${shopId}
        AND "createdAt" >= ${bounds.gte}
        AND "createdAt" < ${bounds.lt}
      GROUP BY 1
    `),
  ]);
  const weeklyByDate = new Map<
    string,
    { guestSaves: number; mergedToCustomer: number }
  >();
  for (const row of eventWeeks) {
    weeklyByDate.set(row.week, { ...row });
  }
  for (const row of itemWeeks) {
    const group = weeklyByDate.get(row.week) ?? {
      guestSaves: 0,
      mergedToCustomer: 0,
    };
    group.guestSaves = Math.max(group.guestSaves, row.guestSaves);
    group.mergedToCustomer = Math.max(
      group.mergedToCustomer,
      row.mergedToCustomer,
    );
    weeklyByDate.set(row.week, group);
  }
  const weekly = [...weeklyByDate]
    .map(([week, values]) => ({ week, ...values }))
    .sort((left, right) => right.week.localeCompare(left.week));
  const rows = weekly.map((row) => ({
    week: `Week of ${row.week}`,
    guestSaves: row.guestSaves,
    mergedToCustomer: row.mergedToCustomer,
    mergeRate: rates.wishlistShopperRate(row.mergedToCustomer, row.guestSaves),
  }));
  const guestSaves = rows.reduce((sum, row) => sum + row.guestSaves, 0);
  const mergedToCustomer = rows.reduce(
    (sum, row) => sum + row.mergedToCustomer,
    0,
  );
  return {
    summary: {
      guestSaves,
      mergedToCustomer,
      mergeRate: rates.wishlistShopperRate(mergedToCustomer, guestSaves),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

/* Back in Stock — Phase 2 */

type CurrentInventoryRow = {
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  quantity: number;
  status: string;
};

async function currentInventoryRows(
  shopId: string,
  admin: GraphqlClient,
): Promise<CurrentInventoryRow[]> {
  const settings = await getShopSettings(shopId);
  try {
    const variants = await loadInventoryVariants(admin);
    return variants.map((variant) => ({
      productId: variant.productId,
      variantId: variant.variantId,
      title: variant.productTitle,
      variantTitle: variant.variantTitle,
      quantity: variant.inventory,
      status:
        variant.inventory <= 0
          ? "out_of_stock"
          : variant.inventory <= settings.lowStockThreshold
            ? "low_stock"
            : "in_stock",
    }));
  } catch (error) {
    console.warn("Live inventory lookup failed; using cached inventory", error);
    const cached = await db.inventoryCache.findMany({
      where: { shopId },
      select: {
        productId: true,
        variantId: true,
        quantity: true,
        status: true,
      },
    });
    const products = await getProductsByIds(
      admin,
      [...new Set(cached.map((item) => item.productId))],
      1,
    ).catch(() => new Map<string, ProductSummary>());
    return cached.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      title: products.get(item.productId)?.title ?? item.productId,
      variantTitle:
        products
          .get(item.productId)
          ?.variants.find((variant) => variant.variantId === item.variantId)
          ?.title ?? item.variantId,
      quantity: item.quantity,
      status: item.status,
    }));
  }
}

async function stockListData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const [inventory, waitingRows] = await Promise.all([
    currentInventoryRows(shopId, admin),
    db.stockAlert.groupBy({
      by: ["productId", "variantId"],
      where: { shopId, status: { in: ["PENDING", "SENDING"] } },
      _count: { _all: true },
    }),
  ]);
  const waitingByVariant = new Map(
    waitingRows.map((row) => [
      `${row.productId}:${row.variantId}`,
      row._count._all,
    ]),
  );
  const rows = inventory.map((item) => ({
    title: item.title,
    variantId: item.variantId,
    quantity: item.quantity,
    status: item.status,
    variantTitle: item.variantTitle,
    waitingSubscribers:
      waitingByVariant.get(`${item.productId}:${item.variantId}`) ?? 0,
  }));
  return {
    summary: {
      products: rows.length,
      outOfStockVariants: rows.filter((row) => row.status === "out_of_stock")
        .length,
      waitingSubscribers: rows.reduce(
        (sum, row) => sum + row.waitingSubscribers,
        0,
      ),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function lowStockDemandData(
  shopId: string,
  admin: GraphqlClient,
): Promise<ReportData> {
  const settings = await getShopSettings(shopId);
  const [allInventory, waitingRows] = await Promise.all([
    currentInventoryRows(shopId, admin),
    db.stockAlert.groupBy({
      by: ["productId", "variantId"],
      where: { shopId, status: { in: ["PENDING", "SENDING"] } },
      _count: { _all: true },
    }),
  ]);
  const waitingByVariant = new Map(
    waitingRows.map((row) => [
      `${row.productId}:${row.variantId}`,
      row._count._all,
    ]),
  );
  const rows = allInventory
    .filter(
      (item) =>
        item.quantity <= settings.lowStockThreshold ||
        item.status === "out_of_stock",
    )
    .map((item) => {
      const waiting =
        waitingByVariant.get(`${item.productId}:${item.variantId}`) ?? 0;
      const quantity = Math.max(0, item.quantity);
      return {
        title: item.title,
        variantTitle:
          item.variantTitle === "Default Title" ? "Default" : item.variantTitle,
        variantId: item.variantId,
        quantity,
        status: item.status,
        waiting,
        gap: rates.demandGap(waiting, quantity),
      };
    })
    .filter((row) => row.waiting > 0)
    .sort(
      (left, right) => right.gap - left.gap || right.waiting - left.waiting,
    );
  return {
    summary: {
      variants: rows.length,
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      waiting: rows.reduce((sum, row) => sum + row.waiting, 0),
      demandGap: rows.reduce((sum, row) => sum + row.gap, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function alertPurchasesData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [attributions, alertPurchases] = await Promise.all([
    db.attribution.findMany({
      where: {
        shopId,
        source: "RESTOCK_ALERT",
        model: "last_click",
        orderedAt: bounds,
      },
      orderBy: { orderedAt: "desc" },
      select: {
        orderId: true,
        orderNumber: true,
        orderedAt: true,
        customerId: true,
        productId: true,
        variantId: true,
        revenue: true,
        notificationLogId: true,
      },
      take: 500,
    }),
    db.stockAlert.findMany({
      where: {
        shopId,
        purchasedAt: bounds,
        purchaseOrderId: { not: null },
      },
      orderBy: { purchasedAt: "desc" },
      select: {
        id: true,
        purchaseOrderId: true,
        productId: true,
        variantId: true,
        customerId: true,
        email: true,
        productTitle: true,
        purchaseRevenue: true,
        purchasedAt: true,
      },
      take: 500,
    }),
  ]);
  const customerIds = [
    ...attributions.flatMap((row) => (row.customerId ? [row.customerId] : [])),
    ...alertPurchases.flatMap((row) =>
      row.customerId ? [row.customerId] : [],
    ),
  ];
  const productIds = [
    ...attributions.map((row) => row.productId),
    ...alertPurchases.map((row) => row.productId),
  ];
  const [products, customers] = await Promise.all([
    getProductsByIds(admin, [...new Set(productIds)], 1).catch(
      () => new Map<string, ProductSummary>(),
    ),
    getCustomerNamesByIds(admin, [...new Set(customerIds)]),
  ]);
  const rowsByOrderProduct = new Map<string, ReportRow>();
  for (const attribution of attributions) {
    const key = `${attribution.orderId}:${attribution.productId}:${attribution.variantId ?? ""}`;
    rowsByOrderProduct.set(key, {
      orderNumber: attribution.orderNumber,
      date: attribution.orderedAt.toISOString().slice(0, 10),
      customer: attribution.customerId
        ? (customers.get(attribution.customerId) ??
          `Customer ${attribution.customerId}`)
        : "Guest",
      title:
        products.get(attribution.productId)?.title ?? attribution.productId,
      value: Number(attribution.revenue),
      alertId: attribution.notificationLogId ?? "",
      alertCause: "Restock notification click",
      revenueType: "Direct",
    });
  }
  for (const purchase of alertPurchases) {
    if (!purchase.purchaseOrderId || !purchase.purchasedAt) continue;
    const key = `${purchase.purchaseOrderId}:${purchase.productId}:${purchase.variantId}`;
    rowsByOrderProduct.set(key, {
      orderNumber: `#${purchase.purchaseOrderId}`,
      date: purchase.purchasedAt.toISOString().slice(0, 10),
      customer: purchase.customerId
        ? (customers.get(purchase.customerId) ??
          `Customer ${purchase.customerId}`)
        : (purchase.email ?? "Guest"),
      title:
        purchase.productTitle ??
        products.get(purchase.productId)?.title ??
        purchase.productId,
      value: Number(purchase.purchaseRevenue ?? 0),
      alertId: purchase.id,
      alertCause: "Back-in-stock alert",
      revenueType: "Estimated",
    });
  }
  const rows = [...rowsByOrderProduct.values()].sort((left, right) =>
    String(right.date).localeCompare(String(left.date)),
  );
  return {
    summary: {
      purchases: rows.length,
      value: rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.mixed,
  };
}

async function timeToNotifyData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const logs = await db.notificationLog.findMany({
    where: {
      shopId,
      kind: "RESTOCK",
      restockedAt: { not: null },
      sentAt: { ...rangeBounds(range), not: null },
    },
    select: { id: true, productId: true, restockedAt: true, sentAt: true },
  });
  const purchases = logs.length
    ? await db.attribution.findMany({
        where: {
          shopId,
          source: "RESTOCK_ALERT",
          model: "last_click",
          notificationLogId: { in: logs.map((log) => log.id) },
          orderedAt: rangeBounds(range),
        },
        select: { notificationLogId: true, orderedAt: true },
      })
    : [];
  const purchaseTimes = new Map<string, number[]>();
  for (const purchase of purchases) {
    if (!purchase.notificationLogId) continue;
    const times = purchaseTimes.get(purchase.notificationLogId) ?? [];
    times.push(purchase.orderedAt.getTime());
    purchaseTimes.set(purchase.notificationLogId, times);
  }
  const byProduct = new Map<
    string,
    { restockToSent: number[]; sentToPurchase: number[] }
  >();
  for (const log of logs) {
    if (!log.restockedAt || !log.sentAt) continue;
    const group = byProduct.get(log.productId) ?? {
      restockToSent: [],
      sentToPurchase: [],
    };
    const minutes = (log.sentAt.getTime() - log.restockedAt.getTime()) / 60000;
    group.restockToSent.push(minutes);
    for (const orderedAt of purchaseTimes.get(log.id) ?? []) {
      group.sentToPurchase.push((orderedAt - log.sentAt.getTime()) / 60000);
    }
    byProduct.set(log.productId, group);
  }
  const products = await getProductsByIds(
    admin,
    [...byProduct.keys()],
    1,
  ).catch(() => new Map());
  const rows = [...byProduct.entries()].map(([productId, group]) => ({
    title: products.get(productId)?.title ?? productId,
    avgMinutesRestockToSent: group.restockToSent.length
      ? group.restockToSent.reduce((a, b) => a + b, 0) /
        group.restockToSent.length
      : 0,
    avgMinutesSentToPurchase: safeRate(
      group.sentToPurchase.reduce((sum, value) => sum + value, 0),
      group.sentToPurchase.length,
    ),
  }));
  return {
    summary: { products: rows.length },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function lostSalesData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [cache, subscriptions] = await Promise.all([
    db.inventoryCache.findMany({
      where: { shopId, status: "out_of_stock" },
      select: { productId: true, variantId: true, price: true },
    }),
    db.$queryRaw<
      Array<{
        productId: string;
        variantId: string;
        title: string | null;
        waiting: number;
      }>
    >(Prisma.sql`
      SELECT "productId", "variantId",
        MAX("productTitle") AS "title",
        COUNT(*)::int AS "waiting"
      FROM "StockAlert"
      WHERE "shopId" = ${shopId}
        AND "status" = 'PENDING'
        AND "createdAt" >= ${bounds.gte}
        AND "createdAt" < ${bounds.lt}
      GROUP BY "productId", "variantId"
    `),
  ]);
  const waitingByVariant = new Map(
    subscriptions.map((subscription) => [
      `${subscription.productId}:${subscription.variantId}`,
      subscription,
    ]),
  );
  const rows = cache.flatMap((variant) => {
    const waiting = waitingByVariant.get(
      `${variant.productId}:${variant.variantId}`,
    );
    if (!waiting) return [];
    const price = Number(variant.price ?? 0);
    return [
      {
        title: waiting.title ?? variant.productId,
        variantId: variant.variantId,
        waitingSubscribers: waiting.waiting,
        price,
        missedRevenue: waiting.waiting * price,
      },
    ];
  });
  return {
    summary: {
      variants: rows.length,
      waitingSubscribers: rows.reduce(
        (sum, row) => sum + row.waitingSubscribers,
        0,
      ),
      missedRevenue: rows.reduce((sum, row) => sum + row.missedRevenue, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.estimated,
  };
}

/* Back in Stock — Phase 3 */

async function sellThroughData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [restocks, pendingAlerts] = await Promise.all([
    db.inventoryCache.findMany({
      where: {
        shopId,
        lastRestockedAt: bounds,
        lastOutOfStockAt: { ...bounds, not: null },
      },
      select: {
        productId: true,
        variantId: true,
        lastRestockedAt: true,
        lastOutOfStockAt: true,
      },
    }),
    db.stockAlert.groupBy({
      by: ["productId", "variantId"],
      where: { shopId, status: "PENDING" },
      _count: { _all: true },
    }),
  ]);
  const waitingByVariant = new Map(
    pendingAlerts.map((alert) => [
      `${alert.productId}:${alert.variantId}`,
      alert._count._all,
    ]),
  );
  const products = await getProductsByIds(
    admin,
    [...new Set(restocks.map((restock) => restock.productId))],
    1,
  ).catch(() => new Map());
  const rows = restocks.flatMap((restock) => {
    if (!restock.lastRestockedAt || !restock.lastOutOfStockAt) return [];
    const hours =
      (restock.lastOutOfStockAt.getTime() - restock.lastRestockedAt.getTime()) /
      3600000;
    if (hours < 0) return [];
    return [
      {
        title: products.get(restock.productId)?.title ?? restock.productId,
        variantId: restock.variantId,
        restockedAt: restock.lastRestockedAt.toISOString(),
        hoursToSellOut: hours,
        missedBySubscribers:
          waitingByVariant.get(`${restock.productId}:${restock.variantId}`) ??
          0,
      },
    ];
  });
  return {
    summary: {
      restocks: rows.length,
      averageHoursToSellOut: safeRate(
        rows.reduce((sum, row) => sum + row.hoursToSellOut, 0),
        rows.length,
      ),
      missedBySubscribers: rows.reduce(
        (sum, row) => sum + row.missedBySubscribers,
        0,
      ),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function subscriptionSourcesData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const alerts = await db.stockAlert.findMany({
    where: { shopId, createdAt: rangeBounds(range) },
    select: { source: true, device: true, confirmed: true },
  });
  const bySource = new Map<string, { signups: number; confirmed: number }>();
  for (const alert of alerts) {
    const source = alert.source ?? "unknown";
    const key = `${source}:${alert.device ?? "unknown"}`;
    const group = bySource.get(key) ?? { signups: 0, confirmed: 0 };
    group.signups++;
    if (alert.confirmed) group.confirmed++;
    bySource.set(key, group);
  }
  const rows = [...bySource].map(([key, group]) => {
    const [source, device] = key.split(":");
    return {
      source,
      page: source,
      device,
      signups: group.signups,
      confirmedRate: safeRate(group.confirmed, group.signups),
    };
  });
  return {
    summary: { signups: rows.reduce((s, r) => s + (r.signups as number), 0) },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

/* Customer — Phase 2 & 3 */

async function recurringCustomersData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [saves, subscriptions, clicks, trackingClicks, orders, savedOrders] =
    await Promise.all([
      db.wishlistItem.groupBy({
        by: ["customerId"],
        where: {
          shopId,
          customerId: { not: null },
          createdAt: bounds,
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      db.stockAlert.groupBy({
        by: ["customerId"],
        where: {
          shopId,
          customerId: { not: null },
          createdAt: bounds,
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      db.notificationLog.findMany({
        where: { shopId, clickedAt: bounds },
        select: {
          shopperId: true,
          subscriptionId: true,
          wishlistItemId: true,
          clickedAt: true,
        },
      }),
      db.trackingEvent.groupBy({
        by: ["customerId", "shopperId"],
        where: { shopId, type: "NOTIFICATION_CLICK", createdAt: bounds },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      db.attribution.findMany({
        where: {
          shopId,
          model: "last_click",
          orderedAt: bounds,
          customerId: { not: null },
        },
        select: {
          customerId: true,
          orderId: true,
          revenue: true,
          orderedAt: true,
        },
      }),
      db.wishlistOrder.findMany({
        where: { shopId, createdAt: bounds },
        select: { orderId: true, createdAt: true },
      }),
    ]);
  const [clickedAlerts, clickedWishlistItems] = await Promise.all([
    db.stockAlert.findMany({
      where: {
        shopId,
        id: {
          in: [
            ...new Set(
              clicks.flatMap((click) =>
                click.subscriptionId ? [click.subscriptionId] : [],
              ),
            ),
          ],
        },
      },
      select: { id: true, customerId: true },
    }),
    db.wishlistItem.findMany({
      where: {
        shopId,
        id: {
          in: [
            ...new Set(
              clicks.flatMap((click) =>
                click.wishlistItemId ? [click.wishlistItemId] : [],
              ),
            ),
          ],
        },
      },
      select: { id: true, customerId: true },
    }),
  ]);
  const customerBySubscription = new Map(
    clickedAlerts.flatMap((alert) =>
      alert.customerId ? [[alert.id, alert.customerId] as const] : [],
    ),
  );
  const customerByWishlistItem = new Map(
    clickedWishlistItems.flatMap((item) =>
      item.customerId ? [[item.id, item.customerId] as const] : [],
    ),
  );
  type CustomerActivity = {
    customerId: string;
    saves: number;
    subscriptions: number;
    clicks: number;
    orders: number;
    spend: number;
    lastActivity: Date | null;
  };
  const activity = new Map<string, CustomerActivity>();
  const getActivity = (customerId: string) => {
    const existing = activity.get(customerId);
    if (existing) return existing;
    const created: CustomerActivity = {
      customerId,
      saves: 0,
      subscriptions: 0,
      clicks: 0,
      orders: 0,
      spend: 0,
      lastActivity: null,
    };
    activity.set(customerId, created);
    return created;
  };
  const setLastActivity = (
    row: CustomerActivity,
    date: Date | null | undefined,
  ) => {
    if (date && (!row.lastActivity || date > row.lastActivity)) {
      row.lastActivity = date;
    }
  };
  for (const save of saves) {
    if (!save.customerId) continue;
    const row = getActivity(save.customerId);
    row.saves = save._count._all;
    setLastActivity(row, save._max.createdAt);
  }
  for (const subscription of subscriptions) {
    if (!subscription.customerId) continue;
    const row = getActivity(subscription.customerId);
    row.subscriptions = subscription._count._all;
    setLastActivity(row, subscription._max.createdAt);
  }
  for (const click of clicks) {
    const customerId =
      (click.subscriptionId &&
        customerBySubscription.get(click.subscriptionId)) ||
      (click.wishlistItemId &&
        customerByWishlistItem.get(click.wishlistItemId)) ||
      (/^\d+$/.test(click.shopperId) ? click.shopperId : null);
    if (!customerId || !click.clickedAt) continue;
    const row = getActivity(customerId);
    row.clicks++;
    setLastActivity(row, click.clickedAt);
  }
  const trackingClicksByCustomer = new Map<
    string,
    { count: number; lastActivity: Date | null }
  >();
  for (const click of trackingClicks) {
    const customerId =
      click.customerId ??
      (/^\d+$/.test(click.shopperId) ? click.shopperId : null);
    if (!customerId) continue;
    const current = trackingClicksByCustomer.get(customerId) ?? {
      count: 0,
      lastActivity: null,
    };
    current.count += click._count._all;
    if (
      click._max.createdAt &&
      (!current.lastActivity || click._max.createdAt > current.lastActivity)
    ) {
      current.lastActivity = click._max.createdAt;
    }
    trackingClicksByCustomer.set(customerId, current);
  }
  for (const [customerId, clickData] of trackingClicksByCustomer) {
    const row = getActivity(customerId);
    row.clicks = Math.max(row.clicks, clickData.count);
    setLastActivity(row, clickData.lastActivity);
  }
  const orderIdsByCustomer = new Map<string, Set<string>>();
  const attributedOrderKeys = new Set<string>();
  for (const order of orders) {
    if (!order.customerId) continue;
    const row = getActivity(order.customerId);
    const orderIds =
      orderIdsByCustomer.get(order.customerId) ?? new Set<string>();
    orderIds.add(order.orderId);
    orderIdsByCustomer.set(order.customerId, orderIds);
    attributedOrderKeys.add(`${order.customerId}:${order.orderId}`);
    row.spend += Number(order.revenue);
    setLastActivity(row, order.orderedAt);
  }
  const shopifyOrderDetails = await loadShopifyOrderDetails(
    admin,
    savedOrders.map((order) => order.orderId),
  );
  const fallbackSpendKeys = new Set<string>();
  for (const savedOrder of savedOrders) {
    const orderId = savedOrder.orderId.split("/").pop()!;
    const orderDetails = shopifyOrderDetails.get(orderId);
    const customerId = orderDetails?.customerId;
    if (!customerId) continue;
    const row = getActivity(customerId);
    const orderIds = orderIdsByCustomer.get(customerId) ?? new Set<string>();
    orderIds.add(orderId);
    orderIdsByCustomer.set(customerId, orderIds);
    const orderKey = `${customerId}:${orderId}`;
    if (
      !attributedOrderKeys.has(orderKey) &&
      !fallbackSpendKeys.has(orderKey)
    ) {
      row.spend += orderDetails.total;
      fallbackSpendKeys.add(orderKey);
    }
    setLastActivity(row, savedOrder.createdAt);
  }
  for (const [customerId, orderIds] of orderIdsByCustomer) {
    getActivity(customerId).orders = orderIds.size;
  }
  const activeCustomers = [...activity.values()]
    .filter(
      (row) => row.saves + row.subscriptions + row.clicks + row.orders >= 3,
    )
    .sort(
      (left, right) =>
        right.saves +
          right.subscriptions +
          right.clicks +
          right.orders -
          (left.saves + left.subscriptions + left.clicks + left.orders) ||
        right.spend - left.spend,
    );
  const names = await getCustomerNamesByIds(
    admin,
    activeCustomers.slice(0, 250).map((row) => row.customerId),
  );
  const rows = activeCustomers.map((row) => ({
    customerId: row.customerId,
    customer: names.get(row.customerId) ?? `Customer ${row.customerId}`,
    customerType: row.orders > 1 ? "Repeat" : "Engaged",
    saves: row.saves,
    subscriptions: row.subscriptions,
    clicks: row.clicks,
    orders: row.orders,
    spend: row.spend,
    lastActivity: row.lastActivity?.toISOString() ?? "",
  }));
  return {
    summary: {
      customers: rows.length,
      saves: rows.reduce((sum, row) => sum + row.saves, 0),
      subscriptions: rows.reduce((sum, row) => sum + row.subscriptions, 0),
      clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      orders: rows.reduce((sum, row) => sum + row.orders, 0),
      actions: rows.reduce(
        (sum, row) =>
          sum + row.saves + row.subscriptions + row.clicks + row.orders,
        0,
      ),
      spend: rows.reduce((sum, row) => sum + row.spend, 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.mixed,
  };
}

async function topIntentCustomersData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [wishlistItems, alerts, clicks, attributions] = await Promise.all([
    db.wishlistItem.findMany({
      where: { shopId, createdAt: bounds },
      select: {
        customerId: true,
        shopperId: true,
        guestToken: true,
        createdAt: true,
      },
    }),
    db.stockAlert.findMany({
      where: { shopId, createdAt: bounds },
      select: {
        customerId: true,
        shopperId: true,
        contactKey: true,
        createdAt: true,
      },
    }),
    db.notificationLog.groupBy({
      by: ["shopperId"],
      where: { shopId, clickedAt: bounds },
      _count: { _all: true },
      _max: { clickedAt: true },
    }),
    db.attribution.findMany({
      where: { shopId, model: "last_click", orderedAt: bounds },
      select: {
        customerId: true,
        shopperId: true,
        orderId: true,
        orderedAt: true,
      },
    }),
  ]);
  const identityOf = (
    customerId: string | null,
    shopperId: string | null,
    fallback?: string | null,
  ) => {
    if (customerId) return `customer:${customerId}`;
    const id = shopperId ?? fallback;
    if (!id) return null;
    return /^\d+$/.test(id) ? `customer:${id}` : `guest:${id}`;
  };
  const activity = new Map<
    string,
    {
      customerId: string | null;
      saves: number;
      subscriptions: number;
      clicks: number;
      orders: Set<string>;
      lastActivity: Date | null;
    }
  >();
  const getShopper = (identity: string, customerId: string | null) => {
    const shopper = activity.get(identity) ?? {
      customerId,
      saves: 0,
      subscriptions: 0,
      clicks: 0,
      orders: new Set<string>(),
      lastActivity: null,
    };
    if (customerId) shopper.customerId = customerId;
    activity.set(identity, shopper);
    return shopper;
  };
  const addActivity = (
    shopper: ReturnType<typeof getShopper>,
    date: Date | null,
  ) => {
    if (date && (!shopper.lastActivity || date > shopper.lastActivity)) {
      shopper.lastActivity = date;
    }
  };
  for (const item of wishlistItems) {
    const identity = identityOf(
      item.customerId,
      item.shopperId,
      item.guestToken,
    );
    if (!identity) continue;
    const shopper = getShopper(identity, item.customerId);
    shopper.saves++;
    addActivity(shopper, item.createdAt);
  }
  for (const alert of alerts) {
    const identity = identityOf(
      alert.customerId,
      alert.shopperId,
      alert.contactKey,
    );
    if (!identity) continue;
    const shopper = getShopper(identity, alert.customerId);
    shopper.subscriptions++;
    addActivity(shopper, alert.createdAt);
  }
  for (const click of clicks) {
    const identity = identityOf(null, click.shopperId);
    if (!identity) continue;
    const shopper = getShopper(identity, null);
    shopper.clicks += click._count._all;
    addActivity(shopper, click._max.clickedAt);
  }
  for (const attribution of attributions) {
    const identity = identityOf(attribution.customerId, attribution.shopperId);
    if (!identity) continue;
    const shopper = getShopper(identity, attribution.customerId);
    shopper.orders.add(attribution.orderId);
    addActivity(shopper, attribution.orderedAt);
  }
  const customerIds = [
    ...new Set(
      [...activity.values()].flatMap((shopper) =>
        shopper.customerId ? [shopper.customerId] : [],
      ),
    ),
  ];
  const customerNames = await getCustomerNamesByIds(admin, customerIds);
  const rows = [...activity.entries()]
    .filter(([, shopper]) => shopper.saves > 0)
    .map(([identity, shopper], index) => ({
      customer: shopper.customerId
        ? (customerNames.get(shopper.customerId) ??
          `Customer ${shopper.customerId}`)
        : `Guest shopper ${index + 1}`,
      saves: shopper.saves,
      subscriptions: shopper.subscriptions,
      intentScore: shopper.saves + shopper.subscriptions + shopper.clicks,
      lastActivity: shopper.lastActivity?.toISOString() ?? "",
    }))
    .filter((row) => row.intentScore > 0)
    .sort(
      (left, right) =>
        right.intentScore - left.intentScore || right.saves - left.saves,
    );
  return {
    summary: {
      customers: rows.length,
      saves: rows.reduce((sum, row) => sum + Number(row.saves), 0),
      subscriptions: rows.reduce(
        (sum, row) => sum + Number(row.subscriptions),
        0,
      ),
      intentScore: rows.reduce((sum, row) => sum + Number(row.intentScore), 0),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.mixed,
  };
}

async function segmentsData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  const [wishlistItems, alerts, clicks, attributions] = await Promise.all([
    db.wishlistItem.findMany({
      where: { shopId, createdAt: bounds },
      select: { customerId: true, shopperId: true, guestToken: true },
    }),
    db.stockAlert.findMany({
      where: { shopId, createdAt: bounds },
      select: { customerId: true, shopperId: true, contactKey: true },
    }),
    db.notificationLog.groupBy({
      by: ["shopperId"],
      where: { shopId, clickedAt: bounds },
      _count: { _all: true },
    }),
    db.attribution.findMany({
      where: { shopId, model: "last_click", orderedAt: bounds },
      select: {
        source: true,
        customerId: true,
        shopperId: true,
        orderId: true,
      },
    }),
  ]);
  const identityOf = (
    customerId: string | null,
    shopperId: string | null,
    fallback?: string | null,
  ) => {
    if (customerId) return `customer:${customerId}`;
    const identity = shopperId ?? fallback;
    if (!identity) return null;
    return /^\d+$/.test(identity)
      ? `customer:${identity}`
      : `shopper:${identity}`;
  };
  const shoppers = new Map<
    string,
    {
      wishlistSaves: number;
      subscriptions: number;
      clicks: number;
      wishlistPurchase: boolean;
      restockPurchase: boolean;
      purchaseOrders: Set<string>;
    }
  >();
  const shopperFor = (identity: string) => {
    const existing = shoppers.get(identity);
    if (existing) return existing;
    const created = {
      wishlistSaves: 0,
      subscriptions: 0,
      clicks: 0,
      wishlistPurchase: false,
      restockPurchase: false,
      purchaseOrders: new Set<string>(),
    };
    shoppers.set(identity, created);
    return created;
  };
  for (const item of wishlistItems) {
    const identity = identityOf(
      item.customerId,
      item.shopperId,
      item.guestToken,
    );
    if (identity) shopperFor(identity).wishlistSaves++;
  }
  for (const alert of alerts) {
    const identity = identityOf(
      alert.customerId,
      alert.shopperId,
      alert.contactKey,
    );
    if (identity) shopperFor(identity).subscriptions++;
  }
  for (const click of clicks) {
    const identity = identityOf(null, click.shopperId);
    if (identity) shopperFor(identity).clicks += click._count._all;
  }
  for (const attribution of attributions) {
    const identity = identityOf(attribution.customerId, attribution.shopperId);
    if (!identity) continue;
    const shopper = shopperFor(identity);
    shopper.purchaseOrders.add(attribution.orderId);
    if (attribution.source === "WISHLIST") shopper.wishlistPurchase = true;
    if (attribution.source === "RESTOCK_ALERT") shopper.restockPurchase = true;
  }
  const rows = [
    {
      segment: "Subscribed, no purchase",
      customerCount: [...shoppers.values()].filter(
        (shopper) => shopper.subscriptions > 0 && !shopper.restockPurchase,
      ).length,
      lastSynced: new Date().toISOString().slice(0, 10),
      status: "Live",
    },
    {
      segment: "Wishlist, no purchase",
      customerCount: [...shoppers.values()].filter(
        (shopper) => shopper.wishlistSaves > 0 && !shopper.wishlistPurchase,
      ).length,
      lastSynced: new Date().toISOString().slice(0, 10),
      status: "Live",
    },
    {
      segment: "High intent (3+ actions)",
      customerCount: [...shoppers.values()].filter(
        (shopper) =>
          shopper.wishlistSaves + shopper.subscriptions + shopper.clicks >= 3 &&
          shopper.purchaseOrders.size === 0,
      ).length,
      lastSynced: new Date().toISOString().slice(0, 10),
      status: "Live",
    },
  ];
  return {
    summary: { customers: shoppers.size, customerCount: shoppers.size },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

/* Operations — Phase 3 */

async function notificationLogData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  logLimit: number | null,
): Promise<ReportData> {
  const bounds = rangeBounds(range);
  // Fetch enough rows to merge NotificationLog + StockAlert fallbacks, then apply the plan cap.
  const fetchTake = logLimit == null ? 5000 : Math.max(logLimit * 3, logLimit);
  const [logs, sentAlerts] = await Promise.all([
    db.notificationLog.findMany({
      where: {
        shopId,
        channel: "EMAIL",
        OR: [{ sentAt: bounds }, { createdAt: bounds }],
      },
      orderBy: { createdAt: "desc" },
      take: fetchTake,
      select: {
        id: true,
        subscriptionId: true,
        createdAt: true,
        sentAt: true,
        kind: true,
        channel: true,
        shopperId: true,
        productId: true,
        status: true,
        errorReason: true,
        retryCount: true,
      },
    }),
    db.stockAlert.findMany({
      where: {
        shopId,
        channel: "email",
        notifiedAt: bounds,
      },
      orderBy: { notifiedAt: "desc" },
      take: fetchTake,
      select: {
        id: true,
        email: true,
        phone: true,
        contactKey: true,
        shopperId: true,
        customerId: true,
        productId: true,
        productTitle: true,
        status: true,
        attempts: true,
        lastError: true,
        notifiedAt: true,
      },
    }),
  ]);
  const logSubscriptionIds = new Set(
    logs.flatMap((log) => (log.subscriptionId ? [log.subscriptionId] : [])),
  );
  const fallbackAlerts = sentAlerts.filter(
    (alert) => !logSubscriptionIds.has(alert.id),
  );
  const [products] = await Promise.all([
    getProductsByIds(
      admin,
      [
        ...new Set([
          ...logs.map((log) => log.productId),
          ...fallbackAlerts.map((alert) => alert.productId),
        ]),
      ],
      1,
    ).catch(() => new Map()),
  ]);
  const alertById = new Map(sentAlerts.map((alert) => [alert.id, alert]));
  const rows = [
    ...logs.map((log) => {
      const alert = log.subscriptionId
        ? alertById.get(log.subscriptionId)
        : undefined;
      return {
        detailId: log.id,
        detailType: "log",
        productId: log.productId,
        date: (log.sentAt ?? log.createdAt).toISOString(),
        recipient:
          alert?.email ?? alert?.phone ?? alert?.contactKey ?? log.shopperId,
        kind: log.kind,
        channel: log.channel,
        shopper: log.shopperId,
        product: products.get(log.productId)?.title ?? log.productId,
        status: log.status,
        error: log.errorReason ?? "",
        retries: log.retryCount,
      };
    }),
    ...fallbackAlerts.map((alert) => ({
      detailId: alert.id,
      detailType: "alert",
      productId: alert.productId,
      date: alert.notifiedAt!.toISOString(),
      recipient: alert.email ?? alert.phone ?? alert.contactKey,
      kind: "RESTOCK",
      channel: "EMAIL",
      shopper: alert.shopperId ?? alert.customerId ?? alert.contactKey,
      product:
        alert.productTitle ??
        products.get(alert.productId)?.title ??
        alert.productId,
      status: alert.status.toLowerCase(),
      error: alert.lastError ?? "",
      retries: Math.max(0, alert.attempts - 1),
    })),
  ].sort((left, right) => right.date.localeCompare(left.date));
  const truncated = logLimit != null && rows.length > logLimit;
  const visibleRows = logLimit != null ? rows.slice(0, logLimit) : rows;
  return {
    summary: {
      total: visibleRows.length,
      sent: visibleRows.filter(
        (row) => row.status === "sent" || row.status === "delivered",
      ).length,
      failed: visibleRows.filter(
        (row) => row.status === "failed" || row.status === "bounced",
      ).length,
      retries: visibleRows.reduce((sum, row) => sum + row.retries, 0),
      logLimit: logLimit ?? 0,
      logTruncated: truncated ? 1 : 0,
    },
    delta: EMPTY_DELTA,
    series: [],
    rows: visibleRows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

async function usageData(
  shopId: string,
  range: DateRange,
): Promise<ReportData> {
  const [totals] = await Promise.all([dailyTotals(shopId, range)]);
  const rows = [
    {
      month: range.from,
      notificationsSent: totals.notificationsSent,
      planLimit: 10000,
      remaining: Math.max(0, 10000 - totals.notificationsSent),
    },
  ];
  return {
    summary: { notificationsSent: totals.notificationsSent },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

/* Attribution model comparison — Phase 3 */

async function attributionModelsData(
  shopId: string,
  range: DateRange,
  searchParams: URLSearchParams,
): Promise<ReportData> {
  const entries = await db.attribution.findMany({
    where: {
      shopId,
      model: { in: ["last_click", "any_touch"] },
      orderedAt: rangeBounds(range),
    },
    select: {
      model: true,
      orderId: true,
      type: true,
      revenue: true,
      orderedAt: true,
      touchAt: true,
    },
  });
  const modelFilter = searchParams.get("model");
  const selectedWindow = searchParams.get("windowDays");
  const rows: ReportRow[] = [];
  for (const model of ["last_click", "any_touch"] as const) {
    for (const windowDays of [7, 14, 30]) {
      const matching = entries.filter((entry) => {
        const elapsed = entry.orderedAt.getTime() - entry.touchAt.getTime();
        const belongsToModel =
          model === "any_touch"
            ? entry.model === "any_touch" || entry.model === "last_click"
            : entry.model === "last_click";
        return belongsToModel && elapsed >= 0 && elapsed <= windowDays * DAY_MS;
      });
      const orderIds = new Set(matching.map((entry) => entry.orderId));
      const revenue = matching.reduce(
        (sum, entry) => sum + Number(entry.revenue),
        0,
      );
      const directRevenue = matching
        .filter((entry) => entry.type === "DIRECT")
        .reduce((sum, entry) => sum + Number(entry.revenue), 0);
      const estimatedRevenue = matching
        .filter((entry) => entry.type === "ESTIMATED")
        .reduce((sum, entry) => sum + Number(entry.revenue), 0);
      rows.push({
        model,
        window: `${windowDays} days`,
        windowDays,
        orders: orderIds.size,
        revenue,
        revenuePerOrder: safeRate(revenue, orderIds.size),
        revenueLabel: revenueLabel(directRevenue, estimatedRevenue),
      });
    }
  }
  const visibleRows = rows.filter(
    (row) =>
      (!modelFilter || row.model === modelFilter) &&
      (!selectedWindow || String(row.windowDays) === selectedWindow),
  );
  const referenceModel = modelFilter || "last_click";
  const referenceWindow = Number(selectedWindow) || 30;
  const reference =
    rows.find(
      (row) =>
        row.model === referenceModel && row.windowDays === referenceWindow,
    ) ?? rows[2];
  return {
    summary: {
      orders: Number(reference.orders),
      revenue: Number(reference.revenue),
      revenuePerOrder: Number(reference.revenuePerOrder),
    },
    delta: EMPTY_DELTA,
    series: [],
    rows: visibleRows,
    revenueLabel: String(reference.revenueLabel),
  };
}

/* Customer value — Phase 3 */

async function customerValueData(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
): Promise<ReportData> {
  const [attributions, wishlistOrders, stockAlertPurchases] = await Promise.all(
    [
      db.attribution.findMany({
        where: { shopId, model: "last_click", orderedAt: rangeBounds(range) },
        select: { customerId: true, orderId: true, revenue: true },
      }),
      db.wishlistOrder.findMany({
        where: { shopId, createdAt: rangeBounds(range) },
        select: { orderId: true },
      }),
      db.stockAlert.findMany({
        where: {
          shopId,
          purchasedAt: rangeBounds(range),
          purchaseOrderId: { not: null },
        },
        select: {
          purchaseOrderId: true,
          customerId: true,
          email: true,
          purchaseRevenue: true,
        },
      }),
    ],
  );
  const orderIds = new Set([
    ...attributions.map((order) => order.orderId),
    ...wishlistOrders.map((order) => order.orderId),
    ...stockAlertPurchases.flatMap((purchase) =>
      purchase.purchaseOrderId ? [purchase.purchaseOrderId] : [],
    ),
  ]);
  const orderDetails = await loadShopifyOrderDetails(admin, [...orderIds]);
  const customerByOrder = new Map<string, string>();
  const emailByOrder = new Map<string, string>();
  const attributedRevenueByOrder = new Map<string, number>();
  const alertRevenueByOrder = new Map<string, number>();
  for (const attribution of attributions) {
    if (attribution.customerId)
      customerByOrder.set(attribution.orderId, attribution.customerId);
    attributedRevenueByOrder.set(
      attribution.orderId,
      (attributedRevenueByOrder.get(attribution.orderId) ?? 0) +
        Number(attribution.revenue),
    );
  }
  for (const purchase of stockAlertPurchases) {
    const orderId = purchase.purchaseOrderId;
    if (!orderId) continue;
    if (purchase.customerId && !customerByOrder.has(orderId))
      customerByOrder.set(orderId, purchase.customerId);
    if (purchase.email && !emailByOrder.has(orderId))
      emailByOrder.set(orderId, purchase.email.trim().toLowerCase());
    alertRevenueByOrder.set(
      orderId,
      (alertRevenueByOrder.get(orderId) ?? 0) +
        Number(purchase.purchaseRevenue ?? 0),
    );
  }

  const customersBySegment = new Map<
    string,
    Map<string, { orders: Set<string>; spend: number }>
  >([
    ["Guest customers", new Map()],
    ["Logged-in customers", new Map()],
  ]);
  for (const orderId of orderIds) {
    const details = orderDetails.get(orderId);
    const customerId = details?.customerId ?? customerByOrder.get(orderId);
    const email = details?.email ?? emailByOrder.get(orderId);
    const segment = customerId ? "Logged-in customers" : "Guest customers";
    const customerKey = customerId
      ? `customer:${customerId}`
      : email
        ? `guest:${email}`
        : `guest-order:${orderId}`;
    const customers = customersBySegment.get(segment)!;
    const customer = customers.get(customerKey) ?? {
      orders: new Set<string>(),
      spend: 0,
    };
    customer.orders.add(orderId);
    customer.spend +=
      details?.total ??
      Math.max(
        attributedRevenueByOrder.get(orderId) ?? 0,
        alertRevenueByOrder.get(orderId) ?? 0,
      );
    customers.set(customerKey, customer);
  }

  const segmentTotals = [...customersBySegment].map(([segment, customers]) => {
    const customerValues = [...customers.values()];
    const orders = customerValues.reduce(
      (sum, customer) => sum + customer.orders.size,
      0,
    );
    const repeatCustomers = customerValues.filter(
      (customer) => customer.orders.size > 1,
    ).length;
    const spend = customerValues.reduce(
      (sum, customer) => sum + customer.spend,
      0,
    );
    return {
      segment,
      customers: customers.size,
      orders,
      aov: safeRate(spend, orders),
      repeatPurchaseRate: safeRate(repeatCustomers, customers.size),
      spend,
      repeatCustomers,
    };
  });
  const totalCustomers = segmentTotals.reduce(
    (sum, row) => sum + row.customers,
    0,
  );
  const totalOrders = segmentTotals.reduce((sum, row) => sum + row.orders, 0);
  const totalRepeatCustomers = segmentTotals.reduce(
    (sum, row) => sum + row.repeatCustomers,
    0,
  );
  const totalSpend = segmentTotals.reduce((sum, row) => sum + row.spend, 0);
  const rows = segmentTotals.map(
    ({ repeatCustomers: _repeatCustomers, ...row }) => row,
  );
  return {
    summary: {
      customers: totalCustomers,
      orders: totalOrders,
      aov: safeRate(totalSpend, totalOrders),
      repeatPurchaseRate: safeRate(totalRepeatCustomers, totalCustomers),
      spend: totalSpend,
    },
    delta: EMPTY_DELTA,
    series: [],
    rows,
    revenueLabel: REVENUE_LABEL.direct,
  };
}

const DAY_MS = 86400000;

function applyFilters(
  rows: ReportRow[],
  params: AnalyticsParams,
  slug: ReportSlug,
) {
  let filtered = rows;
  if (params.productId && filtered.some((row) => row.productId !== undefined)) {
    filtered = filtered.filter((row) => row.productId === params.productId);
  }
  if (slug === "recurring-customers" && params.customerType) {
    filtered = filtered.filter(
      (row) =>
        String(row.customerType ?? "").toLowerCase() ===
        params.customerType!.toLowerCase(),
    );
  }
  if (
    [
      "notification-delivery",
      "notification-log",
      "reminder-performance",
    ].includes(slug) &&
    params.channel
  ) {
    filtered = filtered.filter(
      (row) =>
        String(row.channel ?? "").toLowerCase() ===
        params.channel!.toLowerCase(),
    );
  }
  if (
    slug === "notification-log" &&
    ["queued", "sent", "delivered", "bounced", "failed"].includes(
      params.status ?? "",
    )
  ) {
    const statuses =
      params.status === "sent"
        ? ["sent", "delivered"]
        : params.status === "failed"
          ? ["failed", "bounced"]
          : [params.status];
    filtered = filtered.filter((row) =>
      statuses.includes(String(row.status ?? "").toLowerCase()),
    );
  }
  return sortRows(
    searchRows(filtered, params.q, Object.keys(filtered[0] ?? {})),
    params.sort,
    params.order,
  );
}

export async function loadAnalyticsReport(
  shopId: string,
  admin: GraphqlClient,
  slug: ReportSlug,
  searchParams: URLSearchParams,
): Promise<{ response: ReportResponse; csvRows: ReportRow[] }> {
  const params = parseAnalyticsParams(searchParams);
  if (slug === "notification-log") params.channel = "EMAIL";
  const range = paramsRange(params);
  const previous = compareRange(params);
  let data: ReportData;
  switch (slug) {
    case "overview":
      data = await overviewData(shopId, admin, range, previous, params.groupBy);
      break;
    case "activity-trends":
      data = await activityData(shopId, range, previous, params.groupBy);
      break;
    case "conversion-funnel":
      data = await funnelData(shopId, range, previous);
      break;
    case "revenue-attribution":
      data = await revenueData(shopId, admin, range);
      break;
    case "wishlisted-products":
      data = await wishlistProductData(shopId, admin, range, false);
      break;
    case "wishlist-conversion":
      data = await wishlistProductData(shopId, admin, range, true);
      break;
    case "alert-subscriptions":
      data = await alertSubscriptionData(shopId, range);
      break;
    case "alert-customers":
      data = await alertCustomersData(shopId, range);
      break;
    case "pending-alerts":
      data = await pendingAlertData(shopId, range);
      break;
    case "restock-conversion":
      data = await restockConversionData(shopId, range);
      break;
    case "notification-delivery":
      data = await notificationDeliveryData(shopId, admin, range, params);
      break;
    case "shared-wishlists":
      data = await sharedWishlistsData(shopId, admin, range);
      break;
    case "wishlist-orders":
      data = await wishlistOrdersData(shopId, admin, range);
      break;
    case "removed-abandoned":
      data = await removedAbandonedData(shopId, admin, range, params);
      break;
    case "wishlist-to-cart":
      data = await wishlistToCartData(shopId, admin, range);
      break;
    case "variant-demand":
      data = await variantDemandData(shopId, admin, range);
      break;
    case "save-sources":
      data = await saveSourcesData(shopId, range);
      break;
    case "reminder-performance":
      data = await reminderPerformanceData(shopId, range, params);
      break;
    case "guest-to-customer":
      data = await guestToCustomerData(shopId, range);
      break;
    case "stock-list":
      data = await stockListData(shopId, admin, range);
      break;
    case "low-stock-demand":
      data = await lowStockDemandData(shopId, admin);
      break;
    case "alert-purchases":
      data = await alertPurchasesData(shopId, admin, range);
      break;
    case "time-to-notify":
      data = await timeToNotifyData(shopId, admin, range);
      break;
    case "lost-sales":
      data = await lostSalesData(shopId, range);
      break;
    case "sell-through":
      data = await sellThroughData(shopId, admin, range);
      break;
    case "subscription-sources":
      data = await subscriptionSourcesData(shopId, range);
      break;
    case "recurring-customers":
      data = await recurringCustomersData(shopId, admin, range);
      break;
    case "top-intent-customers":
      data = await topIntentCustomersData(shopId, admin, range);
      break;
    case "segments":
      data = await segmentsData(shopId, range);
      break;
    case "notification-log": {
      const plan = await getShopPlan(shopId);
      const logLimit = planNotificationLogLimit(plan.code);
      data = await notificationLogData(shopId, admin, range, logLimit);
      break;
    }
    case "usage":
      data = await usageData(shopId, range);
      break;
    case "attribution-models":
      data = await attributionModelsData(shopId, range, searchParams);
      break;
    case "customer-value":
      data = await customerValueData(shopId, admin, range);
      break;
    default:
      data = {
        summary: {},
        delta: EMPTY_DELTA,
        series: [],
        rows: [],
        revenueLabel: REVENUE_LABEL.direct,
      };
  }
  if (slug === "recurring-customers" && params.customerType) {
    const customers = data.rows.filter(
      (row) =>
        String(row.customerType ?? "").toLowerCase() ===
        params.customerType!.toLowerCase(),
    );
    data.summary = {
      customers: customers.length,
      saves: customers.reduce((sum, row) => sum + Number(row.saves ?? 0), 0),
      subscriptions: customers.reduce(
        (sum, row) => sum + Number(row.subscriptions ?? 0),
        0,
      ),
      clicks: customers.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0),
      orders: customers.reduce((sum, row) => sum + Number(row.orders ?? 0), 0),
      actions: customers.reduce(
        (sum, row) =>
          sum +
          Number(row.saves ?? 0) +
          Number(row.subscriptions ?? 0) +
          Number(row.clicks ?? 0) +
          Number(row.orders ?? 0),
        0,
      ),
      spend: customers.reduce((sum, row) => sum + Number(row.spend ?? 0), 0),
    };
  }
  if (previous && Object.keys(data.delta).length === 0) {
    const previousParams = new URLSearchParams(searchParams);
    previousParams.set("from", previous.from);
    previousParams.set("to", previous.to);
    previousParams.set("compare", "false");
    const previousReport = await loadAnalyticsReport(
      shopId,
      admin,
      slug,
      previousParams,
    );
    data.delta = compareTotals(data.summary, previousReport.response.summary);
  }
  const allRows = applyFilters(data.rows, params, slug);
  const page = paginate(allRows, params.page, params.pageSize);
  const response: ReportResponse = {
    report: slug,
    range,
    compareRange: previous,
    summary: data.summary,
    delta: data.delta,
    series: data.series,
    rows: params.format === "csv" ? allRows : page.rows,
    columns: REPORT_CSV_COLUMNS[slug],
    pagination: page.pagination,
    revenueLabel: data.revenueLabel,
  };
  if (slug === "notification-log") {
    const plan = await getShopPlan(shopId);
    const logLimit = planNotificationLogLimit(plan.code);
    response.planGate = {
      planCode: plan.code,
      planName: plan.name,
      logLimit,
      truncated: Boolean(data.summary.logTruncated),
      upgradePlanCode: nextPlanForLogUpgrade(plan.code),
    };
  }
  return { response, csvRows: allRows };
}
