import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateShop } from "../lib/shop.server";
import { rethrowWebhookAuthResponse } from "../lib/webhooks/auth-response.server";

/**
 * Mandatory GDPR webhook: remove customer-linked rows we store for this shop.
 * Counts-only StoreStats are kept; no customer PII lives there.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  try {
    console.log(`Received ${topic} webhook for ${shop}`);

    const customerId = payload?.customer?.id != null ? String(payload.customer.id) : null;
    const email =
      typeof payload?.customer?.email === "string"
        ? payload.customer.email.trim().toLowerCase()
        : null;
    if (!customerId && !email) return new Response();

    const shopRecord = await getOrCreateShop(shop);
    const orWishlist = [
      ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
      ...(email ? [{ guestToken: email }, { shopperId: email }] : []),
    ];
    const orAlerts = [
      ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
      ...(email
        ? [{ email }, { contactKey: `email:${email}` }, { contactKey: email }]
        : []),
    ];

    await db.$transaction([
      db.wishlistItem.deleteMany({
        where: { shopId: shopRecord.id, OR: orWishlist },
      }),
      db.stockAlert.deleteMany({
        where: { shopId: shopRecord.id, OR: orAlerts },
      }),
      db.trackingEvent.deleteMany({
        where: {
          shopId: shopRecord.id,
          OR: [
            ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
            ...(email ? [{ shopperId: email }] : []),
          ],
        },
      }),
      db.notificationLog.deleteMany({
        where: {
          shopId: shopRecord.id,
          ...(customerId || email
            ? { shopperId: { in: [customerId, email].filter(Boolean) as string[] } }
            : {}),
        },
      }),
    ]);

    return new Response();
  } catch (error) {
    rethrowWebhookAuthResponse(error);
    console.error("customers/redact handler error", error);
    return new Response(null, { status: 500 });
  }
};
