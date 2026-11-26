import type { Shop } from "@prisma/client";
import db from "../db.server";
import type { GraphqlClient } from "./graphql.server";
import { readCustomerWishlistMetafield } from "./privacy-shopify.server";
import { resolveSettingsForPlan } from "./shop.server";
import { managedMailgunConfigured } from "./notifications/managed-mailgun.server";
import { sendEmail } from "./notifications/providers.server";

type CustomerDataRequest = {
  customer?: {
    id?: string | number | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  data_request?: { id?: string | number | null } | null;
  orders_requested?: Array<string | number> | null;
};

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase() || null;
}

function normalizedPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/[^\d+]/g, "") || null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

/** Deliver the app's stored customer data to the merchant contact from Shopify. */
export async function deliverCustomerDataRequest(
  shop: Shop,
  payload: CustomerDataRequest,
  admin: GraphqlClient,
): Promise<void> {
  const customerId = payload.customer?.id != null ? String(payload.customer.id) : null;
  const email = normalizedEmail(payload.customer?.email);
  const phone = normalizedPhone(payload.customer?.phone);
  const orderIds = [...new Set(
    (payload.orders_requested ?? [])
      .filter((id) => typeof id === "string" || typeof id === "number")
      .map((id) => String(id)),
  )];
  const merchantEmail = normalizedEmail(shop.contactEmail) ?? normalizedEmail(shop.email);

  if (!merchantEmail) {
    throw new Error("Customer data request cannot be delivered: shop contact email is missing");
  }
  if (!managedMailgunConfigured()) {
    throw new Error("Customer data request cannot be delivered: managed email is not configured");
  }

  const identities = [...new Set([
    customerId,
    email,
    phone,
    ...(email ? [`email:${email}`] : []),
    ...(phone ? [`sms:${phone}`, `whatsapp:${phone}`] : []),
  ].filter((value): value is string => Boolean(value)))];
  const customerFilters = [
    ...(customerId ? [{ customerId }] : []),
    ...(email ? [{ guestToken: email }, { shopperId: email }] : []),
  ];
  const alertFilters = [
    ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
    ...(email ? [{ email }, { contactKey: `email:${email}` }, { contactKey: email }] : []),
    ...(phone ? [{ phone }, { contactKey: `sms:${phone}` }, { contactKey: `whatsapp:${phone}` }] : []),
  ];
  const eventFilters = [
    ...(customerId ? [{ customerId }, { shopperId: customerId }] : []),
    ...identities.map((shopperId) => ({ shopperId })),
  ];
  const orderFilters = [
    ...(customerId ? [{ customerId }] : []),
    ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
  ];

  const customerMetafield = await readCustomerWishlistMetafield(admin, {
    customerId,
    email,
    phone,
  });

  const [wishlistItems, wishlistEvents, stockAlerts, trackingEvents, notificationLogs,
    wishlistShares, wishlistLists, orders, wishlistOrders, attributions] = await Promise.all([
    customerFilters.length
      ? db.wishlistItem.findMany({ where: { shopId: shop.id, OR: customerFilters } })
      : Promise.resolve([]),
    customerId || email
      ? db.wishlistEvent.findMany({
          where: {
            shopId: shop.id,
            OR: [
              ...(customerId ? [{ customerId }] : []),
              ...(email ? [{ guestToken: email }] : []),
            ],
          },
        })
      : Promise.resolve([]),
    alertFilters.length
      ? db.stockAlert.findMany({ where: { shopId: shop.id, OR: alertFilters } })
      : Promise.resolve([]),
    eventFilters.length
      ? db.trackingEvent.findMany({ where: { shopId: shop.id, OR: eventFilters } })
      : Promise.resolve([]),
    identities.length
      ? db.notificationLog.findMany({
          where: { shopId: shop.id, shopperId: { in: identities } },
        })
      : Promise.resolve([]),
    customerId
      ? db.wishlistShare.findMany({ where: { shopId: shop.id, customerId } })
      : Promise.resolve([]),
    customerId || email
      ? db.wishlistList.findMany({
          where: {
            shopId: shop.id,
            owner: {
              in: [
                ...(customerId ? [`customer:${customerId}`] : []),
                ...(email ? [`guest:${email}`] : []),
              ],
            },
          },
        })
      : Promise.resolve([]),
    orderFilters.length
      ? db.shopifyOrderRecord.findMany({
          where: { shopId: shop.id, OR: orderFilters },
          include: { lines: true },
        })
      : Promise.resolve([]),
    orderIds.length
      ? db.wishlistOrder.findMany({
          where: { shopId: shop.id, orderId: { in: orderIds } },
        })
      : Promise.resolve([]),
    customerId || identities.length || orderIds.length
      ? db.attribution.findMany({
          where: {
            shopId: shop.id,
            OR: [
              ...(customerId ? [{ customerId }] : []),
              ...(identities.length ? [{ shopperId: { in: identities } }] : []),
              ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
            ],
          },
        })
      : Promise.resolve([]),
  ]);

  const requestId = payload.data_request?.id == null
    ? "not supplied"
    : String(payload.data_request.id);
  const report = {
    requestId,
    shop: shop.shop,
    customer: { id: customerId, email, phone },
    requestedOrderIds: orderIds,
    shopifyCustomerWishlistMetafield: customerMetafield,
    data: {
      wishlistItems,
      wishlistEvents,
      stockAlerts,
      trackingEvents,
      notificationLogs,
      wishlistShares,
      wishlistLists,
      orders,
      wishlistOrders,
      attributions,
    },
  };
  const json = JSON.stringify(report, null, 2);
  const settings = resolveSettingsForPlan(shop, { allowMerchantProvider: false });
  const result = await sendEmail(settings, {
    to: merchantEmail,
    subject: `Customer data request ${requestId} — ${shop.shop}`,
    text: `Shopify customer data request ${requestId} for ${shop.shop}.\n\n${json}`,
    html: `<p>Shopify customer data request ${escapeHtml(requestId)} for ${escapeHtml(shop.shop)}.</p><pre>${escapeHtml(json)}</pre>`,
  });

  if (!result.ok) {
    throw new Error(`Customer data request email failed: ${result.error}`);
  }
}
