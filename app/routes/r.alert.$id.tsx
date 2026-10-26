import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import db from "../db.server";
import { requireSignedAlertLink } from "../lib/stock-alert-links.server";
import { unauthenticated } from "../shopify.server";
import { cartPermalink } from "../lib/notifications/dispatch.server";
import { getShopContext } from "../lib/shopify-data.server";
import { markAlertConverted } from "../models/stock-alert.server";

/**
 * Click target for the button inside back-in-stock emails.
 * Records the click (the "converted alerts" KPI) and forwards to a cart permalink.
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id as string;
  const signature = new URL(request.url).searchParams.get("sig") || "";
  requireSignedAlertLink(id, signature, "Invalid link");

  const alert = await db.stockAlert.findUnique({
    where: { id },
    include: { shop: { select: { shop: true } } },
  });
  if (!alert) throw new Response("Not found", { status: 404 });

  const notification = await db.notificationLog.findFirst({
    where: { shopId: alert.shopId, subscriptionId: id, sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { id: true, clickedAt: true },
  });
  if (notification && !notification.clickedAt) {
    await db.notificationLog.update({
      where: { id: notification.id },
      data: { clickedAt: new Date() },
    });
  }
  await db.trackingEvent.create({
    data: {
      shopId: alert.shopId,
      shopperId: alert.shopperId ?? alert.customerId ?? alert.contactKey,
      type: "NOTIFICATION_CLICK",
      productId: alert.productId,
      variantId: alert.variantId,
      channel: alert.channel.toUpperCase(),
      source: "notification",
      meta: notification ? { notificationLogId: notification.id } : undefined,
    },
  });

  await markAlertConverted(id);

  const { admin } = await unauthenticated.admin(alert.shop.shop);
  const shopContext = await getShopContext(admin as never);
  return redirect(cartPermalink(shopContext.domain, alert.variantId, alert.id));
};
