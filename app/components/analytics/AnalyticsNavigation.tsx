import { useNavigate, useSearchParams } from "@remix-run/react";
import { Button, Tabs } from "@shopify/polaris";
import type { ReportSlug } from "../../lib/report-contract";

const REPORTS: Record<string, string> = {
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
  "top-intent-customers": "Top Customers by Intent",
  segments: "Customer Segments Export",
  "notification-log": "Notification Log",
  usage: "Usage vs Plan",
};

const GROUPS: { label: string; reports: ReportSlug[] }[] = [
  {
    label: "Overview",
    reports: [
      "overview",
      "activity-trends",
      "conversion-funnel",
      "revenue-attribution",
      "attribution-models",
      "customer-value",
    ],
  },
  {
    label: "Wishlist",
    reports: [
      "wishlisted-products",
      "shared-wishlists",
      "wishlist-orders",
      "wishlist-conversion",
      "removed-abandoned",
      "wishlist-to-cart",
      "variant-demand",
      "save-sources",
      "reminder-performance",
      "guest-to-customer",
    ],
  },
  {
    label: "Back in Stock",
    reports: [
      "stock-list",
      "alert-subscriptions",
      "pending-alerts",
      "alert-purchases",
      "restock-conversion",
      "low-stock-demand",
      "notification-delivery",
      "time-to-notify",
      "lost-sales",
      "sell-through",
      "subscription-sources",
    ],
  },
  {
    label: "Customers",
    reports: ["recurring-customers", "top-intent-customers", "segments"],
  },
  {
    label: "Operations",
    reports: ["notification-log", "usage"],
  },
];

export function AnalyticsNavigation({ activeSlug }: { activeSlug: ReportSlug }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentGroupIndex = Math.max(
    0,
    GROUPS.findIndex((group) => group.reports.includes(activeSlug)),
  );
  const currentGroup = GROUPS[currentGroupIndex];

  const hrefFor = (slug: ReportSlug) => {
    const params = new URLSearchParams();
    for (const key of ["from", "to", "compare", "groupBy"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return slug === "overview"
      ? `/app/analytics${suffix}`
      : `/app/analytics/report/${slug}${suffix}`;
  };

  return (
    <div style={{ margin: "8px 0 16px" }}>
      <Tabs
        tabs={GROUPS.map((group) => ({
          id: group.label.toLowerCase().replaceAll(" ", "-"),
          content: group.label,
          accessibilityLabel: `${group.label} reports`,
        }))}
        selected={currentGroupIndex}
        onSelect={(index) => navigate(hrefFor(GROUPS[index].reports[0]))}
      />
      <div
        aria-label={`${currentGroup.label} reports`}
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          padding: "10px 2px 4px",
          whiteSpace: "nowrap",
        }}
      >
        {currentGroup.reports.map((slug) => (
          <Button
            key={slug}
            url={hrefFor(slug)}
            variant={activeSlug === slug ? "primary" : "tertiary"}
            size="slim"
          >
            {REPORTS[slug]}
          </Button>
        ))}
      </div>
    </div>
  );
}
