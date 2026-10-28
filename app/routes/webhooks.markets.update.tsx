import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { withStoreAdmin } from "../lib/webhooks/store-resync.server";
import { resyncStoreMarkets } from "../models/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await withStoreAdmin(shop, (admin, shopId) => resyncStoreMarkets(admin, shopId));
    return new Response();
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("markets/update handler error", error);
    return new Response(null, { status: 500 });
  }
};
