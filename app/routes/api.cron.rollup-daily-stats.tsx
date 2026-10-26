/**
 * Cron entry point for the DailyStat rollup (ANALYTICS_REPORTS_SPEC.md section 4).
 *
 * Protected by `CRON_SECRET`. Point a scheduler at it:
 *
 *   # Every hour — roll up today (incomplete day, safe to re-run)
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<app>/api/cron/rollup-daily-stats?range=today
 *
 *   # Nightly — roll up yesterday (complete day)
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<app>/api/cron/rollup-daily-stats?range=yesterday
 *
 *   # Backfill a custom range
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<app>/api/cron/rollup-daily-stats?from=2026-01-01&to=2026-01-31"
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { timingSafeEqual } from "../lib/crypto.server";
import {
  rollupToday,
  rollupYesterday,
  backfillRange,
  type RollupResult,
} from "../jobs/daily-stat-rollup.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return json({ ok: false, error: "cron_disabled" }, { status: 503 });
  }

  const provided = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!provided || !timingSafeEqual(provided, secret)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const range = url.searchParams.get("range");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let result: RollupResult;
  if (range === "yesterday") {
    result = await rollupYesterday();
  } else if (from && to) {
    result = await backfillRange(from, to);
  } else {
    // Default: roll up today.
    result = await rollupToday();
  }

  return json({ ok: true, result });
}

export default function RollupDailyStatsCron() {
  return null;
}
