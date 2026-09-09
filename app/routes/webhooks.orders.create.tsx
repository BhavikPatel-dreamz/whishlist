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

/** Acknowledge `orders/create` webhooks. */
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
      const customerId = order?.customer?.id ? String(order.customer.id) : null;
      for (const li of items) {
        const productId = li.product_id || li.productId;
        if (!productId) continue;

        // Prefer an explicit line property added by the wishlist flow.
        if (isWishlistLineItem(li)) {
          await recordWishlistDrivenOrder(shopRecord.id, orderId, String(productId));
          continue;
        }

        // Fall back to checking whether the buyer had this product saved.
        if (customerId) {
          try {
            const saved = await customerHasSavedProduct(shopRecord.id, customerId, String(productId));
            if (saved) {
              await recordWishlistDrivenOrder(shopRecord.id, orderId, String(productId));
            }
          } catch (err) {
            // Non-fatal: attribution should not block webhook handling.
            console.warn('Failed to check customer wishlist for attribution', err);
          }
        }
      }
    } catch (err) {
      console.warn("Failed processing created order items for metrics", err);
    }

    return new Response();
  } catch (err) {
    console.error("/webhooks/orders/create handler error", err);
    return new Response(null, { status: 500 });
  }
};
