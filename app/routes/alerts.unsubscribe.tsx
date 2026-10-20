import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import db from "../db.server";
import { requireSignedAlertLink } from "../lib/stock-alert-links.server";
import { cancelStockAlert } from "../models/stock-alert.server";
import { AlertLandingBody, AlertLandingHeading, AlertLandingShell } from "../components/AlertLanding";

/** One-click unsubscribe target linked from every notification email. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const signature = url.searchParams.get("sig") || "";
  requireSignedAlertLink(id, signature, "Invalid unsubscribe link");

  const alert = await db.stockAlert.findUnique({
    where: { id },
    select: { email: true, phone: true, channel: true, productTitle: true },
  });
  if (!alert) throw new Response("Not found", { status: 404 });

  await cancelStockAlert(id);
  return {
    contact: alert.channel === "sms" ? alert.phone : alert.email,
    channel: alert.channel,
    productTitle: alert.productTitle,
  };
};

export default function Unsubscribed() {
  const { contact, channel, productTitle } = useLoaderData<typeof loader>();
  return (
    <AlertLandingShell>
      <AlertLandingHeading>You're unsubscribed</AlertLandingHeading>
      <AlertLandingBody>
        {contact} will no longer receive back-in-stock {channel === "sms" ? "texts" : "emails"}
        {productTitle ? ` for ${productTitle}` : ""}.
      </AlertLandingBody>
    </AlertLandingShell>
  );
}
