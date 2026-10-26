import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../lib/shop.server";
import { revokeOrderAttribution } from "../models/attribution.server";

type RefundPayload = Record<string, any>;

/**
 * `refunds/create` webhook. Scales down (or removes) the attribution revenue
 * for the refunded order so revenue reports stay correct. Idempotent: Shopify
 * redelivers, and revokeOrderAttribution is safe to replay.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let stage = "authentication";
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    stage = "refund-processing";

    const shopRecord = await getOrCreateShop(shop);
    const refund = payload as RefundPayload;
    const orderId = refund?.order_id ? String(refund.order_id) : null;
    if (!orderId) return new Response();

    const refundAmount = Number(
      refund?.refund?.transactions?.[0]?.amount ?? 0,
    );
    await revokeOrderAttribution({
      shopId: shopRecord.id,
      orderId,
      revenue: refundAmount > 0 ? refundAmount : undefined,
    });

    return new Response();
  } catch (err) {
    console.error("refunds/create handler error", {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
};

export default function RefundsCreateWebhook() {
  return null;
}
