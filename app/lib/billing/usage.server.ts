import type { Plan } from "@prisma/client";
import db from "../../db.server";

export type Reservation = "reserved" | "already_consumed" | "exceeded";

/** UTC calendar period key from the plan allowance window (`day` or `month`). */
export function usagePeriodKey(allowanceWindow: string, now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  if (allowanceWindow === "month") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

export function notificationIdempotencyKey(stockAlertId: string, notifyGeneration: number): string {
  return `${stockAlertId}:${notifyGeneration}`;
}

/** Accepted sends in the shop's current UTC allowance window. */
export async function emailsConsumedThisPeriod(
  shopId: string,
  allowanceWindow: string,
  now: Date = new Date(),
): Promise<number> {
  const periodKey = usagePeriodKey(allowanceWindow, now);
  const row = await db.usageCounter.findUnique({
    where: { shopId_periodKey: { shopId, periodKey } },
    select: { consumedCount: true },
  });
  return row?.consumedCount ?? 0;
}

/**
 * Holds one unit of quota for this alert generation.
 * A consumed row is not reserved again. A released row can be reserved again
 * without creating a second ledger entry.
 */
export async function reserveNotification(params: {
  shopId: string;
  stockAlertId: string;
  notifyGeneration: number;
  plan: Pick<Plan, "allowance" | "allowanceWindow">;
  now?: Date;
}): Promise<Reservation> {
  const now = params.now ?? new Date();
  const periodKey = usagePeriodKey(params.plan.allowanceWindow, now);
  const idempotencyKey = notificationIdempotencyKey(params.stockAlertId, params.notifyGeneration);

  return db.$transaction(async (tx) => {
    await tx.usageCounter.upsert({
      where: { shopId_periodKey: { shopId: params.shopId, periodKey } },
      create: { shopId: params.shopId, periodKey },
      update: {},
    });

    const locked = await tx.$queryRaw<Array<{ reservedCount: number; consumedCount: number }>>`
      SELECT "reservedCount", "consumedCount"
      FROM "UsageCounter"
      WHERE "shopId" = ${params.shopId} AND "periodKey" = ${periodKey}
      FOR UPDATE
    `;
    const counter = locked[0] ?? { reservedCount: 0, consumedCount: 0 };

    const existing = await tx.usageLedger.findUnique({ where: { idempotencyKey } });
    if (existing?.state === "consumed") return "already_consumed";
    if (existing?.state === "reserved") return "reserved";

    if (counter.reservedCount + counter.consumedCount >= params.plan.allowance) {
      return "exceeded";
    }

    if (existing) {
      await tx.usageLedger.update({
        where: { id: existing.id },
        data: { state: "reserved", periodKey },
      });
    } else {
      await tx.usageLedger.create({
        data: {
          shopId: params.shopId,
          stockAlertId: params.stockAlertId,
          idempotencyKey,
          periodKey,
          state: "reserved",
        },
      });
    }

    await tx.usageCounter.update({
      where: { shopId_periodKey: { shopId: params.shopId, periodKey } },
      data: { reservedCount: { increment: 1 } },
    });
    return "reserved";
  });
}

export async function consumeNotification(stockAlertId: string, notifyGeneration: number): Promise<void> {
  const idempotencyKey = notificationIdempotencyKey(stockAlertId, notifyGeneration);
  await db.$transaction(async (tx) => {
    const row = await tx.usageLedger.findUnique({ where: { idempotencyKey } });
    if (!row || row.state !== "reserved") return;
    await tx.usageLedger.update({ where: { id: row.id }, data: { state: "consumed" } });
    await tx.usageCounter.update({
      where: { shopId_periodKey: { shopId: row.shopId, periodKey: row.periodKey } },
      data: { reservedCount: { decrement: 1 }, consumedCount: { increment: 1 } },
    });
  });
}

export async function releaseNotification(stockAlertId: string, notifyGeneration: number): Promise<void> {
  const idempotencyKey = notificationIdempotencyKey(stockAlertId, notifyGeneration);
  await db.$transaction(async (tx) => {
    const row = await tx.usageLedger.findUnique({ where: { idempotencyKey } });
    if (!row || row.state !== "reserved") return;
    await tx.usageLedger.update({ where: { id: row.id }, data: { state: "released" } });
    await tx.usageCounter.update({
      where: { shopId_periodKey: { shopId: row.shopId, periodKey: row.periodKey } },
      data: { reservedCount: { decrement: 1 } },
    });
  });
}
