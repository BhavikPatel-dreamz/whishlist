import db from "../db.server";
import { rangeBounds, type DateRange } from "../lib/analytics-params";
import type {
  RecurringCustomerDetail,
  RecurringCustomerOrder,
} from "../lib/recurring-customer-detail";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
  type ProductSummary,
} from "../lib/shopify-data.server";
import { loadShopifyOrderDetails } from "./analytics-reports.server";

export async function loadRecurringCustomerDetail(
  shopId: string,
  admin: GraphqlClient,
  customerId: string,
  range: DateRange,
): Promise<RecurringCustomerDetail> {
  const bounds = rangeBounds(range);
  const [saves, subscriptions, clicks, attributions, savedOrders] =
    await Promise.all([
      db.wishlistItem.count({
        where: { shopId, customerId, createdAt: bounds },
      }),
      db.stockAlert.count({ where: { shopId, customerId, createdAt: bounds } }),
      db.notificationLog.findMany({
        where: { shopId, clickedAt: bounds },
        select: {
          shopperId: true,
          subscriptionId: true,
          wishlistItemId: true,
        },
      }),
      db.attribution.findMany({
        where: { shopId, customerId, model: "last_click", orderedAt: bounds },
        select: {
          orderId: true,
          orderNumber: true,
          productId: true,
          variantId: true,
          source: true,
          quantity: true,
          revenue: true,
          orderedAt: true,
        },
        orderBy: [{ orderedAt: "desc" }, { orderId: "asc" }],
      }),
      db.wishlistOrder.findMany({
        where: { shopId, createdAt: bounds },
        select: { orderId: true, productId: true, createdAt: true },
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
  const customerByAlert = new Map(
    clickedAlerts.map((alert) => [alert.id, alert.customerId]),
  );
  const customerByItem = new Map(
    clickedWishlistItems.map((item) => [item.id, item.customerId]),
  );
  const clickCount = clicks.filter(
    (click) =>
      (click.subscriptionId &&
        customerByAlert.get(click.subscriptionId) === customerId) ||
      (click.wishlistItemId &&
        customerByItem.get(click.wishlistItemId) === customerId) ||
      click.shopperId === customerId,
  ).length;

  const shopifyOrders = await loadShopifyOrderDetails(
    admin,
    savedOrders.map((row) => row.orderId),
  );
  const productIds = [
    ...new Set([
      ...attributions.map((row) => row.productId),
      ...savedOrders.map((row) => row.productId),
    ]),
  ];
  const [customerNames, products] = await Promise.all([
    getCustomerNamesByIds(admin, [customerId]).catch(
      () => new Map<string, string>(),
    ),
    getProductsByIds(admin, productIds).catch(
      () => new Map<string, ProductSummary>(),
    ),
  ]);
  const orders = new Map<string, RecurringCustomerOrder>();
  let spend = 0;
  for (const row of attributions) {
    const order = orders.get(row.orderId) ?? {
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      orderedAt: row.orderedAt.toISOString(),
      products: [],
    };
    const product = products.get(row.productId);
    const variant = row.variantId
      ? product?.variants.find((item) => item.variantId === row.variantId)
      : null;
    const revenue = Number(row.revenue);
    order.products.push({
      title: product?.title ?? `Product ${row.productId}`,
      variant: variant?.title ?? row.variantId ?? "—",
      quantity: row.quantity,
      source: row.source === "WISHLIST" ? "Wishlist" : "Back in stock",
      revenue,
    });
    spend += revenue;
    orders.set(row.orderId, order);
  }
  const attributedProductKeys = new Set(
    attributions.map((row) => `${row.orderId}:${row.productId}`),
  );
  const fallbackRevenueOrderIds = new Set<string>();
  for (const savedOrder of savedOrders) {
    const orderId = savedOrder.orderId.split("/").pop()!;
    const shopifyOrder = shopifyOrders.get(orderId);
    if (shopifyOrder?.customerId !== customerId) continue;
    const order = orders.get(orderId) ?? {
      orderId,
      orderNumber: `#${orderId}`,
      orderedAt: savedOrder.createdAt.toISOString(),
      products: [],
    };
    const key = `${orderId}:${savedOrder.productId}`;
    if (!attributedProductKeys.has(key)) {
      const productRevenue =
        orders.has(orderId) || fallbackRevenueOrderIds.has(orderId)
          ? 0
          : shopifyOrder.total;
      order.products.push({
        title:
          products.get(savedOrder.productId)?.title ??
          `Product ${savedOrder.productId}`,
        variant: "—",
        quantity: 1,
        source: "Wishlist",
        revenue: productRevenue,
      });
      if (productRevenue > 0) {
        spend += productRevenue;
        fallbackRevenueOrderIds.add(orderId);
      }
    }
    orders.set(orderId, order);
  }

  return {
    customerId,
    customer: customerNames.get(customerId) ?? `Customer ${customerId}`,
    saves,
    subscriptions,
    clicks: clickCount,
    orders: orders.size,
    spend,
    orderDetails: [...orders.values()],
  };
}
