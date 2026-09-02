import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { incrementPurchases } from "../models/wishlist.server";
import { getOrCreateShop } from "../lib/shop.server";

/** Acknowledge `orders/paid` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`[webhook:${topic}] received for ${shop}`);
    // Process paid orders: increment purchase counts for wishlisted products
    try {
      const shopRecord = await getOrCreateShop(shop);
      const order = payload as any;
      const items = order?.line_items || [];
      for (const li of items) {
        const productId = li.product_id || li.productId || li.productId;
        if (productId) {
          await incrementPurchases(shopRecord.id, String(productId), Number(li.quantity || 1));
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
