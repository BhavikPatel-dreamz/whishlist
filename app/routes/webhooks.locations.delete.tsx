import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    const store = await db.store.findUnique({ where: { shopDomain: shop } });
    if (!store) return new Response();
    const locationId =
      payload?.admin_graphql_api_id != null
        ? String(payload.admin_graphql_api_id)
        : payload?.id != null
          ? `gid://shopify/Location/${payload.id}`
          : null;
    if (locationId) {
      await db.storeLocation.deleteMany({
        where: { storeId: store.id, shopifyLocationId: locationId },
      });
    }
    return new Response();
  } catch (error) {
    console.error("locations/delete handler error", error);
    return new Response();
  }
};
