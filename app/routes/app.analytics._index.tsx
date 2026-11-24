import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ClassicAnalytics } from "../components/analytics/ClassicAnalytics";
import classicAnalyticsStyles from "../components/analytics/ClassicAnalytics.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import {
  csvRowFor,
  isReportSlug,
  REPORT_CSV_COLUMNS,
} from "../lib/report-contract";
import { toCsv } from "../lib/reports";
import {
  loadAnalyticsReport,
  loadTopWishlistedProducts,
} from "../models/analytics-reports.server";

const HIDDEN_REPORTS = new Set([
  "removed-abandoned",
  "save-sources",
  "reminder-performance",
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const params = new URL(request.url).searchParams;
  const requestedSlug = params.get("report") ?? "overview";
  const slug = isReportSlug(requestedSlug) && !HIDDEN_REPORTS.has(requestedSlug)
    ? requestedSlug
    : "overview";
  params.delete("report");
  if (!params.has("compare")) params.set("compare", "true");
  if (!params.has("pageSize")) params.set("pageSize", "8");

  const range = paramsRange(parseAnalyticsParams(params));
  const [reportResult, topProducts] = await Promise.all([
    loadAnalyticsReport(shop.id, admin, slug, params),
    // Overview only; the other reports do not render this strip.
    slug === "overview" && params.get("format") !== "csv"
      ? loadTopWishlistedProducts(shop.id, admin, range, 5)
      : Promise.resolve([] as Awaited<ReturnType<typeof loadTopWishlistedProducts>>),
  ]);
  if (params.get("format") === "csv") {
    const body = toCsv([
      REPORT_CSV_COLUMNS[slug],
      ...reportResult.csvRows.map((row) => csvRowFor(slug, row)),
    ]);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-${reportResult.response.range.from}-${reportResult.response.range.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const { response } = reportResult;
  const productBreakdown: typeof topProducts = [];

  return json({ report: response, topProducts, productBreakdown });
}

export const links = () => [
  { rel: "stylesheet", href: classicAnalyticsStyles },
];

export default function AnalyticsIndex() {
  const { report, topProducts, productBreakdown } = useLoaderData<typeof loader>();
  return (
    <ClassicAnalytics
      report={report}
      topProducts={topProducts}
      productBreakdown={productBreakdown}
    />
  );
}
