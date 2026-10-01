import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { recordWishlistDrivenOrder, customerHasSavedProduct } from "../models/wishlist.server";
import { getOrCreateShop } from "../lib/shop.server";

function isWishlistLineItem(lineItem: any) {
  const properties = lineItem?.properties;
  if (Array.isArray(properties)) {
    return properties.some(
      (property) => property?.name === "_wishlist_stock" && property?.value === "true",
    );
  }
  return properties?._wishlist_stock === "true";
}

/** Acknowledge `orders/paid` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) => {
  let stage = "authentication";
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    stage = "order-processing";
    console.log(`[webhook:${topic}] received for ${shop}`);
    try {
      const shopRecord = await getOrCreateShop(shop);
      const order = payload as any;
      const orderId = order?.id ? String(order.id) : null;
      if (!orderId) return new Response();
      const items = order?.line_items || [];
      const customerId = order?.customer?.id ? String(order.customer.id) : null;
      for (const li of items) {
        const productId = li.product_id || li.productId;
        if (!productId) continue;

        if (isWishlistLineItem(li)) {
          await recordWishlistDrivenOrder(shopRecord.id, orderId, String(productId));
          continue;
        }

        if (customerId) {
          try {
            const saved = await customerHasSavedProduct(shopRecord.id, customerId, String(productId));
            if (saved) {
              await recordWishlistDrivenOrder(shopRecord.id, orderId, String(productId));
            }
          } catch (err) {
            console.warn('Failed to check customer wishlist for attribution', err);
            throw err;
          }
        }
      }
    } catch (err) {
      console.warn("Failed processing order items for metrics", err);
      throw err;
    }
    return new Response();
  } catch (err) {
    if (err instanceof Response) {
      console.warn("/webhooks/orders/paid rejected", {
        stage,
        status: err.status,
        webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      });
      return err;
    }
    console.error("/webhooks/orders/paid handler error", {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
};
