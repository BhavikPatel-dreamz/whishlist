import type { ActionFunctionArgs } from "@remix-run/node";
import { getOrCreateShop } from "../lib/shop.server";
import { verifyPayloadSignature } from "../lib/crypto.server";
import { recordStockAlertPurchase } from "../models/stock-alert.server";
import { attributeWishlistOrders, handleOrderWebhook } from "../lib/order-webhook.server";

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
export const action = async ({ request }: ActionFunctionArgs) =>
  handleOrderWebhook(request, "/webhooks/orders/paid", async ({ shop, payload }) => {
    const shopRecord = await getOrCreateShop(shop);
    const order = payload;
    const orderId = order?.id ? String(order.id) : null;
    if (!orderId) return;

    const items = order?.line_items || [];
    const customerId = order?.customer?.id ? String(order.customer.id) : null;
    await attributeWishlistOrders({
      shopRecordId: shopRecord.id,
      orderId,
      items,
      customerId,
      onLineItem: (lineItem) => recordAlertPurchase(lineItem, order, orderId),
    });
  });
