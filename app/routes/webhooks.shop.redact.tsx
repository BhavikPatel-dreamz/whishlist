import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { invalidateShopCache } from "../lib/shop.server";
import { redactShopData } from "../models/store.server";
import { rethrowWebhookAuthResponse } from "../lib/webhooks/auth-response.server";

/** Mandatory GDPR webhook: delete all data for the shop. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  try {
    console.log(`Received ${topic} webhook for ${shop}`);
    await redactShopData(shop);
    invalidateShopCache(shop);
    return new Response();
  } catch (error) {
    rethrowWebhookAuthResponse(error);
    console.error("shop/redact handler error", error);
    return new Response(null, { status: 500 });
  }
};
