import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { loadBackInStockRequests, loadReport } from "../models/reports.server";
import { reportCsv, toCsv } from "../lib/reports";
import { metricsDateRange } from "../lib/analytics-metrics";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const params = new URL(request.url).searchParams;

  // `requests=1` exports the back-in-stock request list from the Stock List report.
  if (params.get("requests") === "1") {
    const range = metricsDateRange(params);
    const data = await loadBackInStockRequests(
      shop.id,
      admin,
      params,
      range,
      { page: 1, pageSize: 5000 },
    );
    const header = [
      "Customer",
      "Customer Name",
      "Channel",
      "Phone",
      "Customer ID",
      "Requests",
      "Products Requested",
      "Products",
      "Statuses",
      "Notified",
      "Converted",
      "First Request",
      "Last Request",
    ];
    const csvRows = data.rows.map((row) => [
      row.email || row.phone || "",
      row.customerId
        ? data.customerNames[row.customerId] || `Customer ${row.customerId}`
        : "",
      row.channel,
      row.phone || "",
      row.customerId || "",
      row.requests.toString(),
      row.productCount.toString(),
      row.products
        .map(
          (product) =>
            `${product.productTitle || product.productId}${
              product.variantTitle && product.variantTitle !== "Default Title"
                ? ` — ${product.variantTitle}`
                : ""
            }`,
        )
        .join(" | "),
      row.statuses.join(", "),
      row.notified.toString(),
      row.converted.toString(),
      new Date(row.firstRequestAt).toISOString(),
      new Date(row.lastRequestAt).toISOString(),
    ]);
    return new Response(toCsv([header, ...csvRows]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="back-in-stock-requests-${range.from}-${range.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const data = await loadReport(shop.id, admin, params);
  const kind = params.get("kind");
  return new Response(reportCsv(data.table.columns, data.table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${data.tab}${kind ? `-${kind}` : ""}-${data.from}-${data.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
