import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { deliverCustomerDataRequest } from "../lib/privacy-data-request.server";
import { rethrowWebhookAuthResponse } from "../lib/webhooks/auth-response.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    console.log(`Received ${topic} webhook for ${shop}`);
    const shopRecord = await db.shop.findUnique({ where: { shop } });
    if (!shopRecord) return new Response();

    const { admin } = await unauthenticated.admin(shop);
    await deliverCustomerDataRequest(shopRecord, payload, admin);
    return new Response();
  } catch (error) {
    rethrowWebhookAuthResponse(error);
    console.error("customers/data_request handler error", error);
    return new Response(null, { status: 503 });
  }
};
