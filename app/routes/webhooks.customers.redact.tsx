import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { rethrowWebhookAuthResponse } from "../lib/webhooks/auth-response.server";
import { deleteCustomerWishlistMetafield } from "../lib/privacy-shopify.server";

/**
 * Mandatory GDPR webhook: remove customer-linked rows and requested orders.
 * Counts-only StoreStats are kept; no customer PII lives there.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  try {
    console.log(`Received ${topic} webhook for ${shop}`);

    const customerId = payload?.customer?.id != null ? String(payload.customer.id) : null;
    const email =
      typeof payload?.customer?.email === "string"
        ? payload.customer.email.trim().toLowerCase() || null
        : null;
    const phone =
      typeof payload?.customer?.phone === "string"
        ? payload.customer.phone.replace(/[^\d+]/g, "") || null
        : null;
    const orderIds = Array.isArray(payload?.orders_to_redact)
      ? payload.orders_to_redact
          .filter((id: unknown) => typeof id === "string" || typeof id === "number")
          .map((id: string | number) => String(id))
      : [];
    if (!customerId && !email && !phone && orderIds.length === 0) return new Response();

    const shopRecord = await db.shop.findUnique({ where: { shop } });
    if (!shopRecord) return new Response();
    const { admin } = await unauthenticated.admin(shop);
    await deleteCustomerWishlistMetafield(admin, { customerId, email, phone });
    const identities = [
      ...new Set(
        [
          customerId,
          email,
          phone,
          ...(email ? [`email:${email}`] : []),
          ...(phone ? [`sms:${phone}`, `whatsapp:${phone}`] : []),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const orWishlist = [
      ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
      ...(email ? [{ guestToken: email }, { shopperId: email }] : []),
    ];
    const orAlerts = [
      ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
      ...(email
        ? [{ email }, { contactKey: `email:${email}` }, { contactKey: email }]
        : []),
      ...(phone
        ? [{ phone }, { contactKey: `sms:${phone}` }, { contactKey: `whatsapp:${phone}` }]
        : []),
    ];

    await db.$transaction(async (tx) => {
      if (orWishlist.length) {
        await tx.wishlistItem.deleteMany({
          where: { shopId: shopRecord.id, OR: orWishlist },
        });
      }
      if (orAlerts.length) {
        await tx.stockAlert.deleteMany({
          where: { shopId: shopRecord.id, OR: orAlerts },
        });
      }

      const eventIdentities = [
        ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
        ...identities.map((shopperId) => ({ shopperId })),
      ];
      if (eventIdentities.length) {
        await tx.trackingEvent.deleteMany({
          where: { shopId: shopRecord.id, OR: eventIdentities },
        });
      }
      if (identities.length) {
        await tx.notificationLog.deleteMany({
          where: { shopId: shopRecord.id, shopperId: { in: identities } },
        });
      }

      const wishlistEventMatches = [
        ...(customerId ? [{ customerId }] : []),
        ...(email ? [{ guestToken: email }] : []),
      ];
      if (wishlistEventMatches.length) {
        await tx.wishlistEvent.deleteMany({
          where: { shopId: shopRecord.id, OR: wishlistEventMatches },
        });
      }
      if (customerId) {
        await tx.wishlistShare.deleteMany({
          where: { shopId: shopRecord.id, customerId },
        });
      }

      const listOwners = [
        ...(customerId ? [`customer:${customerId}`] : []),
        ...(email ? [`guest:${email}`] : []),
      ];
      if (listOwners.length) {
        await tx.wishlistList.deleteMany({
          where: { shopId: shopRecord.id, owner: { in: listOwners } },
        });
      }

      const orderMatches = [
        ...(customerId ? [{ customerId }] : []),
        ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
      ];
      if (orderMatches.length) {
        await tx.shopifyOrderRecord.deleteMany({
          where: { shopId: shopRecord.id, OR: orderMatches },
        });
      }
      if (orderIds.length) {
        await tx.wishlistOrder.deleteMany({
          where: { shopId: shopRecord.id, orderId: { in: orderIds } },
        });
      }

      const attributionMatches = [
        ...(customerId ? [{ customerId }] : []),
        ...(identities.length ? [{ shopperId: { in: identities } }] : []),
        ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
      ];
      if (attributionMatches.length) {
        await tx.attribution.deleteMany({
          where: { shopId: shopRecord.id, OR: attributionMatches },
        });
      }
    });

    return new Response();
  } catch (error) {
    rethrowWebhookAuthResponse(error);
    console.error("customers/redact handler error", error);
    return new Response(null, { status: 500 });
  }
};
