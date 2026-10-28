import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { linkGuestIdentityToCustomer } from "../lib/webhooks/customers-identity.server";

/**
 * `customers/update` webhook. When a guest shopper creates or logs into a
 * customer account, repoint their guest wishlist items, stock alerts, and
 * tracking events to the customer id so reports stay accurate.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let stage = "authentication";
  try {
    const { shop, payload } = await authenticate.webhook(request);
    stage = "customer-processing";
    await linkGuestIdentityToCustomer(shop, payload as Record<string, unknown>);
    return new Response();
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("customers/update handler error", {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
};

export default function CustomersUpdateWebhook() {
  return null;
}
