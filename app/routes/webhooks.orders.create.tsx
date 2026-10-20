import type { ActionFunctionArgs } from "@remix-run/node";
import { getOrCreateShop } from "../lib/shop.server";
import { attributeWishlistOrders, handleOrderWebhook } from "../lib/order-webhook.server";

/** Acknowledge `orders/create` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleOrderWebhook(request, "/webhooks/orders/create", async ({ shop, payload }) => {
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
    });
  });
