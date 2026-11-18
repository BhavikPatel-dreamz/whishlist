import {
  attributeOrderLines,
  attributeWishlistOrders,
  createOrderWebhook,
} from "../lib/order-webhook.server";

/** Acknowledge `orders/updated` webhooks. */
export const action = createOrderWebhook("/webhooks/orders/updated", async (ctx) => {
  const order = ctx.order;
  if (order?.financial_status !== "paid") return;
  await attributeWishlistOrders({
    shopRecordId: ctx.shopRecord.id,
    orderId: ctx.orderId,
    items: ctx.items,
    customerId: ctx.customerId,
  });
  await attributeOrderLines({ shopRecordId: ctx.shopRecord.id, order });
});