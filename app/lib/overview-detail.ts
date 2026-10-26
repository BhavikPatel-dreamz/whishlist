/**
 * Shapes returned by the Overview KPI drill-down. Each KPI card in the Overview
 * opens a matching "Top 5" breakdown, fetched on demand by the resource route
 * and rendered by `OverviewMetricDetail`.
 *
 * Shared between the resource route and the client component so both sides
 * agree on the contract.
 */

import type { ReportSlug } from "./report-contract";

export const OVERVIEW_DETAIL_METRICS = [
  "saves",
  "uniqueSavers",
  "alertSubscriptions",
  "pendingAlerts",
  "notificationsSent",
  "notificationClicks",
  "wishlistOrders",
  "attributedRevenue",
  "wishlistConversionRate",
] as const;

export type OverviewDetailMetric = (typeof OVERVIEW_DETAIL_METRICS)[number];

export function isOverviewDetailMetric(
  value: string,
): value is OverviewDetailMetric {
  return (OVERVIEW_DETAIL_METRICS as readonly string[]).includes(value);
}

export type OverviewDetailColumn = {
  label: string;
  align?: "left" | "right";
};

/**
 * One drill-down row. `values` is positional and always matches `columns`.
 * Cells are formatted on the server so the client only decides alignment and
 * whether the row links to the product drawer.
 */
export type OverviewDetailRow = {
  productId?: string | null;
  values: string[];
};

export type OverviewDetail = {
  metric: OverviewDetailMetric;
  title: string;
  description: string;
  columns: OverviewDetailColumn[];
  rows: OverviewDetailRow[];
  emptyMessage: string;
  /** Deep link to the full report behind this metric. */
  reportSlug: ReportSlug;
};
