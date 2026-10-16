import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import db from "../db.server";
import { verifyPayloadSignature } from "../lib/crypto.server";
import { confirmStockAlert } from "../models/stock-alert.server";

/** Confirmation link sent in the double opt-in email. */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  // The id is a path segment (/r/confirm/<id>?sig=…), matching how the email builds the
  // link and how r.alert.$id.tsx reads it — NOT a query param.
  const id = params.id || "";
  const signature = new URL(request.url).searchParams.get("sig") || "";

  if (!id || !verifyPayloadSignature(id, signature)) {
    throw new Response("Invalid confirmation link", { status: 400 });
  }

  const alert = await db.stockAlert.findUnique({
    where: { id },
    select: { email: true, productTitle: true, variantTitle: true, status: true },
  });
  if (!alert) throw new Response("Not found", { status: 404 });

  const alreadyConfirmed = alert.status === "CONFIRMED";
  if (!alreadyConfirmed) {
    const confirmed = await confirmStockAlert(id);
    if (!confirmed) {
      // The alert was cancelled or already fulfilled before this link was clicked.
      return {
        email: alert.email,
        productTitle: alert.productTitle,
        variantTitle: alert.variantTitle ?? null,
        status: alert.status,
        confirmed: false,
      };
    }
  }

  return {
    email: alert.email,
    productTitle: alert.productTitle,
    variantTitle: alert.variantTitle ?? null,
    status: "CONFIRMED",
    confirmed: true,
  };
};

export default function ConfirmAlert() {
  const { email, productTitle, variantTitle, confirmed } = useLoaderData<typeof loader>();

  return (
    <main
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        maxWidth: "32rem",
        margin: "10vh auto",
        padding: "0 1.5rem",
        textAlign: "center",
        color: "#1a1a1a",
      }}
    >
      {confirmed ? (
        <>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>You're confirmed!</h1>
          <p style={{ color: "#4a4f54", lineHeight: 1.6 }}>
            {email} will be notified when{" "}
            <strong>{productTitle}</strong>
            {variantTitle && variantTitle !== "Default Title" ? ` (${variantTitle})` : ""} is
            back in stock.
          </p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Unable to confirm</h1>
          <p style={{ color: "#4a4f54", lineHeight: 1.6 }}>
            This alert may have been cancelled or already fulfilled. Please sign up again on the
            product page.
          </p>
        </>
      )}
    </main>
  );
}
