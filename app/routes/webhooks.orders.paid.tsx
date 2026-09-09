import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { recordWishlistDrivenOrder } from "../models/wishlist.server";
import { getOrCreateShop } from "../lib/shop.server";

/** Acknowledge `orders/paid` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`[webhook:${topic}] received for ${shop}`);
    try {
      const shopRecord = await getOrCreateShop(shop);
      const order = payload as any;
      const orderId = order?.id ? String(order.id) : null;
      if (!orderId) return new Response();
      const items = order?.line_items || [];
      for (const li of items) {
        const productId = li.product_id || li.productId;
        if (productId) {
          await recordWishlistDrivenOrder(shopRecord.id, orderId, String(productId));
        }
      }
    } catch (err) {
      console.warn("Failed processing order items for metrics", err);
    }
    return new Response();
  } catch (err) {
    console.error("/webhooks/orders/paid handler error", err);
    return new Response(null, { status: 500 });
  }
};
