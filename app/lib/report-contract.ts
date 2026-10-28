/**
 * The report catalogue and the response contract every report endpoint uses
 * (ANALYTICS_REPORTS_SPEC.md sections 8 and 9).
 */

export const REPORT_SLUGS = [
  // 1. Overview
  "overview",
  "activity-trends",
  "conversion-funnel",
  "revenue-attribution",
  "attribution-models",
  "customer-value",
  // 2. Wishlist
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
  // 3. Back in Stock
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
  // 4. Customer
  "recurring-customers",
  "top-intent-customers",
  "segments",
  // 5. Operations
  "notification-log",
  "usage",
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORT_SLUGS as readonly string[]).includes(value);
}

/** The phase a report belongs to, per the spec's build order. */
export const REPORT_PHASE: Record<ReportSlug, 1 | 2 | 3> = {
  // 1. Overview — Phase 1
  overview: 1,
  "activity-trends": 1,
  "conversion-funnel": 1,
  "revenue-attribution": 1,
  "attribution-models": 3,
  "customer-value": 3,
  // 2. Wishlist
  "wishlisted-products": 1,
  "shared-wishlists": 3,
  "wishlist-orders": 2,
  "wishlist-conversion": 1,
  "removed-abandoned": 2,
  "wishlist-to-cart": 2,
  "variant-demand": 2,
  "save-sources": 3,
  "reminder-performance": 3,
  "guest-to-customer": 3,
  // 3. Back in Stock
  "stock-list": 2,
  "alert-subscriptions": 1,
  "pending-alerts": 1,
  "alert-purchases": 2,
  "restock-conversion": 1,
  "low-stock-demand": 2,
  "notification-delivery": 1,
  "time-to-notify": 2,
  "lost-sales": 2,
  "sell-through": 3,
  "subscription-sources": 3,
  // 4. Customer
  "recurring-customers": 2,
  "top-intent-customers": 3,
  segments: 3,
  // 5. Operations
  "notification-log": 3,
  usage: 3,
};

export type ReportRow = Record<string, unknown>;

export type ReportResponse = {
  report: ReportSlug;
  range: { from: string; to: string };
  compareRange: { from: string; to: string } | null;
  summary: Record<string, number>;
  delta: Record<string, number>;
  series: Array<Record<string, string | number>>;
  rows: ReportRow[];
  columns: string[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  revenueLabel: string;
  /** Present on notification-log: plan row caps (Starter 25 / Growth 50 / Scale full). */
  planGate?: {
    planCode: string;
    planName: string;
    logLimit: number | null;
    truncated: boolean;
    upgradePlanCode: string | null;
  };
};

/**
 * CSV column headers per report. The key is the report slug, the value maps a
 * row field to the header a merchant sees in the export.
 */
export const REPORT_CSV_COLUMNS: Record<ReportSlug, string[]> = {
  overview: ["Metric", "Value", "Previous period", "Change"],
  "activity-trends": ["Date", "Saves", "Subscriptions", "Notifications sent"],
  "conversion-funnel": [
    "Funnel",
    "Stage",
    "Count",
    "Rate from previous",
    "Drop-off",
    "Drop-off rate",
  ],
  "revenue-attribution": [
    "Source",
    "Attribution",
    "Orders",
    "Revenue",
    "Revenue label",
    "Average order value",
  ],
  "wishlisted-products": [
    "Product",
    "Wishlisted variant count",
    "Wishlisted variant names",
    "Saves",
    "Unique shoppers",
    "Added to cart",
  ],
  "wishlist-conversion": [
    "Product",
    "Saves",
    "Purchases",
    "Conversion",
    "Avg days to buy",
    "Rank",
  ],
  "alert-subscriptions": [
    "Product",
    "Variant",
    "Total subscriptions",
    "New in period",
  ],
  "pending-alerts": [
    "Shopper",
    "Contact",
    "Channel",
    "Product",
    "Variant",
    "Signed up",
    "Pending reason",
  ],
  "restock-conversion": [
    "Product",
    "Subscribed",
    "Notified",
    "Clicked",
    "Purchased",
    "Notification rate",
    "Open rate",
    "Click rate",
    "Conversion rate",
    "Revenue",
    "Revenue label",
  ],
  "notification-delivery": [
    "Product",
    "Channel",
    "Sent",
    "Delivered",
    "Bounced",
    "Opened",
    "Clicked",
    "Purchased",
    "Revenue",
    "Unsubscribed",
    "Open rate",
    "Click rate",
    "Purchase rate",
    "Bounce rate",
  ],
  // 1. Overview — Phase 3
  "attribution-models": [
    "Model",
    "Window",
    "Orders",
    "Revenue",
    "Revenue per order",
  ],
  "customer-value": [
    "Customer type",
    "Customers",
    "Orders",
    "AOV",
    "Repeat purchase rate",
    "Revenue",
  ],
  // 2. Wishlist
  "shared-wishlists": [
    "List name",
    "Customer",
    "Channel",
    "Orders after visit",
    "Products shared",
    "Shared at",
  ],
  "wishlist-orders": [
    "Order number",
    "Date",
    "Customer",
    "Wishlisted products",
    "Value",
  ],
  "removed-abandoned": [
    "Product",
    "Saves",
    "Removes",
    "Abandoned (30 days)",
    "Abandon rate",
  ],
  "wishlist-to-cart": [
    "Product",
    "Saves",
    "Added to cart",
    "Save-to-cart rate",
  ],
  "variant-demand": ["Product", "Variant", "Saves", "Unique shoppers"],
  "save-sources": ["Source", "Device", "Customer type", "Saves"],
  "reminder-performance": [
    "Kind",
    "Channel",
    "Sent",
    "Opened",
    "Clicked",
    "Converted",
    "Conversion rate",
  ],
  "guest-to-customer": [
    "Week",
    "Guest savers",
    "Merged to customer",
    "Merge rate",
  ],
  // 3. Back in Stock
  "stock-list": [
    "Product",
    "Variant",
    "Quantity",
    "Status",
    "Waiting subscribers",
  ],
  "alert-purchases": [
    "Order number",
    "Date",
    "Customer",
    "Product",
    "Value",
    "Alert that led to it",
    "Revenue type",
    "Alert id",
  ],
  "time-to-notify": [
    "Product",
    "Avg minutes restock→sent",
    "Avg minutes sent→purchase",
  ],
  "low-stock-demand": ["Product", "Variant", "Quantity", "Status", "Waiting"],
  "lost-sales": [
    "Product",
    "Variant",
    "Waiting subscribers",
    "Price",
    "Missed revenue",
  ],
  "sell-through": [
    "Product",
    "Variant",
    "Restocked at",
    "Hours to sell out",
    "Missed by subscribers",
  ],
  "subscription-sources": [
    "Source",
    "Page",
    "Device",
    "Signups",
    "Confirmed rate",
  ],
  // 4. Customer
  "recurring-customers": [
    "Customer",
    "Type",
    "Saves",
    "Subscriptions",
    "Clicks",
    "Orders",
    "Spend",
    "Last activity",
  ],
  "top-intent-customers": [
    "Customer",
    "Saves",
    "Subscriptions",
    "Intent score",
    "Last activity",
  ],
  segments: ["Segment", "Customer count", "Last synced", "Status"],
  // 5. Operations
  "notification-log": [
    "Date",
    "Recipient",
    "Kind",
    "Channel",
    "Shopper",
    "Product",
    "Status",
    "Error",
    "Retries",
  ],
  usage: ["Month", "Notifications sent", "Plan limit", "Remaining"],
};

/**
 * The order of the CSV columns matches the order of the keys in
 * `REPORT_CSV_COLUMNS`, so a report row is exported by looking the fields up by
 * name instead of relying on object key order.
 */
export function csvRowFor(
  slug: ReportSlug,
  row: Record<string, unknown>,
): Array<string | number> {
  const columns = REPORT_CSV_COLUMNS[slug];
  const keys = REPORT_CSV_ROW_KEYS[slug];
  return columns.map((_, index) => {
    const value = row[keys[index]];
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  });
}

/** The row field behind each CSV column, per report. */
export const REPORT_CSV_ROW_KEYS: Record<ReportSlug, string[]> = {
  overview: ["metric", "value", "previous", "change"],
  "activity-trends": ["date", "saves", "subscriptions", "notificationsSent"],
  "conversion-funnel": [
    "funnel",
    "stage",
    "count",
    "rateFromPrevious",
    "dropOff",
    "dropOffRate",
  ],
  "revenue-attribution": [
    "source",
    "type",
    "orders",
    "revenue",
    "revenueLabel",
    "averageOrderValue",
  ],
  "wishlisted-products": [
    "title",
    "variantCount",
    "variantNames",
    "saves",
    "uniqueShoppers",
    "addsToCart",
  ],
  "wishlist-conversion": [
    "title",
    "saves",
    "purchases",
    "conversionRate",
    "averageDaysToPurchase",
    "rank",
  ],
  "alert-subscriptions": [
    "title",
    "variantTitle",
    "totalSubscriptions",
    "newSubscriptions",
  ],
  "pending-alerts": [
    "shopper",
    "contact",
    "channel",
    "title",
    "variantTitle",
    "signedUpAt",
    "pendingReason",
  ],
  "restock-conversion": [
    "title",
    "subscribed",
    "notified",
    "clicked",
    "purchased",
    "notificationRate",
    "openRate",
    "clickRate",
    "conversionRate",
    "revenue",
    "revenueLabel",
  ],
  "notification-delivery": [
    "title",
    "channel",
    "sent",
    "delivered",
    "bounced",
    "opened",
    "clicked",
    "purchased",
    "revenue",
    "unsubscribed",
    "openRate",
    "clickRate",
    "purchaseRate",
    "bounceRate",
  ],
  // 1. Overview — Phase 3
  "attribution-models": [
    "model",
    "window",
    "orders",
    "revenue",
    "revenuePerOrder",
  ],
  "customer-value": [
    "segment",
    "customers",
    "orders",
    "aov",
    "repeatPurchaseRate",
    "spend",
  ],
  // 2. Wishlist
  "shared-wishlists": [
    "listName",
    "customer",
    "channel",
    "ordersAfterVisit",
    "products",
    "sharedAt",
  ],
  "wishlist-orders": [
    "orderNumber",
    "date",
    "customer",
    "wishlistedProducts",
    "value",
  ],
  "removed-abandoned": [
    "title",
    "saves",
    "removes",
    "abandonedSaves",
    "abandonRate",
  ],
  "wishlist-to-cart": ["title", "saves", "addsToCart", "addToCartRate"],
  "variant-demand": ["title", "variantTitle", "saves", "uniqueShoppers"],
  "save-sources": ["source", "device", "customerType", "saves"],
  "reminder-performance": [
    "kind",
    "channel",
    "sent",
    "opened",
    "clicked",
    "converted",
    "conversionRate",
  ],
  "guest-to-customer": ["week", "guestSaves", "mergedToCustomer", "mergeRate"],
  // 3. Back in Stock
  "stock-list": [
    "title",
    "variantTitle",
    "quantity",
    "status",
    "waitingSubscribers",
  ],
  "alert-purchases": [
    "orderNumber",
    "date",
    "customer",
    "title",
    "value",
    "alertCause",
    "revenueType",
    "alertId",
  ],
  "time-to-notify": [
    "title",
    "avgMinutesRestockToSent",
    "avgMinutesSentToPurchase",
  ],
  "low-stock-demand": [
    "title",
    "variantTitle",
    "quantity",
    "status",
    "waiting",
  ],
  "lost-sales": [
    "title",
    "variantId",
    "waitingSubscribers",
    "price",
    "missedRevenue",
  ],
  "sell-through": [
    "title",
    "variantId",
    "restockedAt",
    "hoursToSellOut",
    "missedBySubscribers",
  ],
  "subscription-sources": [
    "source",
    "page",
    "device",
    "signups",
    "confirmedRate",
  ],
  // 4. Customer
  "recurring-customers": [
    "customer",
    "customerType",
    "saves",
    "subscriptions",
    "clicks",
    "orders",
    "spend",
    "lastActivity",
  ],
  "top-intent-customers": [
    "customer",
    "saves",
    "subscriptions",
    "intentScore",
    "lastActivity",
  ],
  segments: ["segment", "customerCount", "lastSynced", "status"],
  // 5. Operations
  "notification-log": [
    "date",
    "recipient",
    "kind",
    "channel",
    "shopper",
    "product",
    "status",
    "error",
    "retries",
  ],
  usage: ["month", "notificationsSent", "planLimit", "remaining"],
};
