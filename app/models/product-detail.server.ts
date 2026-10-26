import db from "../db.server";
import { rangeBounds, type DateRange } from "../lib/analytics-params";
import type {
  ProductDetail,
  ProductDetailNotification,
  ProductDetailOrder,
  ProductDetailRevenueRow,
  ProductDetailSaver,
  ProductDetailSubscription,
} from "../lib/product-detail";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
} from "../lib/shopify-data.server";

const WAITING_STATUSES = new Set(["PENDING", "CONFIRMED", "SENDING"]);

const REVENUE_ORDER = [
  "WISHLIST:DIRECT",
  "WISHLIST:ESTIMATED",
  "RESTOCK_ALERT:DIRECT",
  "RESTOCK_ALERT:ESTIMATED",
];

function cleanContact(contactKey: string) {
  return contactKey.replace(/^(email|sms):/, "");
}

function guestLabel(value: string) {
  const short = value.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  return short ? `Guest · ${short}` : "Guest shopper";
}

async function customerNames(admin: GraphqlClient, ids: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 250) {
    chunks.push(ids.slice(index, index + 250));
  }
  const maps = await Promise.all(
    chunks.map((chunk) =>
      getCustomerNamesByIds(admin, chunk).catch(
        () => new Map<string, string>(),
      ),
    ),
  );
  return new Map(maps.flatMap((map) => [...map]));
}

function revenueLabel(
  direct: number,
  estimated: number,
): ProductDetail["revenueLabel"] {
  if (direct > 0 && estimated > 0) return "mixed";
  return estimated > 0 ? "estimated" : "direct";
}

/**
 * Everything behind one product in the Overview's "Top 5 products by saves"
 * card: who saved it, its back-in-stock subscriptions and pending alerts, the
 * notifications that went out, and the orders/revenue attributed to it.
 *
 * Date filters match the report's date range. Saves count the same way the
 * wishlisted-products report does (save events, falling back to saved rows),
 * while revenue uses last-click attribution so lines are never double counted.
 */
export async function loadProductDetail(
  shopId: string,
  admin: GraphqlClient,
  productId: string,
  range: DateRange,
  variantId?: string,
): Promise<ProductDetail> {
  const bounds = rangeBounds(range);

  const [
    saveEvents,
    wishlistItems,
    alerts,
    logs,
    attributions,
    variantSubscriptions,
  ] = await Promise.all([
    db.trackingEvent.findMany({
      where: {
        shopId,
        productId,
        type: "WISHLIST_SAVE",
        createdAt: bounds,
        ...(variantId ? { variantId } : {}),
      },
      select: {
        shopperId: true,
        customerId: true,
        source: true,
        device: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    db.wishlistItem.findMany({
      where: {
        shopId,
        productId,
        createdAt: bounds,
        ...(variantId ? { variantId } : {}),
      },
      select: {
        customerId: true,
        guestToken: true,
        shopperId: true,
        source: true,
        device: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    db.stockAlert.findMany({
      where: { shopId, productId, createdAt: bounds },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        customerId: true,
        email: true,
        phone: true,
        contactKey: true,
        channel: true,
        variantId: true,
        variantTitle: true,
        status: true,
        confirmed: true,
        createdAt: true,
        notifiedAt: true,
        convertedAt: true,
        purchasedAt: true,
        purchaseOrderId: true,
        purchaseRevenue: true,
        purchaseCurrency: true,
        pendingReason: true,
        lastError: true,
      },
    }),
    db.notificationLog.findMany({
      where: { shopId, productId, createdAt: bounds },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        subscriptionId: true,
        shopperId: true,
        channel: true,
        kind: true,
        status: true,
        createdAt: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
        errorReason: true,
        retryCount: true,
      },
    }),
    db.attribution.findMany({
      where: {
        shopId,
        productId,
        model: "last_click",
        orderedAt: bounds,
      },
      orderBy: [{ orderedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        customerId: true,
        source: true,
        type: true,
        quantity: true,
        revenue: true,
        orderedAt: true,
      },
    }),
    variantId
      ? db.stockAlert.findMany({
          where: { shopId, productId, variantId },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            customerId: true,
            email: true,
            phone: true,
            contactKey: true,
            channel: true,
            variantId: true,
            variantTitle: true,
            status: true,
            confirmed: true,
            createdAt: true,
            notifiedAt: true,
            convertedAt: true,
            purchasedAt: true,
            purchaseOrderId: true,
            purchaseRevenue: true,
            purchaseCurrency: true,
            pendingReason: true,
            lastError: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const product = await getProductsByIds(admin, [productId], 50)
    .then((map) => map.get(productId) ?? null)
    .catch(() => null);

  /* ---- Unique savers --------------------------------------------------- */
  type SaverAccumulator = {
    customerId: string | null;
    guestId: string | null;
    saves: number;
    firstSavedAt: Date;
    lastSavedAt: Date;
    source: string | null;
    device: string | null;
  };
  const saverMap = new Map<string, SaverAccumulator>();
  const addSaver = (
    key: string,
    values: Omit<SaverAccumulator, "saves" | "firstSavedAt" | "lastSavedAt"> & {
      at: Date;
    },
  ) => {
    const existing = saverMap.get(key);
    if (!existing) {
      saverMap.set(key, {
        customerId: values.customerId,
        guestId: values.guestId,
        saves: 1,
        firstSavedAt: values.at,
        lastSavedAt: values.at,
        source: values.source,
        device: values.device,
      });
      return;
    }
    existing.saves += 1;
    if (values.at < existing.firstSavedAt) existing.firstSavedAt = values.at;
    if (values.at > existing.lastSavedAt) existing.lastSavedAt = values.at;
    existing.source = existing.source ?? values.source;
    existing.device = existing.device ?? values.device;
  };

  for (const event of saveEvents) {
    const key = event.customerId
      ? `customer:${event.customerId}`
      : `guest:${event.shopperId}`;
    addSaver(key, {
      customerId: event.customerId,
      guestId: event.customerId ? null : event.shopperId,
      source: event.source,
      device: event.device,
      at: event.createdAt,
    });
  }
  // Rows saved before event tracking existed still belong in the list.
  const knownSavers = new Set(saverMap.keys());
  for (const item of wishlistItems) {
    const guestId = item.shopperId ?? item.guestToken;
    const key = item.customerId
      ? `customer:${item.customerId}`
      : guestId
        ? `guest:${guestId}`
        : null;
    if (!key || knownSavers.has(key)) continue;
    knownSavers.add(key);
    addSaver(key, {
      customerId: item.customerId,
      guestId: item.customerId ? null : guestId,
      source: item.source,
      device: item.device,
      at: item.createdAt,
    });
  }

  const customerIdSet = new Set<string>();
  for (const saver of saverMap.values()) {
    if (saver.customerId) customerIdSet.add(saver.customerId);
  }
  for (const alert of alerts) {
    if (alert.customerId) customerIdSet.add(alert.customerId);
  }
  for (const attribution of attributions) {
    if (attribution.customerId) customerIdSet.add(attribution.customerId);
  }
  const names = await customerNames(admin, [...customerIdSet]);

  const savers: ProductDetailSaver[] = [...saverMap]
    .map(([id, saver], index) => ({
      id,
      name: saver.customerId
        ? names.get(saver.customerId) || `Customer ${saver.customerId}`
        : guestLabel(saver.guestId || id) || `Guest shopper ${index + 1}`,
      type: saver.customerId ? ("customer" as const) : ("guest" as const),
      saves: saver.saves,
      firstSavedAt: saver.firstSavedAt.toISOString(),
      lastSavedAt: saver.lastSavedAt.toISOString(),
      source: saver.source,
      device: saver.device,
    }))
    .sort(
      (a, b) =>
        Date.parse(b.lastSavedAt) - Date.parse(a.lastSavedAt) ||
        a.name.localeCompare(b.name),
    );

  /* ---- Subscriptions & pending alerts --------------------------------- */
  const subscriptionRows = variantSubscriptions ?? alerts;
  const subscriptions: ProductDetailSubscription[] = subscriptionRows.map(
    (alert) => ({
      id: alert.id,
      contact: alert.email || alert.phone || cleanContact(alert.contactKey),
      channel: alert.channel,
      variantTitle:
        alert.variantTitle && alert.variantTitle !== "Default Title"
          ? alert.variantTitle
          : alert.variantId,
      status: alert.status,
      confirmed: alert.confirmed,
      createdAt: alert.createdAt.toISOString(),
      notifiedAt: alert.notifiedAt?.toISOString() ?? null,
      convertedAt: alert.convertedAt?.toISOString() ?? null,
      purchasedAt: alert.purchasedAt?.toISOString() ?? null,
      purchaseOrderId: alert.purchaseOrderId,
      purchaseRevenue:
        alert.purchaseRevenue === null ? null : Number(alert.purchaseRevenue),
      purchaseCurrency: alert.purchaseCurrency,
      pendingReason: alert.pendingReason,
      lastError: alert.lastError,
    }),
  );
  const pendingAlerts = subscriptions.filter(
    (alert) => WAITING_STATUSES.has(alert.status) && !alert.notifiedAt,
  );
  const alertById = new Map(alerts.map((alert) => [alert.id, alert]));

  /* ---- Notification sends --------------------------------------------- */
  const notifications: ProductDetailNotification[] = logs.map((log) => {
    const subscription = log.subscriptionId
      ? alertById.get(log.subscriptionId)
      : undefined;
    return {
      id: log.id,
      recipient:
        subscription?.email ||
        subscription?.phone ||
        (subscription ? cleanContact(subscription.contactKey) : null) ||
        log.shopperId ||
        "Not recorded",
      channel: log.channel,
      kind: log.kind,
      status: log.status,
      createdAt: log.createdAt.toISOString(),
      sentAt: log.sentAt?.toISOString() ?? null,
      deliveredAt: log.deliveredAt?.toISOString() ?? null,
      openedAt: log.openedAt?.toISOString() ?? null,
      clickedAt: log.clickedAt?.toISOString() ?? null,
      errorReason: log.errorReason,
      retryCount: log.retryCount,
    };
  });

  /* ---- Attributed orders & revenue ------------------------------------ */
  type OrderAccumulator = {
    orderNumber: string;
    customerId: string | null;
    orderedAt: Date;
    sources: Set<string>;
    types: Set<string>;
    quantity: number;
    revenue: number;
  };
  const orderMap = new Map<string, OrderAccumulator>();
  const revenueMap = new Map<
    string,
    {
      source: string;
      type: string;
      orders: Set<string>;
      units: number;
      revenue: number;
    }
  >();
  let directRevenue = 0;
  let estimatedRevenue = 0;

  for (const attribution of attributions) {
    const revenue = Number(attribution.revenue);
    const group = orderMap.get(attribution.orderId);
    if (group) {
      group.sources.add(attribution.source);
      group.types.add(attribution.type);
      group.quantity += attribution.quantity;
      group.revenue += revenue;
      if (attribution.orderedAt < group.orderedAt) {
        group.orderedAt = attribution.orderedAt;
      }
    } else {
      orderMap.set(attribution.orderId, {
        orderNumber: attribution.orderNumber,
        customerId: attribution.customerId,
        orderedAt: attribution.orderedAt,
        sources: new Set([attribution.source]),
        types: new Set([attribution.type]),
        quantity: attribution.quantity,
        revenue,
      });
    }

    const key = `${attribution.source}:${attribution.type}`;
    const revenueRow = revenueMap.get(key) ?? {
      source: attribution.source,
      type: attribution.type,
      orders: new Set<string>(),
      units: 0,
      revenue: 0,
    };
    revenueRow.orders.add(attribution.orderId);
    revenueRow.units += attribution.quantity;
    revenueRow.revenue += revenue;
    revenueMap.set(key, revenueRow);

    if (attribution.type === "DIRECT") directRevenue += revenue;
    else estimatedRevenue += revenue;
  }

  const orders: ProductDetailOrder[] = [...orderMap]
    .map(([orderId, order]) => ({
      id: orderId,
      orderId,
      orderNumber: order.orderNumber,
      customer:
        (order.customerId ? names.get(order.customerId) : null) ||
        (order.customerId
          ? `Customer ${order.customerId}`
          : "Guest / not recorded"),
      orderedAt: order.orderedAt.toISOString(),
      sources: [...order.sources],
      types: [...order.types],
      quantity: order.quantity,
      revenue: order.revenue,
    }))
    .sort((a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt));

  const revenue: ProductDetailRevenueRow[] = [...revenueMap.values()]
    .map((row) => ({
      source: row.source,
      type: row.type,
      orders: row.orders.size,
      units: row.units,
      revenue: row.revenue,
    }))
    .sort((a, b) => {
      const left = REVENUE_ORDER.indexOf(`${a.source}:${a.type}`);
      const right = REVENUE_ORDER.indexOf(`${b.source}:${b.type}`);
      return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
    });

  const attributedRevenue = attributions.reduce(
    (sum, row) => sum + Number(row.revenue),
    0,
  );

  return {
    product: {
      productId,
      title: product?.title ?? `Unavailable product (${productId})`,
      imageUrl: product?.imageUrl ?? null,
      onlineStoreUrl: product?.onlineStoreUrl ?? null,
      status: product?.status ?? "Unavailable",
      totalInventory: product?.totalInventory ?? 0,
      price: product?.minPrice ?? null,
      currencyCode: product?.currencyCode ?? null,
      variants: (product?.variants ?? []).map((variant) => ({
        variantId: variant.variantId,
        title: variant.title,
        price: variant.price,
        availableForSale: variant.availableForSale,
        sku: variant.sku,
      })),
    },
    range,
    summary: {
      saves: Math.max(saveEvents.length, wishlistItems.length),
      uniqueSavers: savers.length,
      subscriptions: subscriptions.length,
      pendingAlerts: pendingAlerts.length,
      notificationsSent: notifications.filter((log) => log.sentAt).length,
      notificationsDelivered: notifications.filter((log) => log.deliveredAt)
        .length,
      notificationsClicked: notifications.filter((log) => log.clickedAt).length,
      attributedOrders: orders.length,
      attributedUnits: orders.reduce((sum, order) => sum + order.quantity, 0),
      attributedRevenue,
    },
    savers,
    subscriptions,
    pendingAlerts,
    notifications,
    orders,
    revenue,
    revenueLabel: revenueLabel(directRevenue, estimatedRevenue),
  };
}
