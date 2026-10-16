import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { allStockAlertsForExport } from "../models/stock-alert.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || undefined;
  const query = url.searchParams.get("q") || undefined;

  const alerts = await allStockAlertsForExport(shop.id, { status, query });

  const header = [
    "Email",
    "Phone",
    "Product ID",
    "Variant ID",
    "Product Title",
    "Variant Title",
    "Status",
    "Attempts",
    "Created At",
    "Notified At",
    "Converted At",
  ];

  const csvRows = alerts.map((a) => [
    a.email,
    a.phone || "",
    a.productId,
    a.variantId,
    a.productTitle || "",
    a.variantTitle || "",
    a.status,
    a.attempts.toString(),
    new Date(a.createdAt).toISOString(),
    a.notifiedAt ? new Date(a.notifiedAt).toISOString() : "",
    a.convertedAt ? new Date(a.convertedAt).toISOString() : "",
  ]);

  const csv = [header, ...csvRows]
    .map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="stock-alerts-${shop.shop}.csv"`,
    },
  });
};
