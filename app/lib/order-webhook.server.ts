import { authenticate } from "../shopify.server";
import {
  customerSavedProductIds,
  recordWishlistDrivenOrders,
} from "../models/wishlist.server";

type LineItem = Record<string, any>;

type OrderPayload = Record<string, any>;

export function isWishlistLineItem(lineItem: LineItem): boolean {
  const properties = lineItem?.properties;
  if (Array.isArray(properties)) {
    return properties.some(
      (property) => property?.name === "_wishlist_stock" && property?.value === "true",
    );
  }
  return properties?._wishlist_stock === "true";
}

/**
 * Attribute order line items to wishlist activity: an explicit
 * `_wishlist_stock` line property, or a customer who had the product saved.
 * `onLineItem` runs before attribution so callers can record extra signals.
 * Attribution itself is batched: one lookup for the buyer's saved products and
 * one write for every newly attributed product, so a 30-line order costs a
 * handful of queries instead of 30+.
 */
export async function attributeWishlistOrders({
  shopRecordId,
  orderId,
  items,
  customerId,
  onLineItem,
}: {
  shopRecordId: string;
  orderId: string;
  items: LineItem[];
  customerId: string | null;
  onLineItem?: (lineItem: LineItem) => Promise<void>;
}): Promise<void> {
  if (onLineItem) {
    for (const li of items) {
      if (li.product_id || li.productId) await onLineItem(li);
    }
  }

  const explicit: string[] = [];
  const fallbackCandidates: string[] = [];
  for (const li of items) {
    const productId = li.product_id || li.productId;
    if (!productId) continue;
    if (isWishlistLineItem(li)) {
      explicit.push(String(productId));
    } else if (customerId) {
      fallbackCandidates.push(String(productId));
    }
  }

  let saved: Set<string> = new Set();
  if (fallbackCandidates.length) {
    try {
      saved = await customerSavedProductIds(shopRecordId, customerId, fallbackCandidates);
    } catch (err) {
      // Retry the webhook if attribution could not be checked.
      console.warn("Failed to check customer wishlist for attribution", err);
      throw err;
    }
  }

  await recordWishlistDrivenOrders(shopRecordId, orderId, [...explicit, ...saved]);
}

/**
 * Shared `orders/*` webhook shell: authenticate, run `process`, and map any
 * failure to the standard staged error response.
 */
export async function handleOrderWebhook(
  request: Request,
  path: string,
  process: (ctx: { shop: string; topic: string; payload: OrderPayload }) => Promise<void>,
): Promise<Response> {
  let stage = "authentication";
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    stage = "order-processing";
    console.log(`[webhook:${topic}] received for ${shop}`);

    try {
      await process({ shop, topic, payload: payload as OrderPayload });
    } catch (err) {
      console.warn(`Failed processing ${path} order items for metrics`, err);
      throw err;
    }

    return new Response();
  } catch (err) {
    if (err instanceof Response) {
      console.warn(`${path} rejected`, {
        stage,
        status: err.status,
        webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      });
      return err;
    }
    console.error(`${path} handler error`, {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
}
