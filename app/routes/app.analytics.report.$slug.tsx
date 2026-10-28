/**
 * Polaris-based individual analytics report page.
 * Fetches report data server-side from loadAnalyticsReport and renders it via ReportViewer.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { Page, Layout, Button } from "@shopify/polaris";
import { requireAdminShop } from "../lib/admin-auth.server";
import { isReportSlug } from "../lib/report-contract";
import { loadAnalyticsReport } from "../models/analytics-reports.server";
import { ReportViewer } from "../components/analytics/ReportViewer";
import { DateRangePicker } from "../components/analytics/DateRangePicker";
import { AnalyticsNavigation } from "../components/analytics/AnalyticsNavigation";
import { downloadCsv } from "../lib/download.client";

const REPORT_TITLES: Record<string, string> = {
  overview: "Overview Dashboard",
  "activity-trends": "Activity Trends",
  "conversion-funnel": "Conversion Funnel",
  "revenue-attribution": "Revenue & Sales Attribution",
  "attribution-models": "Attribution Model Comparison",
  "customer-value": "Customer-Value Impact",
  "wishlisted-products": "Wishlisted Products",
  "shared-wishlists": "Shared Wishlists",
  "wishlist-orders": "Wishlist Orders",
  "wishlist-conversion": "Wishlist Conversion",
  "removed-abandoned": "Removed & Abandoned",
  "wishlist-to-cart": "Wishlist to Cart",
  "variant-demand": "Variant-Level Demand",
  "save-sources": "Save Source Report",
  "reminder-performance": "Reminder & Price-Drop Performance",
  "guest-to-customer": "Guest-to-Customer Conversion",
  "stock-list": "Stock List & Inventory",
  "alert-subscriptions": "Alert Subscriptions",
  "alert-customers": "Alert Request Customers",
  "pending-alerts": "Pending Alerts",
  "alert-purchases": "Alert Purchases",
  "restock-conversion": "Restock Conversion",
  "low-stock-demand": "Low Stock Demand",
  // "notification-delivery": "Notification Delivery",
  // "time-to-notify": "Time-to-Notify & Time-to-Purchase",
  // "lost-sales": "Lost Sales / Missed Revenue",
  // "sell-through": "Sell-Through After Restock",
  // "subscription-sources": "Subscription Source Report",
  "recurring-customers": "Recurring Customers",
  "top-intent-customers": "Wishlist Savers",
  "segments": "Customer Segments Export",
  "notification-log": "Notification Log",
  "usage": "Usage vs Plan",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const slug = params.slug;
  if (!slug || !isReportSlug(slug)) {
    return redirect(`/app/analytics`);
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const compare = searchParams.get("compare") === "true";

  // Fetch report data server-side
  const { response } = await loadAnalyticsReport(
    shop.id,
    admin,
    slug,
    searchParams,
  );

  return json({
    shop,
    slug,
    from: response.range.from,
    to: response.range.to,
    compare,
    report: response,
  });
}

export default function AnalyticsReport() {
  const data = useLoaderData<typeof loader>();
  const report = data.report;
  const navigate = useNavigate();

  const handleDateChange = (params: URLSearchParams) => {
    const next = new URLSearchParams();
    if (params.get("from")) next.set("from", params.get("from")!);
    if (params.get("to")) next.set("to", params.get("to")!);
    if (params.get("compare")) next.set("compare", params.get("compare")!);
    navigate(`?${next.toString()}`);
  };

  return (
    <Page title={REPORT_TITLES[data.slug] || data.slug}>
      <Layout>
        <Layout.Section>
          <TitleBar title={REPORT_TITLES[data.slug] || data.slug} />
          <div style={{ padding: 16 }}>
            <DateRangePicker
              from={data.from}
              to={data.to}
              compare={data.compare}
              disabled={false}
              onChange={handleDateChange}
            />
            <AnalyticsNavigation activeSlug={data.slug} />
            <ReportViewer
              slug={data.slug}
              title={REPORT_TITLES[data.slug] || data.slug}
              shopId={data.shop.id}
              report={report}
              from={data.from}
              to={data.to}
              compare={data.compare}
            />
            <div style={{ marginTop: 16 }}>
              <Button
                variant="tertiary"
                onClick={() => {
                  const url = new URL(
                    window.location.origin +
                      `/app/api/reports/${data.slug}`,
                  );
                  url.searchParams.set("from", data.from);
                  url.searchParams.set("to", data.to);
                  url.searchParams.set("format", "csv");
                  void downloadCsv(
                    url.toString(),
                    `${data.slug}-${data.from}_${data.to}.csv`,
                  );
                }}
              >
                Export CSV
              </Button>
            </div>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
