import type { NotificationJob, Shop, StockAlert } from "@prisma/client";
import db from "../../db.server";
import { getShopPlan } from "../billing/plan.server";
import { unauthenticated } from "../../shopify.server";
import { getShopContext, getVariantsByIds } from "../shopify-data.server";
import { checkRestockEligibility } from "./restock-eligibility.server";
import { buildDeliverSettings, deliverOne } from "./deliver-one.server";
import { tryAcquireSendToken } from "./rate-limit-send.server";

const STALE_SENDING_MS = 10 * 60 * 1000;
const BASE_BACKOFF_MS = 30_000;

export type ProcessJobResult =
  | { status: "sent" | "held" | "dead" | "skipped" }
  | { status: "retry"; retryAfterMs: number }
  | { status: "rate_limited"; retryAfterMs: number };

/**
 * Load a NotificationJob and attempt delivery with global rate limiting.
 * Idempotent against prior successful EmailDeliveryAttempt rows.
 */
export async function processNotificationJob(
  jobId: string,
): Promise<ProcessJobResult> {
  const job = await db.notificationJob.findUnique({ where: { id: jobId } });
  if (!job) return { status: "skipped" };
  if (job.status === "sent" || job.status === "dead") return { status: "skipped" };
  if (job.status === "held") {
    if (job.nextRetryAt && job.nextRetryAt > new Date()) {
      return { status: "retry", retryAfterMs: job.nextRetryAt.getTime() - Date.now() };
    }
  }

  const rate = await tryAcquireSendToken(1);
  if (!rate.ok) {
    return { status: "rate_limited", retryAfterMs: rate.retryAfterMs };
  }

  const claimed = await claimJob(job);
  if (!claimed) return { status: "skipped" };

  const alert = await db.stockAlert.findUnique({
    where: { id: job.stockAlertId },
  });
  if (!alert || alert.status === "CANCELLED" || alert.status === "SENT") {
    await db.notificationJob.update({
      where: { id: job.id },
      data: {
        status: alert?.status === "SENT" ? "sent" : "dead",
        lastError: alert ? null : "stock alert missing",
      },
    });
    return { status: alert?.status === "SENT" ? "sent" : "dead" };
  }

  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop) {
    await failJob(job, "shop missing", true);
    return { status: "dead" };
  }

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop.shop));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await scheduleRetry(claimed, message);
    return { status: "retry", retryAfterMs: backoffMs(claimed.attempts) };
  }

  const variants = await getVariantsByIds(admin, [alert.variantId]);
  const variant = variants[0];
  if (!variant) {
    await scheduleRetry(claimed, "variant not found");
    return { status: "retry", retryAfterMs: backoffMs(claimed.attempts) };
  }

  const eligibility = await checkRestockEligibility(shop, variant);
  if (!eligibility.ok) {
    await db.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "dead",
        lastError: eligibility.reason,
      },
    });
    return { status: "dead" };
  }

  const shopContext = await getShopContext(admin);
  const plan = await getShopPlan(shop.id);
  const ctx = buildDeliverSettings(
    shop,
    plan,
    eligibility.backInStockSettings,
  );

  const outcome = await deliverOne(alert, {
    ...ctx,
    variant,
    shopContext,
    notificationJobId: job.id,
    attemptNumber: claimed.attempts,
  });

  if (outcome === "sent") {
    await db.notificationJob.update({
      where: { id: job.id },
      data: { status: "sent", lastError: null, nextRetryAt: null },
    });
    await maybeCompleteRestockEvent(job.restockEventId);
    return { status: "sent" };
  }

  if (outcome === "held") {
    await db.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "held",
        lastError: "quota or channel held",
        nextRetryAt: new Date(Date.now() + 15 * 60 * 1000),
        fairShareKey: BigInt(Date.now()),
      },
    });
    return { status: "held" };
  }

  if (outcome === "timeout_ambiguous") {
    // Leave job queued with delay; deliverOne will no-op if a success attempt appears.
    await scheduleRetry(claimed, "provider timeout — ambiguous acceptance");
    return { status: "retry", retryAfterMs: backoffMs(claimed.attempts) };
  }

  if (claimed.attempts >= claimed.maxAttempts) {
    await failJob(claimed, "max attempts exceeded", true);
    return { status: "dead" };
  }

  await scheduleRetry(claimed, "delivery failed");
  return { status: "retry", retryAfterMs: backoffMs(claimed.attempts) };
}

async function claimJob(
  job: NotificationJob,
): Promise<NotificationJob | null> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const rows = await db.$queryRaw<NotificationJob[]>`
    UPDATE "NotificationJob"
    SET "status" = 'sending',
        "attempts" = "attempts" + 1,
        "updatedAt" = NOW()
    WHERE "id" = ${job.id}
      AND (
        "status" IN ('queued', 'held', 'failed')
        OR ("status" = 'sending' AND "updatedAt" < ${staleBefore})
      )
      AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
    RETURNING *
  `;
  return rows[0] ?? null;
}

async function scheduleRetry(
  job: NotificationJob,
  error: string,
): Promise<void> {
  if (job.attempts >= job.maxAttempts) {
    await failJob(job, error, true);
    return;
  }
  await db.notificationJob.update({
    where: { id: job.id },
    data: {
      status: "queued",
      lastError: error.slice(0, 500),
      nextRetryAt: new Date(Date.now() + backoffMs(job.attempts)),
      fairShareKey: BigInt(Date.now()),
    },
  });
}

async function failJob(
  job: NotificationJob,
  error: string,
  dead: boolean,
): Promise<void> {
  await db.notificationJob.update({
    where: { id: job.id },
    data: {
      status: dead ? "dead" : "failed",
      lastError: error.slice(0, 500),
      nextRetryAt: null,
    },
  });
}

function backoffMs(attempts: number): number {
  const exp = Math.min(attempts, 6);
  const jitter = Math.floor(Math.random() * 1000);
  return BASE_BACKOFF_MS * 2 ** Math.max(exp - 1, 0) + jitter;
}

async function maybeCompleteRestockEvent(restockEventId: string): Promise<void> {
  const open = await db.notificationJob.count({
    where: {
      restockEventId,
      status: { in: ["queued", "sending", "held", "failed"] },
    },
  });
  if (open === 0) {
    await db.restockEvent.update({
      where: { id: restockEventId },
      data: { status: "completed" },
    });
  }
}

/**
 * Fair-share peek: one due job per shop, oldest fairShareKey first.
 * Does not claim — `processNotificationJob` performs the atomic claim.
 */
export async function peekFairShareJobIds(limit = 10): Promise<string[]> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM (
      SELECT DISTINCT ON ("shopId") "id", "shopId", "fairShareKey"
      FROM "NotificationJob"
      WHERE (
        "status" IN ('queued', 'held', 'failed')
        OR ("status" = 'sending' AND "updatedAt" < ${staleBefore})
      )
      AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
      ORDER BY "shopId", "fairShareKey" ASC, "createdAt" ASC
    ) AS per_shop
    ORDER BY "fairShareKey" ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

export type { Shop, StockAlert };
