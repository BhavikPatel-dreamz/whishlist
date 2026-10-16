import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import db from "../db.server";
import { verifyPayloadSignature } from "../lib/crypto.server";
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
  if (!verifyPayloadSignature(id, signature)) {
    throw new Response("Invalid link", { status: 400 });
  }

  const alert = await db.stockAlert.findUnique({
    where: { id },
    include: { shop: { select: { shop: true } } },
  });
  if (!alert) throw new Response("Not found", { status: 404 });

  await markAlertConverted(id);

  const { admin } = await unauthenticated.admin(alert.shop.shop);
  const shopContext = await getShopContext(admin as never);
  return redirect(cartPermalink(shopContext.domain, alert.variantId));
};
