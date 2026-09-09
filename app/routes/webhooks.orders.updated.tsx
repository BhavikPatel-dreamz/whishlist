import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { recordWishlistDrivenOrder } from "../models/wishlist.server";
import { getOrCreateShop } from "../lib/shop.server";

/** Acknowledge `orders/updated` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`[webhook:${topic}] received for ${shop}`);

    try {
      const order = payload as any;
      if (order?.financial_status === "paid" && order?.id) {
        const shopRecord = await getOrCreateShop(shop);
        const orderId = String(order.id);
        const items = order?.line_items || [];

        for (const li of items) {
          const productId = li.product_id || li.productId;
          if (productId) {
            await recordWishlistDrivenOrder(shopRecord.id, orderId, String(productId));
          }
        }
      }
    } catch (err) {
      console.warn("Failed processing order update metrics", err);
    }

    return new Response();
  } catch (err) {
    console.error("/webhooks/orders/updated handler error", err);
    return new Response(null, { status: 500 });
  }
};
