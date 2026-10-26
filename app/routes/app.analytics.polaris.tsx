import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ClassicAnalytics } from "../components/analytics/ClassicAnalytics";
import classicAnalyticsStyles from "../components/analytics/ClassicAnalytics.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import {
  csvRowFor,
  isReportSlug,
  REPORT_CSV_COLUMNS,
} from "../lib/report-contract";
import { toCsv } from "../lib/reports";
import { loadAnalyticsReport } from "../models/analytics-reports.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const params = new URL(request.url).searchParams;
  const requestedSlug = params.get("report") ?? "overview";
  const slug = isReportSlug(requestedSlug) ? requestedSlug : "overview";
  params.delete("report");
  if (!params.has("pageSize")) params.set("pageSize", "8");

  const reportResult = await loadAnalyticsReport(shop.id, admin, slug, params);
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
  const topProducts = slug === "overview"
    ? await loadAnalyticsReport(shop.id, admin, "wishlisted-products", (() => {
        const topParams = new URLSearchParams(params);
        topParams.set("page", "1");
        topParams.set("pageSize", "5");
        topParams.set("sort", "saves");
        topParams.set("order", "desc");
        return topParams;
      })()).then(({ response: products }) => products.rows)
    : [];
  const productBreakdown = slug === "conversion-funnel"
    ? await loadAnalyticsReport(shop.id, admin, "wishlisted-products", (() => {
        const productParams = new URLSearchParams(params);
        productParams.set("page", "1");
        productParams.set("pageSize", "8");
        productParams.set("sort", "saves");
        productParams.set("order", "desc");
        return productParams;
      })()).then(({ response: products }) => products.rows)
    : [];
  const collectionOptions = slug === "wishlisted-products"
    ? await loadAnalyticsReport(shop.id, admin, "wishlisted-products", (() => {
        const collectionParams = new URLSearchParams(params);
        collectionParams.delete("collectionId");
        collectionParams.set("page", "1");
        collectionParams.set("pageSize", "200");
        collectionParams.set("sort", "saves");
        collectionParams.set("order", "desc");
        return collectionParams;
      })()).then(({ response: products }) => {
        const collections = new Map<string, string>();
        for (const row of products.rows) {
          if (!Array.isArray(row.collections)) continue;
          for (const collection of row.collections) {
            if (!collection || typeof collection !== "object") continue;
            const value = collection as Record<string, unknown>;
            if (typeof value.collectionId === "string" && typeof value.title === "string") {
              collections.set(value.collectionId, value.title);
            }
          }
        }
        return [...collections].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
      })
    : [];
  return json({ report: response, topProducts, productBreakdown, collectionOptions });
}

export const links = () => [
  { rel: "stylesheet", href: classicAnalyticsStyles },
];

export default function AnalyticsPolaris() {
  const { report, topProducts, productBreakdown, collectionOptions } = useLoaderData<typeof loader>();
  return (
    <ClassicAnalytics
      report={report}
      topProducts={topProducts}
      productBreakdown={productBreakdown}
      collectionOptions={collectionOptions}
    />
  );
}
