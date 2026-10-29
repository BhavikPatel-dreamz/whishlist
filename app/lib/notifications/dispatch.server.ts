import type { Shop } from "@prisma/client";
import {
  getVariantsByIds,
  type GraphqlClient,
  type ShopContext,
  type VariantSummary,
} from "../shopify-data.server";
import { getShopPlan } from "../billing/plan.server";
import {
  claimPendingAlerts,
  reactivateFailedAlerts,
  variantIdsNeedingRetry,
} from "../../models/stock-alert.server";
import { checkRestockEligibility } from "./restock-eligibility.server";
import { deliverOne, buildDeliverSettings } from "./deliver-one.server";
import { isRestockQueueEnabled } from "./queue-flag.server";
import { enqueueRestockAlerts } from "./enqueue.server";
import {
  alertConfirmUrl,
  alertTrackingUrl,
  alertUnsubscribeUrl,
  cartPermalink,
  emailLogoUrl,
} from "./notification-urls.server";

export {
  alertConfirmUrl,
  alertTrackingUrl,
  alertUnsubscribeUrl,
  cartPermalink,
  emailLogoUrl,
};

const SEND_CONCURRENCY = 10;

export type DispatchResult = {
  variantId: string;
  claimed: number;
  sent: number;
  failed: number;
  skippedReason?: string;
};

/**
 * Sends every pending alert for a variant that just came back in stock.
 * When the restock queue is enabled for the shop, enqueues durable jobs instead
 * of calling Mailgun inside the webhook/cron request.
 */
export async function dispatchRestockAlerts(params: {
  shop: Shop;
  variant: VariantSummary;
  shopContext: ShopContext;
  inventoryItemId?: string | null;
  available?: number | null;
}): Promise<DispatchResult> {
  if (isRestockQueueEnabled(params.shop)) {
    const enqueued = await enqueueRestockAlerts(params);
    return {
      variantId: enqueued.variantId,
      claimed: enqueued.jobsCreated,
      sent: 0,
      failed: 0,
      skippedReason: enqueued.skippedReason,
    };
  }
  return dispatchRestockAlertsInline(params);
}

async function dispatchRestockAlertsInline(params: {
  shop: Shop;
  variant: VariantSummary;
  shopContext: ShopContext;
}): Promise<DispatchResult> {
  const { shop, variant, shopContext } = params;
  const base: DispatchResult = {
    variantId: variant.variantId,
    claimed: 0,
    sent: 0,
    failed: 0,
  };

  const eligibility = await checkRestockEligibility(shop, variant);
  if (!eligibility.ok) {
    return { ...base, skippedReason: eligibility.reason };
  }

  const alerts = await claimPendingAlerts(
    shop.id,
    variant.variantId,
    500,
    shop.doubleOptIn,
  );
  if (!alerts.length) return { ...base, skippedReason: "no pending alerts" };

  const plan = await getShopPlan(shop.id);
  const { settings, backInStockSettings } = buildDeliverSettings(
    shop,
    plan,
    eligibility.backInStockSettings,
  );

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < alerts.length; i += SEND_CONCURRENCY) {
    const batch = alerts.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((alert) =>
        deliverOne(alert, {
          plan,
          settings,
          backInStockSettings,
          variant,
          shopContext,
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value === "sent") sent += 1;
      else if (result.status === "fulfilled" && result.value === "held") {
        /* quota reached; alert stays pending */
      } else {
        failed += 1;
        const alert = batch[index];
        const message =
          result.status === "rejected"
            ? String(result.reason).slice(0, 300)
            : "delivery reported failure";
        console.error(`[restock] alert ${alert.id} failed: ${message}`);
      }
    });
  }

  return { ...base, claimed: alerts.length, sent, failed };
}

export type RetryResult = {
  variantsChecked: number;
  variantsDispatched: number;
  reactivated: number;
  sent: number;
  failed: number;
};

/**
 * Re-drives alerts a normal restock webhook would have handled but didn't.
 * With queue enabled this enqueues jobs; otherwise it sends inline.
 */
export async function retryStuckAlerts(params: {
  shop: Shop;
  admin: GraphqlClient;
  shopContext: ShopContext;
  includeFailed?: boolean;
}): Promise<RetryResult> {
  const { shop, admin, shopContext, includeFailed = false } = params;
  const result: RetryResult = {
    variantsChecked: 0,
    variantsDispatched: 0,
    reactivated: 0,
    sent: 0,
    failed: 0,
  };

  const variantIds = await variantIdsNeedingRetry(shop.id, { includeFailed });
  if (!variantIds.length) return result;
  result.variantsChecked = variantIds.length;

  if (includeFailed) {
    result.reactivated = await reactivateFailedAlerts(shop.id, variantIds);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < variantIds.length; i += 100)
    chunks.push(variantIds.slice(i, i + 100));
  let nextChunk = 0;
  const workers = Array.from(
    { length: Math.min(3, chunks.length) },
    async () => {
      while (nextChunk < chunks.length) {
        const chunk = chunks[nextChunk++];
        const variants = await getVariantsByIds(admin, chunk);
        for (const variant of variants) {
          const dispatched = await dispatchRestockAlerts({
            shop,
            variant,
            shopContext,
          });
          if (dispatched.claimed) {
            result.variantsDispatched += 1;
            result.sent += dispatched.sent;
            result.failed += dispatched.failed;
          }
        }
      }
    },
  );
  await Promise.all(workers);

  return result;
}
