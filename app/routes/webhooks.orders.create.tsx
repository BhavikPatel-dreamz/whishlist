import {
  attributeWishlistOrders,
  createOrderWebhook,
} from "../lib/order-webhook.server";

/** Acknowledge `orders/create` webhooks. */
export const action = createOrderWebhook("/webhooks/orders/create", async (ctx) => {
  await attributeWishlistOrders({
    shopRecordId: ctx.shopRecord.id,
    orderId: ctx.orderId,
    items: ctx.items,
    customerId: ctx.customerId,
  });
});