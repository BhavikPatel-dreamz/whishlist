/**
 * Scheduled email reports (ANALYTICS_REPORTS_SPEC.md section 8.5, report 5.3).
 *
 * Sends a weekly or monthly analytics summary to merchants who have opted in
 * (ShopSettings.weeklyReportEmail). The email includes the key KPIs from the
 * Overview report and links to the full report in the Shopify admin.
 *
 * Cron entry point: POST /api/cron/scheduled-email-reports (protected by CRON_SECRET)
 */

import db from "../db.server";
import { fetchReport } from "../lib/analytics-api.client";
import { getShopPlan } from "../lib/billing/plan.server";
import { sendEmail } from "../lib/notifications/providers.server";
import { resolveSettingsForPlan } from "../lib/shop.server";
import { appOrigin } from "../lib/app-url.server";
import { getShopSettings } from "../models/shop-settings.server";
import { unauthenticated } from "../shopify.server";
import { formatPercent, roundMoney } from "../lib/metrics";

type EmailResult = {
  shop: string;
  sent: boolean;
  error?: string;
};

/**
 * Builds the HTML email body for the analytics summary.
 */
function buildEmailHtml({
  shopDomain,
  overview,
  range,
}: {
  shopDomain: string;
  overview: any;
  range: { from: string; to: string };
}): string {
  const s = overview.summary ?? {};
  const totalRevenue =
    (s.wishlistRevenueDirect ?? 0) +
    (s.wishlistRevenueEstimated ?? 0) +
    (s.restockRevenueDirect ?? 0) +
    (s.restockRevenueEstimated ?? 0);
  const adminUrl = `${appOrigin()}/app/analytics`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Analytics Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f7; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .header { background: #0063d2; color: #ffffff; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .header p { margin: 4px 0 0; opacity: 0.9; font-size: 14px; }
    .body { padding: 24px 32px; }
    .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
    .kpi { flex: 1; min-width: 140px; background: #f8f9fa; border-radius: 6px; padding: 16px; border: 1px solid #e5e5e5; }
    .kpi .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .kpi .value { font-size: 24px; font-weight: 700; color: #111827; }
    .kpi .delta { font-size: 12px; margin-top: 2px; }
    .delta.up { color: #059669; }
    .delta.down { color: #dc2626; }
    .delta.neutral { color: #6b7280; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 12px; }
    .table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .table th { text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; padding: 8px 4px; border-bottom: 1px solid #e5e5e5; }
    .table td { padding: 8px 4px; border-bottom: 1px solid #e5e5e5; color: #374151; }
    .footer { background: #f8f9fa; padding: 16px 32px; border-top: 1px solid #e5e5e5; }
    .footer p { font-size: 12px; color: #6b7280; margin: 0; }
    .footer a { color: #0063d2; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Weekly Analytics Report</h1>
      <p>${shopDomain} &bull; ${range.from} to ${range.to}</p>
    </div>
    <div class="body">
      <div class="kpis">
        <div class="kpi">
          <div class="label">Wishlist Saves</div>
          <div class="value">${(s.saves ?? 0).toLocaleString()}</div>
          <div class="delta ${(s.saveRate ?? 0) > 0 ? "up" : "neutral"}">${formatPercent(s.saveRate ?? 0)} save rate</div>
        </div>
        <div class="kpi">
          <div class="label">Alert Subscriptions</div>
          <div class="value">${(s.alertSubscriptions ?? 0).toLocaleString()}</div>
        </div>
        <div class="kpi">
          <div class="label">Notifications Sent</div>
          <div class="value">${(s.notificationsSent ?? 0).toLocaleString()}</div>
        </div>
        <div class="kpi">
          <div class="label">Attributed Revenue</div>
          <div class="value">${roundMoney(totalRevenue).toLocaleString("en-US", { style: "currency", currency: "USD" })}</div>
        </div>
      </div>
      <div class="section">
        <h2>Top Products by Saves</h2>
        <table class="table">
          <thead>
            <tr><th>Product</th><th>Saves</th><th>Conversion</th></tr>
          </thead>
          <tbody>
            ${
              (overview.rows ?? [])
                .slice(0, 5)
                .map(
                  (row: any) => `
                <tr>
                  <td>${row.title || row.productId || "Unknown"}</td>
                  <td>${row.saves ?? 0}</td>
                  <td>${formatPercent(row.conversionRate ?? 0)}</td>
                </tr>
              `,
                )
                .join("") || '<tr><td colspan="3">No data</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
    <div class="footer">
      <p>View the full report in Shopify admin: <a href="${adminUrl}">Open Analytics</a></p>
      <p>To change email frequency or unsubscribe, go to App Settings &gt; Analytics in your Shopify admin.</p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Sends the scheduled analytics email to one shop.
 */
async function sendShopReport(
  shopId: string,
  shopDomain: string,
  admin: any,
): Promise<EmailResult> {
  const settings = await getShopSettings(shopId);
  if (!settings?.weeklyReportEmail) {
    return { shop: shopDomain, sent: false };
  }

  const shopRow = await db.shop.findUnique({
    where: { id: shopId },
    select: { senderEmail: true },
  });
  const to = shopRow?.senderEmail;
  if (!to) {
    return { shop: shopDomain, sent: false, error: "No sender email on file" };
  }

  const now = new Date();
  const toDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  const fromDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6),
  )
    .toISOString()
    .slice(0, 10);

  const range = { from: fromDate, to: toDate };

  let overview: any;
  try {
    overview = await fetchReport(admin, shopId, "overview", {
      from: fromDate,
      to: toDate,
      compare: false,
    });
  } catch (err) {
    return {
      shop: shopDomain,
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const shopForSettings = await db.shop.findUnique({
    where: { id: shopId },
  });
  if (!shopForSettings) {
    return { shop: shopDomain, sent: false, error: "Shop not found" };
  }

  const plan = await getShopPlan(shopId);
  const emailSettings = resolveSettingsForPlan(shopForSettings, plan);
  const totalRevenue =
    (overview.summary?.wishlistRevenueDirect ?? 0) +
    (overview.summary?.wishlistRevenueEstimated ?? 0) +
    (overview.summary?.restockRevenueDirect ?? 0) +
    (overview.summary?.restockRevenueEstimated ?? 0);
  const html = buildEmailHtml({ shopDomain, overview, range });

  const result = await sendEmail(emailSettings, {
    to,
    subject: `Weekly Analytics Report - ${shopDomain} (${fromDate} to ${toDate})`,
    html,
    text: `Your weekly analytics report for ${shopDomain}. Saves: ${overview.summary?.saves ?? 0}, Subscriptions: ${overview.summary?.alertSubscriptions ?? 0}, Revenue: $${roundMoney(totalRevenue).toFixed(2)}.`,
  });

  if (result.ok) {
    return { shop: shopDomain, sent: true };
  }
  return { shop: shopDomain, sent: false, error: result.error };
}

/**
 * Cron entry point: sends weekly analytics emails to all opted-in shops.
 * Protected by CRON_SECRET.
 */
export async function runScheduledEmailReports(
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "method_not_allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "cron_disabled" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const provided = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!provided || provided.length !== secret.length) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let valid = true;
  for (let i = 0; i < secret.length; i++) {
    if (provided[i] !== secret[i]) {
      valid = false;
      break;
    }
  }
  if (!valid) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const shops = await db.shop.findMany({
    select: { id: true, shop: true, senderEmail: true },
    where: { settings: { weeklyReportEmail: true } },
  });

  const results: EmailResult[] = [];
  for (const shop of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop.shop);
      const result = await sendShopReport(shop.id, shop.shop, admin);
      results.push(result);
    } catch (err) {
      results.push({
        shop: shop.shop,
        sent: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sent = results.filter((r) => r.sent).length;
  return new Response(
    JSON.stringify({ ok: true, sent, total: results.length, results }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
