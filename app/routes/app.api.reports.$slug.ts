import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  csvRowFor,
  isReportSlug,
  REPORT_CSV_COLUMNS,
} from "../lib/report-contract";
import { toCsv } from "../lib/reports";
import { requireAdminShop } from "../lib/admin-auth.server";
import { loadAnalyticsReport } from "../models/analytics-reports.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const slug = params.slug;
  if (!slug || !isReportSlug(slug)) {
    return json({ error: "Unknown analytics report" }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  if (
    searchParams.get("format") === "csv" &&
    searchParams.get("includeLists") === "1"
  ) {
    const listParams = new URLSearchParams();
    for (const key of ["from", "to"]) {
      const value = searchParams.get(key);
      if (value) listParams.set(key, value);
    }
    listParams.set("format", "csv");
    const [wishlist, stock] = await Promise.all([
      loadAnalyticsReport(shop.id, admin, "wishlisted-products", listParams),
      loadAnalyticsReport(shop.id, admin, "stock-list", listParams),
    ]);
    const headers = [
      "List",
      "Product",
      "Collection",
      "Variant",
      "Saves",
      "Unique shoppers",
      "Added to cart",
      "Quantity",
      "Status",
      "Waiting subscribers",
    ];
    const wishlistRows = wishlist.csvRows.map((row) => [
      "Wishlist",
      String(row.title ?? ""),
      String(row.collection ?? ""),
      "",
      Number(row.saves ?? 0),
      Number(row.uniqueShoppers ?? 0),
      Number(row.addsToCart ?? 0),
      "",
      "",
      "",
    ]);
    const stockRows = stock.csvRows.map((row) => [
      "Back in Stock",
      String(row.title ?? ""),
      "",
      String(row.variantTitle ?? row.variantId ?? ""),
      "",
      "",
      "",
      Number(row.quantity ?? 0),
      String(row.status ?? ""),
      Number(row.waitingSubscribers ?? 0),
    ]);
    const body = toCsv([headers, ...wishlistRows, ...stockRows]);
    const { from, to } = wishlist.response.range;
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="wishlist-back-in-stock-${from}-${to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const { response, csvRows } = await loadAnalyticsReport(
    shop.id,
    admin,
    slug,
    searchParams,
  );
  if (searchParams.get("format") === "csv") {
    const rows = csvRows.map((row) => csvRowFor(slug, row));
    const body = toCsv([REPORT_CSV_COLUMNS[slug], ...rows]);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-${response.range.from}-${response.range.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export default function AnalyticsReportApi() {
  return null;
}
