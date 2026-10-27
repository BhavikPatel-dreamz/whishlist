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
