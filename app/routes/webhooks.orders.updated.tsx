import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/** Acknowledge `orders/updated` webhooks. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`[webhook:${topic}] received for ${shop}`);
    // TODO: handle order updates if needed.
    return new Response();
  } catch (err) {
    console.error("/webhooks/orders/updated handler error", err);
    return new Response(null, { status: 500 });
  }
};
