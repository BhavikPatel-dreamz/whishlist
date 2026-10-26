import { authenticate } from "../shopify.server";
import {
  customerSavedProductIds,
  recordWishlistDrivenOrders,
} from "../models/wishlist.server";
import {
  attributeOrder,
  lineProperties,
  normalizeOrderLines,
  type OrderLine,
} from "../models/attribution.server";
import { verifyPayloadSignature } from "./crypto.server";

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
 * The alert id a back-in-stock notification put on the line, but only when the
 * signature proves the app minted it.
 */
export function verifiedRestockAlertId(lineItem: LineItem): string | null {
  const token = lineProperties(lineItem)._back_in_stock_alert;
  if (typeof token !== "string") return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const alertId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!verifyPayloadSignature(alertId, signature)) return null;
  return alertId;
}

/**
 * Records the analytics attribution for an order: which wishlist or restock
 * touch led to each line, and how much revenue it carried.
 */
export async function attributeOrderLines({
  shopRecordId,
  order,
}: {
  shopRecordId: string;
  order: OrderPayload;
}): Promise<void> {
  const orderId = order?.id ? String(order.id) : null;
  if (!orderId) return;

  const items: LineItem[] = Array.isArray(order?.line_items) ? order.line_items : [];
  const lines: OrderLine[] = normalizeOrderLines(items).map((line, index) => ({
    ...line,
    restockAlertId: verifiedRestockAlertId(items[index] ?? {}),
  }));

  if (!lines.length) return;

  const customerId = order?.customer?.id ? String(order.customer.id) : null;
  const email = order?.email
    ? String(order.email).trim().toLowerCase()
    : null;
  const orderedAt = new Date(
    order?.processed_at || order?.created_at || Date.now(),
  );

  try {
    await attributeOrder({
      shopId: shopRecordId,
      orderId,
      orderNumber: String(order?.name || order?.order_number || orderId),
      orderEmail: email,
      customerId,
      shopperId: customerId,
      lines,
      orderedAt,
    });
  } catch (error) {
    // Attribution must never block the order from being processed.
    console.warn("Failed to record order attribution", error);
  }
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
