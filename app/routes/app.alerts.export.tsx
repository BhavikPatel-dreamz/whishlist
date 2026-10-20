import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { allStockAlertsForExport } from "../models/stock-alert.server";
import { toCsv } from "../lib/reports";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdminShop(request);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || undefined;
  const query = url.searchParams.get("q") || undefined;

  const alerts = await allStockAlertsForExport(shop.id, { status, query });

  const header = [
    "Contact",
    "Channel",
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
    "Purchase Order ID",
    "Purchase Revenue",
    "Purchase Currency",
    "Purchased At",
  ];

  const csvRows = alerts.map((a) => [
    a.email || a.phone || "",
    a.channel,
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
    a.purchaseOrderId || "",
    a.purchaseRevenue?.toFixed(2) || "",
    a.purchaseCurrency || "",
    a.purchasedAt ? new Date(a.purchasedAt).toISOString() : "",
  ]);

  const csv = toCsv([header, ...csvRows]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="stock-alerts-${shop.shop}.csv"`,
    },
  });
};
