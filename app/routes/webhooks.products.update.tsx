import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateShop } from "../lib/shop.server";
import { claimWebhook } from "../lib/webhook-events.server";
import { dispatchRestockAlerts } from "../lib/notifications/dispatch.server";
import { getShopContext, getVariantsByIds } from "../lib/shopify-data.server";
import { ALERT_STATUS } from "../models/stock-alert.server";

type ProductPayload = {
  id?: number | string;
  status?: string;
  variants?: Array<{ id?: number | string; inventory_quantity?: number; inventory_policy?: string }>;
};

/**
 * `products/update` — the safety net.
 *
 * Some restocks never move an inventory level: a variant switches to "continue selling
 * when out of stock", a draft product goes active, or a variant is recreated. This handler
 * catches those. It shares the same atomic claim as the inventory handler, so overlapping
 * events for one restock still send exactly one email per subscriber.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin, session } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  if (!admin || !session) return new Response();

  const shopRecord = await getOrCreateShop(shop);
  if (!(await claimWebhook(shopRecord.id, webhookId, topic))) return new Response();

  const product = payload as ProductPayload;
  const productId = product.id ? String(product.id) : null;
  if (!productId || product.status !== "active") return new Response();

  const waitingStatuses = shopRecord.doubleOptIn
    ? [ALERT_STATUS.pending, ALERT_STATUS.confirmed]
    : [ALERT_STATUS.pending];
  const pending = await db.stockAlert.findMany({
    where: { shopId: shopRecord.id, productId, status: { in: waitingStatuses } },
    select: { variantId: true },
    distinct: ["variantId"],
  });
  if (!pending.length) return new Response();

  const waitingVariantIds = new Set(pending.map((row) => row.variantId));
  const candidates = (product.variants || [])
    .map((variant) => (variant.id ? String(variant.id) : null))
    .filter((id): id is string => Boolean(id) && waitingVariantIds.has(id as string));
  if (!candidates.length) return new Response();

  try {
    const variants = await getVariantsByIds(admin, candidates);
    // Online-channel availability, matching the storefront — see dispatch.server.ts.
    const purchasable = variants.filter((v) => v.availableForSale && v.sellableOnlineQuantity > 0);
    if (!purchasable.length) return new Response();

    const shopContext = await getShopContext(admin);
    for (const variant of purchasable) {
      const result = await dispatchRestockAlerts({ shop: shopRecord, variant, shopContext });
      if (result.claimed) {
        console.log(
          `[${topic}] ${shop} variant ${variant.variantId}: sent=${result.sent} failed=${result.failed}`,
        );
      }
    }
  } catch (error) {
    console.error(`[${topic}] ${shop} processing failed`, error);
    if (webhookId) {
      await db.webhookEvent
        .deleteMany({ where: { shopId: shopRecord.id, webhookId } })
        .catch(() => {});
    }
    return new Response("Processing failed", { status: 500 });
  }

  return new Response();
};
