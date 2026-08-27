import db from "../db.server";

/**
 * Shopify guarantees at-least-once delivery and retries on any non-2xx, so every handler
 * records the X-Shopify-Webhook-Id it has already finished. The unique index does the work:
 * a duplicate insert throws, and we skip the payload.
 */
export async function claimWebhook(
  shopId: string,
  webhookId: string | null,
  topic: string,
): Promise<boolean> {
  if (!webhookId) return true; // nothing to de-duplicate against; process it
  try {
    await db.webhookEvent.create({ data: { shopId, webhookId, topic } });
    return true;
  } catch {
    return false;
  }
}

/** Drops webhook receipts older than 7 days; called opportunistically after processing. */
export async function pruneWebhookEvents(): Promise<void> {
  await db.webhookEvent.deleteMany({
    where: { processedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
}
