/**
 * Cron entry point for scheduled email reports (ANALYTICS_REPORTS_SPEC.md section 8.5, 5.3).
 *
 * Protected by `CRON_SECRET`. Point a scheduler at it weekly:
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<app>/api/cron/scheduled-email-reports
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runScheduledEmailReports } from "../jobs/scheduled-email-reports.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return runScheduledEmailReports(request);
};

export default function ScheduledEmailReportsCron() {
  return null;
}
