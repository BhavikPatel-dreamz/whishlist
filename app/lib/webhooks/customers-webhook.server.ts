import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { linkGuestIdentityToCustomer } from "./customers-identity.server";

/**
 * Shared `customers/create` + `customers/update` webhook action. When a guest
 * shopper creates or logs into a customer account, repoint their guest
 * wishlist items, stock alerts, and tracking events to the customer id so
 * reports stay accurate.
 */
export async function customersWebhookAction({ request }: ActionFunctionArgs) {
  let stage = "authentication";
  try {
    const { shop, payload } = await authenticate.webhook(request);
    stage = "customer-processing";
    await linkGuestIdentityToCustomer(shop, payload as Record<string, unknown>);
    return new Response();
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("customers webhook handler error", {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
}
