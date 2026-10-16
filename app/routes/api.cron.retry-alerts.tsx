import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { timingSafeEqual } from "../lib/crypto.server";
import { getShopContext } from "../lib/shopify-data.server";
import { retryStuckAlerts } from "../lib/notifications/dispatch.server";

/**
 * Cron entry point that re-drives back-in-stock alerts a webhook should have handled but didn't —
 * a restock that happened while the app was down, a send stranded by a crash, a transient provider
 * error. It adds no new send path; it just gives a scheduler a way to trigger the same dispatch the
 * `inventory_levels/update` webhook runs.
 *
 * The endpoint is opt-in and fails closed: it is protected by a shared secret and disabled (503)
 * until `CRON_SECRET` is set. Point any scheduler at it, e.g. every 15 minutes:
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/retry-alerts
 *
 * Each shop is swept with `includeFailed: false`: automation must only re-send alerts still owed a
 * delivery, never loop on addresses that already exhausted their retries — reactivating FAILED rows
 * is the admin "Retry failed & stuck" button's deliberate, human-triggered job.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured → the feature is off. Refuse rather than run unauthenticated.
    return json({ ok: false, error: "cron_disabled" }, { status: 503 });
  }

  const provided = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!provided || !timingSafeEqual(provided, secret)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const shops = await db.shop.findMany();
  const totals = { shops: 0, variantsChecked: 0, variantsDispatched: 0, sent: 0, failed: 0 };
  const perShop: Array<{ shop: string; sent: number; failed: number; error?: string }> = [];

  for (const shop of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop.shop);
      const shopContext = await getShopContext(admin);
      const result = await retryStuckAlerts({ shop, admin, shopContext, includeFailed: false });
      totals.shops += 1;
      totals.variantsChecked += result.variantsChecked;
      totals.variantsDispatched += result.variantsDispatched;
      totals.sent += result.sent;
      totals.failed += result.failed;
      perShop.push({ shop: shop.shop, sent: result.sent, failed: result.failed });
    } catch (error) {
      // One uninstalled or misconfigured shop must not abort the sweep for the rest.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron.retry-alerts] ${shop.shop} failed: ${message}`);
      perShop.push({ shop: shop.shop, sent: 0, failed: 0, error: message.slice(0, 200) });
    }
  }

  console.log(
    `[cron.retry-alerts] swept ${totals.shops}/${shops.length} shops: sent=${totals.sent} failed=${totals.failed}`,
  );
  return json({ ok: true, totals, shops: perShop });
};
