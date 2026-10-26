/**
 * Storefront tracking endpoint (ANALYTICS_REPORTS_SPEC.md section 5).
 *
 * `POST /apps/<proxy>/track` — append-only event ingestion from the storefront.
 * Responds quickly and queues heavy upserts so the storefront is never blocked.
 *
 * Body (JSON):
 *   {
 *     "event": "PRODUCT_VIEW" | "WISHLIST_SAVE" | ...,
 *     "shopperId": string,              // customerId when logged in, else device id
 *     "customerId": string | null,      // Shopify customer id when known
 *     "productId": string | null,
 *     "variantId": string | null,
 *     "channel": string | null,         // share channel: link | email | social
 *     "source": string | null,          // pdp | collection | search | cart | other
 *     "device": string | null,          // desktop | mobile | tablet
 *     "meta": Record<string, unknown> | null
 *   }
 *
 * Idempotency: WISHLIST_SAVE upserts WishlistItem (unique on customer/guest + product + variant).
 * ALERT_SUBSCRIBE creates StockSubscription (unique on variant+contact).
 * WISHLIST_REMOVE records a WishlistEvent audit row instead of mutating the saved row.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { withProxy } from "../lib/proxy-route.server";
import { readBody, numericId, ProxyError } from "../lib/proxy.server";
import { requireIdentity } from "../models/wishlist.server";
import db from "../db.server";
import { Prisma } from "@prisma/client";

type TrackBody = {
  event?: string;
  shopperId?: string | null;
  customerId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  channel?: string | null;
  source?: string | null;
  device?: string | null;
  meta?: Record<string, unknown> | null;
};

const VALID_EVENTS = new Set([
  "PRODUCT_VIEW",
  "WISHLIST_SAVE",
  "WISHLIST_REMOVE",
  "WISHLIST_ADD_TO_CART",
  "WISHLIST_SHARE",
  "WISHLIST_SHARE_VISIT",
  "ALERT_FORM_VIEW",
  "ALERT_SUBSCRIBE",
  "NOTIFICATION_CLICK",
]);

/**
 * When a guest logs in or checks out, merge their guest rows into the customer
 * record: repoint WishlistItem, StockAlert, and TrackingEvent to the customer id.
 * Feeds report 2.10 (Guest-to-Customer Conversion).
 */
async function mergeGuestToCustomer({
  shopId,
  shopperId,
  customerId,
}: {
  shopId: string;
  shopperId: string;
  customerId: string;
}): Promise<void> {
  if (shopperId === customerId) return;

  await db.$transaction([
    db.wishlistItem.updateMany({
      where: { shopId, shopperId, customerId: null },
      data: { customerId, shopperId: customerId },
    }),
    db.stockAlert.updateMany({
      where: { shopId, shopperId, customerId: null },
      data: { customerId, shopperId: customerId },
    }),
    db.trackingEvent.updateMany({
      where: { shopId, shopperId, customerId: null },
      data: { customerId },
    }),
  ]);
}

export const action = async ({ request }: ActionFunctionArgs) =>
  withProxy(request, null, async (ctx) => {
    const body = (await readBody(request)) as TrackBody;
    const event = body.event;
    if (!event || !VALID_EVENTS.has(event)) {
      throw new ProxyError(400, "missing or invalid event", "bad_event");
    }

    // Resolve shopper: customerId when logged in, else the device id from the body.
    const customerId = body.customerId ?? ctx.loggedInCustomerId ?? null;
    const shopperId = body.shopperId || (customerId || "guest");
    const productId = numericId(body.productId) ?? null;
    const variantId = numericId(body.variantId) ?? null;

    // 1. Always append the event (append-only log).
    const trackingEvent = await db.trackingEvent.create({
      data: {
        shopId: ctx.shop.id,
        shopperId,
        customerId: customerId ?? undefined,
        type: event as any,
        productId: productId ?? undefined,
        variantId: variantId ?? undefined,
        channel: body.channel ?? undefined,
        source: body.source ?? undefined,
        device: body.device ?? undefined,
        meta: (body.meta ?? null) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // 2. Event-specific side effects.
    if (event === "WISHLIST_SAVE") {
      const { customerId: cid, guestToken: gt } = requireIdentity({
        customerId,
        guestToken: customerId ? null : shopperId,
      });

      if (cid) {
        // Logged-in customer: unique key is (shopId, customerId, productId, variantId).
        await db.wishlistItem.upsert({
          where: {
            customer_product: {
              shopId: ctx.shop.id,
              customerId: cid,
              productId: productId ?? "",
              variantId: variantId as string,
            },
          },
          update: {
            shopperId: cid,
            source: body.source ?? undefined,
            device: body.device ?? undefined,
          },
          create: {
            shopId: ctx.shop.id,
            customerId: cid,
            guestToken: null,
            productId: productId ?? "",
            variantId: variantId ?? undefined,
            source: body.source ?? null,
            device: body.device ?? null,
            shopperId: cid,
          },
        });

        // Merge any guest rows saved under the device id into this customer.
        if (shopperId && shopperId !== cid) {
          mergeGuestToCustomer({
            shopId: ctx.shop.id,
            shopperId,
            customerId: cid,
          }).catch((err) => console.warn("[track] guest merge failed", err));
        }
      } else {
        // Guest: unique key is (shopId, guestToken, productId, variantId).
        await db.wishlistItem.upsert({
          where: {
            guest_product: {
              shopId: ctx.shop.id,
              guestToken: gt ?? "",
              productId: productId ?? "",
              variantId: variantId as string,
            },
          },
          update: {
            source: body.source ?? undefined,
            device: body.device ?? undefined,
          },
          create: {
            shopId: ctx.shop.id,
            customerId: null,
            guestToken: gt,
            productId: productId ?? "",
            variantId: variantId ?? undefined,
            source: body.source ?? null,
            device: body.device ?? null,
            shopperId: gt ?? shopperId,
          },
        });
      }
    }

    if (event === "WISHLIST_REMOVE") {
      // Record an audit row so all-time reports can still show products that were
      // wishlisted in the past even after the saved row is gone.
      await db.wishlistEvent.create({
        data: {
          shopId: ctx.shop.id,
          productId: productId ?? "",
          variantId: variantId ?? undefined,
          customerId: customerId ?? undefined,
          guestToken: customerId ? null : shopperId,
          type: "remove",
        },
      });
    }

    if (event === "ALERT_SUBSCRIBE") {
      const contact = body.channel ?? body.source ?? "";
      if (!contact) {
        throw new ProxyError(422, "alert subscribe needs a contact", "missing_contact");
      }
      await db.stockAlert.upsert({
        where: {
          one_alert_per_contact_variant: {
            shopId: ctx.shop.id,
            variantId: variantId ?? "",
            contactKey: contact,
          },
        },
        update: {
          status: "PENDING",
          source: body.source ?? undefined,
          device: body.device ?? undefined,
        },
        create: {
          shopId: ctx.shop.id,
          customerId: customerId ?? null,
          email: contact.includes("@") ? contact : null,
          phone: contact.includes("@") ? null : contact,
          channel: "email",
          contactKey: contact,
          productId: productId ?? "",
          variantId: variantId ?? "",
          source: body.source ?? null,
          device: body.device ?? null,
          shopperId,
          confirmed: true,
          pendingReason: "out_of_stock",
        },
      });
    }

    return json({ ok: true, eventId: trackingEvent.id }, { status: 200 });
  });

export default function TrackApi() {
  return null;
}
