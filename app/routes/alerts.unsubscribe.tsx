import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import db from "../db.server";
import { verifyPayloadSignature } from "../lib/crypto.server";
import { cancelStockAlert } from "../models/stock-alert.server";

/** One-click unsubscribe target linked from every notification email. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const signature = url.searchParams.get("sig") || "";
  if (!id || !verifyPayloadSignature(id, signature)) {
    throw new Response("Invalid unsubscribe link", { status: 400 });
  }

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
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>You're unsubscribed</h1>
      <p style={{ color: "#4a4f54", lineHeight: 1.6 }}>
        {contact} will no longer receive back-in-stock {channel === "sms" ? "texts" : "emails"}
        {productTitle ? ` for ${productTitle}` : ""}.
      </p>
    </main>
  );
}
