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
export type AlertChannel = "email" | "sms" | "whatsapp";

export function stockAlertContactKey(
  channel: AlertChannel,
  contact: string,
): string {
  const normalized =
    channel === "email"
      ? contact.trim().toLowerCase()
      : contact.replace(/[^\d+]/g, "");
  return `${channel}:${normalized}`;
}

/**
 * A row is flipped to SENDING before delivery. If the worker dies between the claim and the
 * send, it would otherwise stay SENDING forever and the shopper would never be emailed. Any
 * SENDING row older than this is treated as abandoned and eligible to be re-claimed.
 */
export const STALE_SENDING_MS = 10 * 60 * 1000;

export async function createStockAlert(input: {
  shopId: string;
  channel: AlertChannel;
  email?: string | null;
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
      where: {
        shopId: input.shopId,
        variantId: input.variantId,
        status: ALERT_STATUS.pending,
      },
    });
    if (waiting >= input.perVariantCap) {
      throw new ProxyError(
        429,
        "This waitlist is full right now",
        "waitlist_full",
      );
    }
  }

  const contact = input.channel === "email" ? input.email : input.phone;
  if (!contact)
    throw new ProxyError(
      422,
      "A valid email or phone number is required",
      "missing_contact",
    );
  const contactKey = stockAlertContactKey(input.channel, contact);

  const existing = await db.stockAlert.findUnique({
    where: {
      one_alert_per_contact_variant: {
        shopId: input.shopId,
        variantId: input.variantId,
        contactKey,
      },
    },
  });

  if (existing) {
    // Re-subscribing after a previous alert was sent or cancelled reopens the same row.
    if (
      existing.status === ALERT_STATUS.pending ||
      existing.status === ALERT_STATUS.sending
    ) {
      return { alert: existing, created: false };
    }
    const alert = await db.stockAlert.update({
      where: { id: existing.id },
      data: {
        status: ALERT_STATUS.pending,
        channel: input.channel,
        email: input.email ?? null,
        phone: input.phone ?? null,
        customerId: input.customerId ?? existing.customerId,
        productTitle: input.productTitle ?? existing.productTitle,
        variantTitle: input.variantTitle ?? existing.variantTitle,
        attempts: 0,
        notifyGeneration: { increment: 1 },
        lastError: null,
        notifiedAt: null,
      },
    });
    return { alert, created: true };
  }

  const alert = await db.stockAlert.create({
    data: {
      shopId: input.shopId,
      channel: input.channel,
      contactKey,
      email: input.email ?? null,
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

export async function holdAlertForQuota(id: string, reason = "Notification limit reached"): Promise<void> {
  await db.$executeRaw`
    UPDATE "StockAlert"
    SET "status" = ${ALERT_STATUS.pending},
        "lastError" = ${reason},
        "attempts" = GREATEST("attempts" - 1, 0),
        "updatedAt" = NOW()
    WHERE "id" = ${id}
  `;
}

export async function markAlertSent(id: string): Promise<void> {
  await db.stockAlert.update({
    where: { id },
    data: {
      status: ALERT_STATUS.sent,
      notifiedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markAlertFailed(
  id: string,
  error: string,
  attempts: number,
): Promise<void> {
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
  const statuses: AlertStatus[] = [
    ALERT_STATUS.pending,
    ALERT_STATUS.confirmed,
  ];
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
      ...(variantIds && variantIds.length
        ? { variantId: { in: variantIds } }
        : {}),
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

export async function recordStockAlertPurchase(input: {
  alertId: string;
  variantId: string;
  orderId: string;
  revenue: string;
  currency: string;
  purchasedAt: Date;
}): Promise<boolean> {
  const revenue = Number(input.revenue);
  if (!Number.isFinite(revenue) || revenue < 0) return false;

  const result = await db.stockAlert.updateMany({
    where: {
      id: input.alertId,
      variantId: input.variantId,
      purchaseOrderId: null,
    },
    data: {
      purchaseOrderId: input.orderId,
      purchaseRevenue: new Prisma.Decimal(revenue.toFixed(2)),
      purchaseCurrency: input.currency || null,
      purchasedAt: input.purchasedAt,
    },
  });
  return result.count > 0;
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
      where: {
        shopId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const byStatus = Object.fromEntries(
    grouped.map((row) => [row.status, row._count._all]),
  );
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

/** Sort orders offered by the "Back-in-Stock Requests" list. */
export const ALERT_REQUEST_SORTS = {
  newest: "newest",
  oldest: "oldest",
  requests: "requests",
  products: "products",
  contact: "contact",
} as const;

export type AlertRequestSort =
  (typeof ALERT_REQUEST_SORTS)[keyof typeof ALERT_REQUEST_SORTS];

export type BackInStockRequestFilters = {
  status?: string | null;
  channel?: string | null;
  query?: string | null;
  productId?: string | null;
  /** Inclusive UTC day, `YYYY-MM-DD`. */
  from?: string | null;
  /** Inclusive UTC day, `YYYY-MM-DD`. */
  to?: string | null;
  sort?: string | null;
  outcome?: string | null;
  page?: number;
  pageSize?: number;
};

export type NormalizedRequestFilters = {
  status: string | null;
  channel: string | null;
  query: string | null;
  productId: string | null;
  outcome: "notified" | "clicked" | "purchased" | null;
  from: Date | null;
  toExclusive: Date | null;
};

export type RequestedProduct = {
  productId: string;
  productTitle: string | null;
  variantId: string;
  variantTitle: string | null;
  status: string;
  requestedAt: Date;
};

export type BackInStockRequestRow = {
  contactKey: string;
  email: string | null;
  phone: string | null;
  channel: string;
  customerId: string | null;
  requests: number;
  productCount: number;
  firstRequestAt: Date;
  lastRequestAt: Date;
  statuses: string[];
  notified: number;
  converted: number;
  products: RequestedProduct[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcDay(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turns raw query-string values into a canonical filter set shared by the SQL and the
 * Prisma query builders, so both always agree on what "the same request" means.
 */
export function normalizeRequestFilters(
  filters: BackInStockRequestFilters = {},
): NormalizedRequestFilters {
  const rawStatus = filters.status?.trim().toUpperCase() || "";
  const rawChannel = filters.channel?.trim().toLowerCase() || "";
  const rawQuery = filters.query?.trim() || "";
  const rawProduct = filters.productId?.trim() || "";
  const rawOutcome = filters.outcome?.trim().toLowerCase() || "";

  let from = parseUtcDay(filters.from);
  let to = parseUtcDay(filters.to);
  if (from && to && from.getTime() > to.getTime()) {
    const swap = from;
    from = to;
    to = swap;
  }

  return {
    status: rawStatus && rawStatus !== "ALL" ? rawStatus : null,
    channel: rawChannel === "email" || rawChannel === "sms" ? rawChannel : null,
    query: rawQuery || null,
    productId: rawProduct && rawProduct !== "ALL" ? rawProduct : null,
    outcome:
      rawOutcome === "notified" || rawOutcome === "clicked" || rawOutcome === "purchased"
        ? rawOutcome
        : null,
    from,
    toExclusive: to ? new Date(to.getTime() + DAY_MS) : null,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function buildRequestWhere(
  shopId: string,
  filters: NormalizedRequestFilters,
): Prisma.StockAlertWhereInput {
  return {
    shopId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.outcome === "notified" ? { notifiedAt: { not: null } } : {}),
    ...(filters.outcome === "clicked" ? { convertedAt: { not: null } } : {}),
    ...(filters.outcome === "purchased" ? { purchasedAt: { not: null } } : {}),
    ...(filters.from || filters.toExclusive
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.toExclusive ? { lt: filters.toExclusive } : {}),
          },
        }
      : {}),
    ...(filters.query
      ? {
          OR: [
            { email: { contains: filters.query, mode: "insensitive" as const } },
            { phone: { contains: filters.query, mode: "insensitive" as const } },
            { customerId: { contains: filters.query, mode: "insensitive" as const } },
            {
              productTitle: {
                contains: filters.query,
                mode: "insensitive" as const,
              },
            },
            {
              variantTitle: {
                contains: filters.query,
                mode: "insensitive" as const,
              },
            },
            { productId: { contains: filters.query, mode: "insensitive" as const } },
            { variantId: { contains: filters.query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

function buildRequestWhereSql(
  shopId: string,
  filters: NormalizedRequestFilters,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`"shopId" = ${shopId}`];
  if (filters.status) conditions.push(Prisma.sql`"status" = ${filters.status}`);
  if (filters.channel)
    conditions.push(Prisma.sql`"channel" = ${filters.channel}`);
  if (filters.productId)
    conditions.push(Prisma.sql`"productId" = ${filters.productId}`);
  if (filters.outcome === "notified")
    conditions.push(Prisma.sql`"notifiedAt" IS NOT NULL`);
  if (filters.outcome === "clicked")
    conditions.push(Prisma.sql`"convertedAt" IS NOT NULL`);
  if (filters.outcome === "purchased")
    conditions.push(Prisma.sql`"purchasedAt" IS NOT NULL`);
  if (filters.from)
    conditions.push(Prisma.sql`"createdAt" >= ${filters.from}`);
  if (filters.toExclusive)
    conditions.push(Prisma.sql`"createdAt" < ${filters.toExclusive}`);
  if (filters.query) {
    const pattern = `%${escapeLikePattern(filters.query)}%`;
    conditions.push(Prisma.sql`(
      "email" ILIKE ${pattern} ESCAPE '\\'
      OR "phone" ILIKE ${pattern} ESCAPE '\\'
      OR "customerId" ILIKE ${pattern} ESCAPE '\\'
      OR "productTitle" ILIKE ${pattern} ESCAPE '\\'
      OR "variantTitle" ILIKE ${pattern} ESCAPE '\\'
      OR "productId" ILIKE ${pattern} ESCAPE '\\'
      OR "variantId" ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  return Prisma.join(conditions, " AND ");
}

function requestOrderSql(sort?: string | null): Prisma.Sql {
  switch (sort) {
    case ALERT_REQUEST_SORTS.oldest:
      return Prisma.sql`MIN("createdAt") ASC, "contactKey" ASC`;
    case ALERT_REQUEST_SORTS.requests:
      return Prisma.sql`COUNT(*) DESC, "contactKey" ASC`;
    case ALERT_REQUEST_SORTS.products:
      return Prisma.sql`COUNT(DISTINCT "productId") DESC, "contactKey" ASC`;
    case ALERT_REQUEST_SORTS.contact:
      return Prisma.sql`"contactKey" ASC`;
    default:
      return Prisma.sql`MAX("createdAt") DESC, "contactKey" ASC`;
  }
}

type RequestGroupRow = {
  contactKey: string;
  email: string | null;
  phone: string | null;
  channel: string | null;
  customerId: string | null;
  requests: number;
  products: number;
  firstRequestAt: Date;
  lastRequestAt: Date;
  statuses: string[] | null;
  notified: number;
  converted: number;
};

/**
 * One row per customer (contact) that requested a back-in-stock notification, together
 * with the specific products and variants they asked to be notified about.
 *
 * The grouping happens in SQL so the row counts, distinct-product counts and pagination
 * are computed on the whole filtered set rather than on a page-sized sample.
 */
export async function listBackInStockRequests(
  shopId: string,
  filters: BackInStockRequestFilters = {},
) {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 5000);
  const page = Math.max(filters.page ?? 1, 1);
  const normalized = normalizeRequestFilters(filters);
  const where = buildRequestWhereSql(shopId, normalized);
  const orderBy = requestOrderSql(filters.sort);

  const [totals, grouped] = await Promise.all([
    db.$queryRaw<{
      customers: number;
      requests: number;
      products: number;
      notified: number;
      converted: number;
    }[]>(
      Prisma.sql`
        SELECT
          (COUNT(DISTINCT "contactKey"))::int AS "customers",
          (COUNT(*))::int AS "requests",
          (COUNT(DISTINCT "productId"))::int AS "products",
          (COUNT(*) FILTER (WHERE "notifiedAt" IS NOT NULL))::int AS "notified",
          (COUNT(*) FILTER (WHERE "convertedAt" IS NOT NULL))::int AS "converted"
        FROM "StockAlert"
        WHERE ${where}
      `,
    ),
    db.$queryRaw<RequestGroupRow[]>(Prisma.sql`
      SELECT
        "contactKey",
        MAX("email")::text AS "email",
        MAX("phone")::text AS "phone",
        MAX("channel")::text AS "channel",
        MAX("customerId")::text AS "customerId",
        (COUNT(*))::int AS "requests",
        (COUNT(DISTINCT "productId"))::int AS "products",
        MIN("createdAt") AS "firstRequestAt",
        MAX("createdAt") AS "lastRequestAt",
        ARRAY_AGG(DISTINCT "status")::text[] AS "statuses",
        (COUNT(*) FILTER (WHERE "notifiedAt" IS NOT NULL))::int AS "notified",
        (COUNT(*) FILTER (WHERE "convertedAt" IS NOT NULL))::int AS "converted"
      FROM "StockAlert"
      WHERE ${where}
      GROUP BY "contactKey"
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
  ]);

  const contactKeys = grouped.map((row) => row.contactKey);
  const detail = contactKeys.length
    ? await db.stockAlert.findMany({
        where: {
          ...buildRequestWhere(shopId, normalized),
          contactKey: { in: contactKeys },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 20_000,
      })
    : [];

  // Detail rows come back newest-first, so the first hit for a variant is its latest request.
  const productsByContact = new Map<string, RequestedProduct[]>();
  const seenVariants = new Map<string, Set<string>>();
  for (const alert of detail) {
    const seen = seenVariants.get(alert.contactKey) ?? new Set<string>();
    const key = `${alert.productId}:${alert.variantId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seenVariants.set(alert.contactKey, seen);
    const list = productsByContact.get(alert.contactKey) ?? [];
    list.push({
      productId: alert.productId,
      productTitle: alert.productTitle,
      variantId: alert.variantId,
      variantTitle: alert.variantTitle,
      status: alert.status,
      requestedAt: alert.createdAt,
    });
    productsByContact.set(alert.contactKey, list);
  }

  const rows: BackInStockRequestRow[] = grouped.map((row) => ({
    contactKey: row.contactKey,
    email: row.email,
    phone: row.phone,
    channel: row.channel || "email",
    customerId: row.customerId,
    requests: row.requests,
    productCount: row.products,
    firstRequestAt: row.firstRequestAt,
    lastRequestAt: row.lastRequestAt,
    statuses: row.statuses ?? [],
    notified: row.notified,
    converted: row.converted,
    products: productsByContact.get(row.contactKey) ?? [],
  }));

  const customers = totals[0]?.customers ?? 0;

  return {
    rows,
    total: customers,
    totals: {
      customers,
      requests: totals[0]?.requests ?? 0,
      products: totals[0]?.products ?? 0,
      notified: totals[0]?.notified ?? 0,
      converted: totals[0]?.converted ?? 0,
    },
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(customers / pageSize), 1),
  };
}

/** Every matching customer row, for CSV export. */
export async function allBackInStockRequests(
  shopId: string,
  filters: BackInStockRequestFilters = {},
) {
  return listBackInStockRequests(shopId, {
    ...filters,
    page: 1,
    pageSize: 5000,
  });
}

/** Products that have back-in-stock requests — powers the "Product" filter dropdown. */
export async function listRequestedProductOptions(
  shopId: string,
  limit = 200,
) {
  const rows = await db.stockAlert.groupBy({
    by: ["productId"],
    where: { shopId },
    _count: { _all: true },
    _max: { productTitle: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });

  return rows.map((row) => ({
    productId: row.productId,
    productTitle: row._max.productTitle,
    requests: row._count._all,
  }));
}

export async function listStockAlerts(
  shopId: string,
  filters: AlertFilters = {},
) {
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
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export async function allStockAlertsForExport(
  shopId: string,
  filters: AlertFilters = {},
) {
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
    ...(filters.status && filters.status !== "ALL"
      ? { status: filters.status }
      : {}),
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query } },
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
    if (row.customerId && row.email) result.set(row.customerId, row.email);
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
