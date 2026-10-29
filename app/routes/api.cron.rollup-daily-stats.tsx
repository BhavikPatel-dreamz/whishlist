/**
 * Cron entry point for the DailyStat rollup (ANALYTICS_REPORTS_SPEC.md section 4).
 *
 * Protected by `CRON_SECRET`. Point a scheduler at it (Vercel cron uses GET):
 *
 *   # Every hour — roll up today (incomplete day, safe to re-run)
 *   GET/POST /api/cron/rollup-daily-stats?range=today
 *
 *   # Nightly — roll up yesterday (complete day)
 *   GET/POST /api/cron/rollup-daily-stats?range=yesterday
 *
 *   # Backfill last N days (default 90)
 *   GET/POST /api/cron/rollup-daily-stats?range=backfill&days=90
 *
 *   # Backfill a custom range
 *   GET/POST /api/cron/rollup-daily-stats?from=2026-01-01&to=2026-01-31
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { addDays, today } from "../lib/analytics-params";
import { timingSafeEqual } from "../lib/crypto.server";
import {
  rollupToday,
  rollupYesterday,
  backfillRange,
  type RollupResult,
} from "../jobs/daily-stat-rollup.server";

async function runRollup(request: Request) {
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
  } else if (range === "backfill") {
    const days = Math.min(
      180,
      Math.max(1, Number(url.searchParams.get("days") || 90) || 90),
    );
    const end = today();
    const start = addDays(end, -(days - 1));
    result = await backfillRange(start, end);
  } else if (from && to) {
    result = await backfillRange(from, to);
  } else {
    result = await rollupToday();
  }

  return json({ ok: true, result });
}

/** Vercel Cron invokes GET. */
export async function loader({ request }: LoaderFunctionArgs) {
  return runRollup(request);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" && request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  return runRollup(request);
}

export default function RollupDailyStatsCron() {
  return null;
}
