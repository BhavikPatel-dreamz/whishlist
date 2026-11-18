import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import db from "../../db.server";
import { withStoreAdmin } from "./store-resync.server";

type ResyncFn = (admin: any, shopId: string) => Promise<void>;

export function createResyncWebhookAction(label: string, resync: ResyncFn) {
  return async ({ request }: ActionFunctionArgs) => {
    try {
      const { shop, topic } = await authenticate.webhook(request);
      console.log(`Received ${topic} webhook for ${shop}`);
      await withStoreAdmin(shop, (admin, shopId) => resync(admin, shopId));
      return new Response();
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error(`${label} handler error`, error);
      return new Response(null, { status: 500 });
    }
  };
}

export function createDeleteWebhookAction(
  label: string,
  model: "storeLocation" | "storeMarket",
  field: "shopifyLocationId" | "shopifyMarketId",
  gidPrefix: "Location" | "Market",
) {
  return async ({ request }: ActionFunctionArgs) => {
    try {
      const { shop, topic, payload } = await authenticate.webhook(request);
      console.log(`Received ${topic} webhook for ${shop}`);
      const shopRecord = await db.shop.findUnique({ where: { shop } });
      if (!shopRecord) return new Response();
      const entityId =
        payload?.admin_graphql_api_id != null
          ? String(payload.admin_graphql_api_id)
          : payload?.id != null
            ? `gid://shopify/${gidPrefix}/${payload.id}`
            : null;
      if (entityId) {
        await (db as any)[model].deleteMany({
          where: { shopId: shopRecord.id, [field]: entityId },
        });
      }
      return new Response();
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error(`${label} handler error`, error);
      return new Response(null, { status: 500 });
    }
  };
}