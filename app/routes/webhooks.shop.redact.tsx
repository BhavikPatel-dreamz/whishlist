import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { invalidateShopCache } from "../lib/shop.server";
import { redactShopData } from "../models/store.server";

/** Mandatory GDPR webhook: delete all data for the shop. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await redactShopData(shop);
    invalidateShopCache(shop);
    return new Response();
  } catch (error) {
    console.error("shop/redact handler error", error);
    return new Response();
  }
};
