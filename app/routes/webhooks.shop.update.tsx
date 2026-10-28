import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { applyShopUpdateWebhook } from "../models/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await applyShopUpdateWebhook(shop, (payload || {}) as Record<string, unknown>);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("shop/update handler error", error);
    return new Response(null, { status: 200 });
  }
};
