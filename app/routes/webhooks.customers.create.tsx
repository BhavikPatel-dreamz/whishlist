import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { linkGuestIdentityToCustomer } from "../lib/webhooks/customers-identity.server";

/**
 * `customers/create` webhook. Same guest→customer identity link as update,
 * so wishlists and stock alerts attach as soon as the account is created.
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
    console.error("customers/create handler error", {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
};

export default function CustomersCreateWebhook() {
  return null;
}
