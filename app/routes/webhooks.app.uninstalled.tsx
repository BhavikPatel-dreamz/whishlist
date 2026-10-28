import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { invalidateShopCache } from "../lib/shop.server";
import { markStoreUninstalled } from "../models/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, session, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // Mark Store inactive + install event (do not wipe wishlist/alert data yet —
    // shop/redact handles hard delete). Drop sessions and clear operational token.
    await markStoreUninstalled(shop).catch((error) => {
      console.error("markStoreUninstalled failed", error);
    });

    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }
    await db.shop.updateMany({ where: { shop }, data: { accessToken: null } });
    invalidateShopCache(shop);

    return new Response();
  } catch (error) {
    console.error("app/uninstalled handler error", error);
    return new Response();
  }
};
