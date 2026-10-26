import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import { isOverviewDetailMetric } from "../lib/overview-detail";
import { loadOverviewDetail } from "../models/overview-detail.server";

/**
 * KPI drill-down for the Overview. Loaded on demand when a merchant clicks one
 * of the summary cards, so the initial dashboard does not pay for nine extra
 * breakdown queries.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const url = new URL(request.url);
  const metric = url.searchParams.get("metric")?.trim() ?? "";
  if (!isOverviewDetailMetric(metric)) {
    return json({ error: "Unknown metric" }, { status: 400 });
  }

  try {
    const range = paramsRange(parseAnalyticsParams(url.searchParams));
    const detail = await loadOverviewDetail(shop.id, admin, metric, range);
    return json(detail, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load overview drill-down", error);
    return json({ error: "Unable to load this breakdown" }, { status: 500 });
  }
}
