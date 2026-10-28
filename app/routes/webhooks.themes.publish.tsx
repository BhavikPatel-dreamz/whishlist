import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { withStoreAdmin } from "../lib/webhooks/store-resync.server";
import { resyncStoreThemes } from "../models/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await withStoreAdmin(shop, (admin, shopId) => resyncStoreThemes(admin, shopId));
    return new Response();
  } catch (error) {
    console.error("themes/publish handler error", error);
    return new Response();
  }
};
