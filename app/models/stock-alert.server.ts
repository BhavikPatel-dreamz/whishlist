import { Prisma } from "@prisma/client";
import db from "../db.server";
import { ProxyError } from "../lib/proxy.server";
import type { StockAlert } from "@prisma/client";

export const ALERT_STATUS = {
  pending: "PENDING",
  confirmed: "CONFIRMED",
  sending: "SENDING",
  sent: "SENT",
  failed: "FAILED",
  cancelled: "CANCELLED",
} as const;

export type AlertStatus = (typeof ALERT_STATUS)[keyof typeof ALERT_STATUS];

/**
 * A row is flipped to SENDING before delivery. If the worker dies between the claim and the
 * send, it would otherwise stay SENDING forever and the shopper would never be emailed. Any
 * SENDING row older than this is treated as abandoned and eligible to be re-claimed.
 */
export const STALE_SENDING_MS = 10 * 60 * 1000;

export async function createStockAlert(input: {
  shopId: string;
  email: string;
  phone?: string | null;
  customerId?: string | null;
  productId: string;
  variantId: string;
  productTitle?: string | null;
  variantTitle?: string | null;
  locale?: string | null;
  perVariantCap?: number;
}): Promise<{ alert: StockAlert; created: boolean }> {
  if (input.perVariantCap && input.perVariantCap > 0) {
    const waiting = await db.stockAlert.count({
      where: { shopId: input.shopId, variantId: input.variantId, status: ALERT_STATUS.pending },
    });
    if (waiting >= input.perVariantCap) {
      throw new ProxyError(429, "This waitlist is full right now", "waitlist_full");
    }
  }

  const existing = await db.stockAlert.findUnique({
    where: {
      one_alert_per_email_variant: {
        shopId: input.shopId,
        variantId: input.variantId,
        email: input.email,
      },
    },
  });

  if (existing) {
    // Re-subscribing after a previous alert was sent or cancelled reopens the same row.
    if (existing.status === ALERT_STATUS.pending || existing.status === ALERT_STATUS.sending) {
      return { alert: existing, created: false };
    }
    const alert = await db.stockAlert.update({
      where: { id: existing.id },
      data: {
        status: ALERT_STATUS.pending,
        phone: input.phone ?? existing.phone,
        customerId: input.customerId ?? existing.customerId,
        productTitle: input.productTitle ?? existing.productTitle,
        variantTitle: input.variantTitle ?? existing.variantTitle,
        attempts: 0,
        lastError: null,
        notifiedAt: null,
      },
    });
    return { alert, created: true };
  }

  const alert = await db.stockAlert.create({
    data: {
      shopId: input.shopId,
      email: input.email,
      phone: input.phone ?? null,
      customerId: input.customerId ?? null,
      productId: input.productId,
      variantId: input.variantId,
      productTitle: input.productTitle ?? null,
      variantTitle: input.variantTitle ?? null,
      locale: input.locale ?? null,
      status: ALERT_STATUS.pending,
    },
  });
  return { alert, created: true };
}

/**
 * Atomically claims the alerts for a variant that still need an email.
 *
 * The `UPDATE … RETURNING *` is a single statement, so two concurrent restock webhooks for the
 * same variant can never claim the same row — the loser's update matches zero rows. This is what
 * keeps a noisy restock (several inventory_levels/update events in a row) from sending duplicate
 * emails.
 *
 * Alongside the fresh PENDING/CONFIRMED rows, it also re-claims rows stuck in SENDING for longer
 * than `STALE_SENDING_MS` — those were abandoned by a crashed dispatch. `FOR UPDATE SKIP LOCKED`
 * plus the age guard mean a *healthy* in-flight dispatch (row-locked and just-touched) is never
 * grabbed; only genuinely stranded rows are recovered.
 */
export async function claimPendingAlerts(
  shopId: string,
  variantId: string,
  batchSize = 500,
  onlyConfirmed = false,
): Promise<StockAlert[]> {
  const statuses = onlyConfirmed
    ? [ALERT_STATUS.confirmed]
    : [ALERT_STATUS.pending, ALERT_STATUS.confirmed];
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);

  return db.$queryRaw<StockAlert[]>`
    UPDATE "StockAlert"
    SET "status" = ${ALERT_STATUS.sending},
        "attempts" = "attempts" + 1,
        "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "StockAlert"
      WHERE "shopId" = ${shopId}
        AND "variantId" = ${variantId}
        AND (
          "status" IN (${Prisma.join(statuses)})
          OR ("status" = ${ALERT_STATUS.sending} AND "updatedAt" < ${staleBefore})
        )
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
}

export async function markAlertSent(id: string): Promise<void> {
  await db.stockAlert.update({
    where: { id },
    data: { status: ALERT_STATUS.sent, notifiedAt: new Date(), lastError: null },
  });
}

export async function markAlertFailed(id: string, error: string, attempts: number): Promise<void> {
  // Give up after three tries so a permanently bad address stops re-queueing.
  await db.stockAlert.update({
    where: { id },
    data: {
      status: attempts >= 3 ? ALERT_STATUS.failed : ALERT_STATUS.pending,
      lastError: error.slice(0, 500),
    },
  });
}

export async function cancelStockAlert(id: string): Promise<void> {
  await db.stockAlert.updateMany({
    where: { id },
    data: { status: ALERT_STATUS.cancelled },
  });
}

/**
 * Distinct variantIds that still have work waiting: PENDING/CONFIRMED that were never delivered,
 * plus SENDING rows abandoned by a crashed dispatch, and — for a deliberate manual retry only —
 * FAILED rows. Used by the retry lever to decide which variants to re-check and re-dispatch.
 */
export async function variantIdsNeedingRetry(
  shopId: string,
  opts: { includeFailed?: boolean } = {},
): Promise<string[]> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const statuses: AlertStatus[] = [ALERT_STATUS.pending, ALERT_STATUS.confirmed];
  if (opts.includeFailed) statuses.push(ALERT_STATUS.failed);

  const rows = await db.stockAlert.findMany({
    where: {
      shopId,
      OR: [
        { status: { in: statuses } },
        { status: ALERT_STATUS.sending, updatedAt: { lt: staleBefore } },
      ],
    },
    select: { variantId: true },
    distinct: ["variantId"],
  });
  return rows.map((row) => row.variantId);
}

/**
 * Puts FAILED alerts back into the PENDING queue so the next dispatch re-sends them. Resets the
 * attempt counter because this only runs from an explicit human "retry" — an address that
 * exhausted its automatic tries gets a fresh chance. Returns how many rows were reactivated.
 */
export async function reactivateFailedAlerts(
  shopId: string,
  variantIds?: string[],
): Promise<number> {
  const result = await db.stockAlert.updateMany({
    where: {
      shopId,
      status: ALERT_STATUS.failed,
      ...(variantIds && variantIds.length ? { variantId: { in: variantIds } } : {}),
    },
    data: { status: ALERT_STATUS.pending, attempts: 0, lastError: null },
  });
  return result.count;
}

/** Confirms a stock alert after the subscriber clicks the confirmation link (double opt-in). */
export async function confirmStockAlert(id: string): Promise<boolean> {
  const result = await db.stockAlert.updateMany({
    where: { id, status: ALERT_STATUS.pending },
    data: { status: ALERT_STATUS.confirmed },
  });
  return result.count > 0;
}

export async function markAlertConverted(id: string): Promise<void> {
  await db.stockAlert.updateMany({
    where: { id, convertedAt: null },
    data: { convertedAt: new Date() },
  });
}

export async function stockAlertStats(shopId: string) {
  const [grouped, converted, last30] = await Promise.all([
    db.stockAlert.groupBy({
      by: ["status"],
      where: { shopId },
      _count: { _all: true },
    }),
    db.stockAlert.count({ where: { shopId, convertedAt: { not: null } } }),
    db.stockAlert.count({
      where: { shopId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const byStatus = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
  const sent = byStatus[ALERT_STATUS.sent] ?? 0;
  return {
    total: grouped.reduce((sum, row) => sum + row._count._all, 0),
    pending: byStatus[ALERT_STATUS.pending] ?? 0,
    confirmed: byStatus[ALERT_STATUS.confirmed] ?? 0,
    sending: byStatus[ALERT_STATUS.sending] ?? 0,
    sent,
    failed: byStatus[ALERT_STATUS.failed] ?? 0,
    cancelled: byStatus[ALERT_STATUS.cancelled] ?? 0,
    converted,
    conversionRate: sent ? Math.round((converted / sent) * 1000) / 10 : 0,
    last30,
  };
}

export type AlertFilters = {
  status?: string | null;
  query?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listStockAlerts(shopId: string, filters: AlertFilters = {}) {
  const pageSize = Math.min(filters.pageSize ?? 25, 250);
  const page = Math.max(filters.page ?? 1, 1);
  const where = buildAlertWhere(shopId, filters);

  const [rows, total] = await Promise.all([
    db.stockAlert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.stockAlert.count({ where }),
  ]);
  return { rows, total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function allStockAlertsForExport(shopId: string, filters: AlertFilters = {}) {
  return db.stockAlert.findMany({
    where: buildAlertWhere(shopId, filters),
    orderBy: { createdAt: "desc" },
    take: 50_000,
  });
}

function buildAlertWhere(shopId: string, filters: AlertFilters) {
  const query = filters.query?.trim();
  return {
    shopId,
    ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" as const } },
            { productTitle: { contains: query, mode: "insensitive" as const } },
            { productId: { contains: query } },
            { variantId: { contains: query } },
          ],
        }
      : {}),
  };
}

/** Returns the email for each logged-in customerId found in StockAlerts. */
export async function customerEmailsByCustomerIds(
  shopId: string,
  customerIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!customerIds.length) return result;

  const rows = await db.stockAlert.findMany({
    where: { shopId, customerId: { in: customerIds }, email: { not: "" } },
    select: { customerId: true, email: true },
    distinct: ["customerId"],
  });

  for (const row of rows) {
    if (row.customerId) result.set(row.customerId, row.email);
  }
  return result;
}

/** Waitlist depth per variant — surfaces "restock this first" signal to the merchant. */
export async function topRequestedVariants(shopId: string, limit = 10) {
  const rows = await db.stockAlert.groupBy({
    by: ["productId", "variantId", "productTitle", "variantTitle"],
    where: { shopId, status: ALERT_STATUS.pending },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });
  return rows.map((row) => ({
    productId: row.productId,
    variantId: row.variantId,
    productTitle: row.productTitle,
    variantTitle: row.variantTitle,
    waiting: row._count._all,
  }));
}
