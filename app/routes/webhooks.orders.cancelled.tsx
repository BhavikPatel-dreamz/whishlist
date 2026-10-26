import type { ActionFunctionArgs } from "@remix-run/node";
import { getOrCreateShop } from "../lib/shop.server";
import { handleOrderWebhook } from "../lib/order-webhook.server";
import { revokeOrderAttribution } from "../models/attribution.server";

/**
 * `orders/cancelled` webhook. Removes the attribution rows for the cancelled
 * order so revenue reports stay correct. Idempotent: Shopify redelivers, and
 * `revokeOrderAttribution` is safe to replay (deleteMany is idempotent).
 */
export const action = async ({ request }: ActionFunctionArgs) =>
  handleOrderWebhook(request, "/webhooks/orders/cancelled", async ({
    shop,
    payload,
  }) => {
    const shopRecord = await getOrCreateShop(shop);
    const order = payload;
    const orderId = order?.id ? String(order.id) : null;
    if (!orderId) return;

    await revokeOrderAttribution({ shopId: shopRecord.id, orderId });
  });
