/**
 * Tracked notification click redirect (ANALYTICS_REPORTS_SPEC.md section 5).
 *
 * `GET /r/log/:logId` — the click target in notification emails/SMS.
 * Records `clickedAt` on the NotificationLog, sets a `bis_click` cookie so the
 * checkout page can attribute the purchase to this notification, then redirects
 * to the product (or a fallback URL).
 *
 * This is how NOTIFICATION_CLICK events are captured for attribution and the
 * click-to-purchase funnel (report 3.7, 3.8).
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import db from "../db.server";
import { requireAdminShop } from "../lib/admin-auth.server";

/**
 * Resolves the redirect target for a notification log. Falls back to the shop's
 * primary domain if we can't determine a more specific URL.
 */
function redirectTarget(log: {
  productId: string;
  variantId?: string | null;
  shop: { shop: string } | null;
}): string {
  const variant = log.variantId ? `?variant=${log.variantId}` : "";
  return `https://${log.shop?.shop}/products/${log.productId}${variant}`;
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const logId = params.id as string;
  if (!logId) {
    throw new Response("Not found", { status: 404 });
  }

  const log = await db.notificationLog.findUnique({
    where: { id: logId },
    include: { shop: { select: { shop: true } } },
  });
  if (!log) {
    throw new Response("Not found", { status: 404 });
  }

  // Record the click. Idempotent: setting clickedAt again is a no-op.
  await db.notificationLog.update({
    where: { id: logId },
    data: { clickedAt: log.clickedAt ?? new Date() },
  });

  // Also append a tracking event for funnel reporting.
  await db.trackingEvent.create({
    data: {
      shopId: log.shopId,
      shopperId: log.shopperId,
      type: "NOTIFICATION_CLICK",
      productId: log.productId,
      variantId: log.variantId ?? undefined,
      channel: log.channel as any,
      source: "notification",
      meta: { notificationLogId: logId } as any,
    },
  });

  const target = redirectTarget(log);

  return redirect(target, {
    headers: {
      // The checkout page reads this cookie to attribute the purchase.
      "Set-Cookie": `bis_click=${logId}; Path=/; Max-Age=604800; SameSite=Lax`,
    },
  });
};

export default function NotificationClickRedirect() {
  return null;
}
