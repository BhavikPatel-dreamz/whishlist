import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/** Acknowledge `orders/paid` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`[webhook:${topic}] received for ${shop}`);
    // TODO: process paid orders if needed. For now, just ack so Shopify stops retrying.
    return new Response();
  } catch (err) {
    console.error("/webhooks/orders/paid handler error", err);
    return new Response(null, { status: 500 });
  }
};
