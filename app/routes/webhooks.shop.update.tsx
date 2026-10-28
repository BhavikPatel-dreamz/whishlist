import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { applyShopUpdateWebhook } from "../models/store.server";
import { rethrowWebhookAuthResponse } from "../lib/webhooks/auth-response.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    console.log(`Received ${topic} webhook for ${shop}`);
    await applyShopUpdateWebhook(shop, (payload || {}) as Record<string, unknown>);
    return new Response();
  } catch (error) {
    rethrowWebhookAuthResponse(error);
    console.error("shop/update handler error", error);
    return new Response(null, { status: 500 });
  }
};
