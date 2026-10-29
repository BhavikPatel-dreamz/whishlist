import type { Shop } from "@prisma/client";
import { Prisma } from "@prisma/client";
import db from "../../db.server";
import type { ShopContext, VariantSummary } from "../shopify-data.server";
import { ALERT_STATUS } from "../../models/stock-alert.server";
import { checkRestockEligibility } from "./restock-eligibility.server";
import { publishOutboxBatch } from "./outbox.server";

const ALERT_PAGE = 500;
const JOB_INSERT_CHUNK = 200;

export type EnqueueResult = {
  variantId: string;
  claimed: number;
  sent: number;
  failed: number;
  jobsCreated: number;
  restockEventId?: string;
  skippedReason?: string;
};

/**
 * Persist a RestockEvent + NotificationJobs + Outbox rows, then best-effort
 * publish to SQS. Does not call Mailgun. Safe under duplicate webhooks.
 */
export async function enqueueRestockAlerts(params: {
  shop: Shop;
  variant: VariantSummary;
  shopContext: ShopContext;
  inventoryItemId?: string | null;
  available?: number | null;
}): Promise<EnqueueResult> {
  const { shop, variant } = params;
  const base: EnqueueResult = {
    variantId: variant.variantId,
    claimed: 0,
    sent: 0,
    failed: 0,
    jobsCreated: 0,
  };

  const eligibility = await checkRestockEligibility(shop, variant);
  if (!eligibility.ok) {
    return { ...base, skippedReason: eligibility.reason };
  }

  // When double opt-in is on, only CONFIRMED get restock emails (match claimPendingAlerts).
  const enqueueStatuses = shop.doubleOptIn
    ? [ALERT_STATUS.confirmed]
    : [ALERT_STATUS.pending];

  const waitingCount = await db.stockAlert.count({
    where: {
      shopId: shop.id,
      variantId: variant.variantId,
      status: { in: enqueueStatuses },
    },
  });
  if (!waitingCount) {
    return { ...base, skippedReason: "no pending alerts" };
  }

  const restockEvent = await getOrCreateRestockEvent({
    shopId: shop.id,
    variantId: variant.variantId,
    productId: variant.productId,
    inventoryItemId: params.inventoryItemId ?? null,
    available: params.available ?? null,
    sellableOnlineQuantity: variant.sellableOnlineQuantity,
  });

  let jobsCreated = 0;
  let cursor: string | undefined;

  for (;;) {
    const alerts = await db.stockAlert.findMany({
      where: {
        shopId: shop.id,
        variantId: variant.variantId,
        status: { in: enqueueStatuses },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: ALERT_PAGE,
    });
    if (!alerts.length) break;
    cursor = alerts[alerts.length - 1].id;

    const fairShareKey = BigInt(Date.now());
    for (let i = 0; i < alerts.length; i += JOB_INSERT_CHUNK) {
      const chunk = alerts.slice(i, i + JOB_INSERT_CHUNK);
      const createdJobs: string[] = [];

      await db.$transaction(async (tx) => {
        for (const alert of chunk) {
          try {
            const job = await tx.notificationJob.create({
              data: {
                shopId: shop.id,
                restockEventId: restockEvent.id,
                stockAlertId: alert.id,
                status: "queued",
                fairShareKey,
              },
              select: { id: true },
            });
            createdJobs.push(job.id);
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              continue;
            }
            throw error;
          }
        }

        if (createdJobs.length) {
          await tx.outboxMessage.createMany({
            data: createdJobs.map((jobId) => ({
              shopId: shop.id,
              kind: "notification_job",
              payload: { jobId },
            })),
          });
        }
      });

      jobsCreated += createdJobs.length;
    }

    if (alerts.length < ALERT_PAGE) break;
  }

  if (jobsCreated > 0 && restockEvent.status === "open") {
    await db.restockEvent.update({
      where: { id: restockEvent.id },
      data: { status: "enqueued" },
    });
  }

  // Best-effort publish; durable outbox retries via cron/worker if this fails.
  const publish = await publishOutboxBatch(Math.min(jobsCreated || 50, 100)).catch(
    (error) => {
      console.error("[enqueue] outbox publish failed", error);
      return { published: 0, failed: 0 };
    },
  );

  console.log(
    `[enqueue] shop=${shop.shop} variant=${variant.variantId} event=${restockEvent.id} jobs=${jobsCreated} published=${publish.published}`,
  );

  return {
    ...base,
    claimed: jobsCreated,
    jobsCreated,
    restockEventId: restockEvent.id,
    skippedReason: jobsCreated ? undefined : "no new jobs (already enqueued)",
  };
}

async function getOrCreateRestockEvent(params: {
  shopId: string;
  variantId: string;
  productId: string;
  inventoryItemId: string | null;
  available: number | null;
  sellableOnlineQuantity: number;
}) {
  const existing = await db.restockEvent.findFirst({
    where: {
      shopId: params.shopId,
      variantId: params.variantId,
      status: { in: ["open", "enqueued"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    await db.restockEvent.update({
      where: { id: existing.id },
      data: {
        available: params.available,
        sellableOnlineQuantity: params.sellableOnlineQuantity,
        inventoryItemId: params.inventoryItemId ?? existing.inventoryItemId,
        productId: params.productId,
      },
    });
    return existing;
  }

  const cycleKey = `${new Date().toISOString().slice(0, 13)}:${params.variantId}`;
  try {
    return await db.restockEvent.create({
      data: {
        shopId: params.shopId,
        variantId: params.variantId,
        productId: params.productId,
        inventoryItemId: params.inventoryItemId,
        cycleKey,
        available: params.available,
        sellableOnlineQuantity: params.sellableOnlineQuantity,
        status: "open",
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const again = await db.restockEvent.findUnique({
        where: {
          shopId_variantId_cycleKey: {
            shopId: params.shopId,
            variantId: params.variantId,
            cycleKey,
          },
        },
      });
      if (again) return again;
    }
    throw error;
  }
}
