import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../lib/shop.server";
import db from "../db.server";

type CustomerPayload = Record<string, any>;

/**
 * `customers/update` webhook. When a guest shopper creates or logs into a
 * customer account, repoint their guest wishlist items, stock alerts, and
 * tracking events to the customer id so reports (especially 2.10 Guest-to-Customer
 * Conversion) stay accurate. Idempotent: updateMany is safe to replay.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let stage = "authentication";
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    stage = "customer-processing";

    const shopRecord = await getOrCreateShop(shop);
    const customer = payload as CustomerPayload;
    const customerId = customer?.id ? String(customer.id) : null;
    const email = customer?.email ? String(customer.email).trim().toLowerCase() : null;
    if (!customerId || !email) return new Response();

    // Repoint guest rows saved under this email/contact to the customer id.
    await db.$transaction([
      db.wishlistItem.updateMany({
        where: {
          shopId: shopRecord.id,
          customerId: null,
          guestToken: email,
        },
        data: { customerId, shopperId: customerId },
      }),
      db.stockAlert.updateMany({
        where: {
          shopId: shopRecord.id,
          customerId: null,
          contactKey: email,
        },
        data: { customerId, shopperId: customerId },
      }),
      db.trackingEvent.updateMany({
        where: {
          shopId: shopRecord.id,
          customerId: null,
          shopperId: email,
        },
        data: { customerId },
      }),
    ]);

    return new Response();
  } catch (err) {
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
