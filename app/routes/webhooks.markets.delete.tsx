import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    const store = await db.store.findUnique({ where: { shopDomain: shop } });
    if (!store) return new Response();
    const marketId =
      payload?.admin_graphql_api_id != null
        ? String(payload.admin_graphql_api_id)
        : payload?.id != null
          ? `gid://shopify/Market/${payload.id}`
          : null;
    if (marketId) {
      await db.storeMarket.deleteMany({
        where: { storeId: store.id, shopifyMarketId: marketId },
      });
    }
    return new Response();
  } catch (error) {
    console.error("markets/delete handler error", error);
    return new Response();
  }
};
