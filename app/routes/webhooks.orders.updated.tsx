import type { ActionFunctionArgs } from "@remix-run/node";
import { getOrCreateShop } from "../lib/shop.server";
import {
  attributeOrderLines,
  attributeWishlistOrders,
  handleOrderWebhook,
} from "../lib/order-webhook.server";

/** Acknowledge `orders/updated` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleOrderWebhook(request, "/webhooks/orders/updated", async ({ shop, payload }) => {
    const order = payload;
    if (order?.financial_status !== "paid" || !order?.id) return;

    const shopRecord = await getOrCreateShop(shop);
    const orderId = String(order.id);
    const items = order?.line_items || [];
    const customerId = order?.customer?.id ? String(order.customer.id) : null;

    await attributeWishlistOrders({
      shopRecordId: shopRecord.id,
      orderId,
      items,
      customerId,
    });
    await attributeOrderLines({ shopRecordId: shopRecord.id, order });
  });
