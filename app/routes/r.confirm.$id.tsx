import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import db from "../db.server";
import { requireSignedAlertLink } from "../lib/stock-alert-links.server";
import { confirmStockAlert } from "../models/stock-alert.server";
import { AlertLandingBody, AlertLandingHeading, AlertLandingShell } from "../components/AlertLanding";

/** Confirmation link sent in the double opt-in email. */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  // The id is a path segment (/r/confirm/<id>?sig=…), matching how the email builds the
  // link and how r.alert.$id.tsx reads it — NOT a query param.
  const id = params.id || "";
  const signature = new URL(request.url).searchParams.get("sig") || "";

  requireSignedAlertLink(id, signature, "Invalid confirmation link");

  const alert = await db.stockAlert.findUnique({
    where: { id },
    select: { email: true, phone: true, channel: true, productTitle: true, variantTitle: true, status: true },
  });
  if (!alert) throw new Response("Not found", { status: 404 });

  const alreadyConfirmed = alert.status === "CONFIRMED";
  if (!alreadyConfirmed) {
    const confirmed = await confirmStockAlert(id);
    if (!confirmed) {
      // The alert was cancelled or already fulfilled before this link was clicked.
      return {
        contact: alert.channel === "sms" ? alert.phone : alert.email,
        channel: alert.channel,
        productTitle: alert.productTitle,
        variantTitle: alert.variantTitle ?? null,
        status: alert.status,
        confirmed: false,
      };
    }
  }

  return {
    contact: alert.channel === "sms" ? alert.phone : alert.email,
    channel: alert.channel,
    productTitle: alert.productTitle,
    variantTitle: alert.variantTitle ?? null,
    status: "CONFIRMED",
    confirmed: true,
  };
};

export default function ConfirmAlert() {
  const { contact, channel, productTitle, variantTitle, confirmed } = useLoaderData<typeof loader>();

  return (
    <AlertLandingShell>
      {confirmed ? (
        <>
          <AlertLandingHeading>You're confirmed!</AlertLandingHeading>
          <AlertLandingBody>
            {contact} will be notified by {channel === "sms" ? "text" : "email"} when{" "}
            <strong>{productTitle}</strong>
            {variantTitle && variantTitle !== "Default Title" ? ` (${variantTitle})` : ""} is
            back in stock.
          </AlertLandingBody>
        </>
      ) : (
        <>
          <AlertLandingHeading>Unable to confirm</AlertLandingHeading>
          <AlertLandingBody>
            This alert may have been cancelled or already fulfilled. Please sign up again on the
            product page.
          </AlertLandingBody>
        </>
      )}
    </AlertLandingShell>
  );
}
