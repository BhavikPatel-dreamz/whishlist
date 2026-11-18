import { verifyPayloadSignature } from "../lib/crypto.server";
import { recordStockAlertPurchase } from "../models/stock-alert.server";
import {
  attributeOrderLines,
  attributeWishlistOrders,
  createOrderWebhook,
} from "../lib/order-webhook.server";

function stockAlertToken(lineItem: any): string | null {
  const properties = lineItem?.properties;
  const value = Array.isArray(properties)
    ? properties.find((property) => property?.name === "_back_in_stock_alert")?.value
    : properties?._back_in_stock_alert;
  return typeof value === "string" ? value : null;
}

async function recordAlertPurchase(
  lineItem: any,
  order: Record<string, any>,
  orderId: string,
): Promise<void> {
  const token = stockAlertToken(lineItem);
  const separator = token?.lastIndexOf(".") ?? -1;
  if (!token || separator <= 0) return;

  const alertId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const variantId = lineItem.variant_id || lineItem.variantId;
  const unitPrice = Number(lineItem.price);
  const quantity = Number(lineItem.quantity);
  const discount = Number(lineItem.total_discount || 0);
  if (
    !variantId ||
    !verifyPayloadSignature(alertId, signature) ||
    !Number.isFinite(unitPrice) ||
    !Number.isFinite(quantity)
  ) {
    return;
  }

  await recordStockAlertPurchase({
    alertId,
    variantId: String(variantId),
    orderId,
    revenue: Math.max(0, unitPrice * quantity - discount).toFixed(2),
    currency: String(order.currency || order.presentment_currency || ""),
    purchasedAt: new Date(order.processed_at || order.created_at || Date.now()),
  });
}

/** Acknowledge `orders/paid` webhooks. */
export const action = createOrderWebhook("/webhooks/orders/paid", async (ctx) => {
  await attributeWishlistOrders({
    shopRecordId: ctx.shopRecord.id,
    orderId: ctx.orderId,
    items: ctx.items,
    customerId: ctx.customerId,
    onLineItem: (lineItem) => recordAlertPurchase(lineItem, ctx.order, ctx.orderId),
  });
  await attributeOrderLines({ shopRecordId: ctx.shopRecord.id, order: ctx.order });
});