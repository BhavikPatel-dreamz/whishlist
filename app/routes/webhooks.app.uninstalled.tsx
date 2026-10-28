import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { invalidateShopCache } from "../lib/shop.server";
import { markStoreUninstalled } from "../models/store.server";
import { rethrowWebhookAuthResponse } from "../lib/webhooks/auth-response.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  try {
    console.log(`Received ${topic} webhook for ${shop}`);

    // Mark Shop inactive + install event (do not wipe wishlist/alert data yet —
    // shop/redact handles hard delete). Drop sessions; markStoreUninstalled clears token.
    await markStoreUninstalled(shop).catch((error) => {
      console.error("markStoreUninstalled failed", error);
    });

    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }
    invalidateShopCache(shop);

    return new Response();
  } catch (error) {
    rethrowWebhookAuthResponse(error);
    console.error("app/uninstalled handler error", error);
    return new Response(null, { status: 500 });
  }
};
