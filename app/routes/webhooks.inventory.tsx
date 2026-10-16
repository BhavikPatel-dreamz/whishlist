import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { claimWebhook, pruneWebhookEvents } from "../lib/webhook-events.server";
import { getOrCreateShop } from "../lib/shop.server";
import { dispatchRestockAlerts } from "../lib/notifications/dispatch.server";
import { getShopContext, getVariantByInventoryItem } from "../lib/shopify-data.server";
import { ALERT_STATUS } from "../models/stock-alert.server";
import { pruneRateLimits } from "../lib/rate-limit.server";

type InventoryLevelPayload = {
  inventory_item_id?: number | string;
  location_id?: number | string;
  available?: number | null;
};

/**
 * `inventory_levels/update` — the restock trigger.
 *
 * Shopify fires this for every stock movement, including sales, and redelivers on failure.
 * Webhook receipts skip repeated deliveries; the atomic per-alert claim inside
 * `dispatchRestockAlerts` protects against concurrent duplicate notifications.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin, session } = await authenticate.webhook(request);

  if (!admin || !session) {
    // App was uninstalled between delivery attempts — ack so Shopify stops retrying.
    return new Response();
  }

  const shopRecord = await getOrCreateShop(shop);
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!(await claimWebhook(shopRecord.id, webhookId, topic))) return new Response();

  try {
    const level = payload as InventoryLevelPayload;
    const inventoryItemId = level.inventory_item_id ? String(level.inventory_item_id) : null;
    const available = Number(level.available ?? 0);

    if (!inventoryItemId || available <= 0) {
      return new Response();
    }

    // Cheapest possible short-circuit: most stores have no one waiting most of the time.
    const waitingStatuses = shopRecord.doubleOptIn
      ? [ALERT_STATUS.pending, ALERT_STATUS.confirmed]
      : [ALERT_STATUS.pending];
    const waiting = await db.stockAlert.count({
      where: { shopId: shopRecord.id, status: { in: waitingStatuses } },
    });
    if (waiting === 0) return new Response();

    const variant = await getVariantByInventoryItem(admin, inventoryItemId);
    if (!variant) return new Response();

    const pendingForVariant = await db.stockAlert.count({
      where: {
        shopId: shopRecord.id,
        variantId: variant.variantId,
        status: { in: waitingStatuses },
      },
    });
    if (pendingForVariant === 0) return new Response();

    const shopContext = await getShopContext(admin);
    const result = await dispatchRestockAlerts({ shop: shopRecord, variant, shopContext });
    console.log(
      `[${topic}] ${shop} variant ${variant.variantId}: claimed=${result.claimed} sent=${result.sent} failed=${result.failed}${
        result.skippedReason ? ` (${result.skippedReason})` : ""
      }`,
    );
  } catch (error) {
    console.error(`[${topic}] ${shop} processing failed`, error);
    // Release the receipt so a redelivery can retry processing.
    if (webhookId) {
      await db.webhookEvent
        .deleteMany({ where: { shopId: shopRecord.id, webhookId } })
        .catch(() => {});
    }
    return new Response("Processing failed", { status: 500 });
  }

  // Opportunistically prune old receipts and expired rate-limit buckets.
  if (Math.random() < 0.02) {
    await Promise.all([pruneWebhookEvents(), pruneRateLimits()]).catch(() => {});
  }

  return new Response();
};
