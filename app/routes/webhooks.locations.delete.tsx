import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    const shopRecord = await db.shop.findUnique({ where: { shop } });
    if (!shopRecord) return new Response();
    const locationId =
      payload?.admin_graphql_api_id != null
        ? String(payload.admin_graphql_api_id)
        : payload?.id != null
          ? `gid://shopify/Location/${payload.id}`
          : null;
    if (locationId) {
      await db.storeLocation.deleteMany({
        where: { shopId: shopRecord.id, shopifyLocationId: locationId },
      });
    }
    return new Response();
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("locations/delete handler error", error);
    return new Response(null, { status: 500 });
  }
};
