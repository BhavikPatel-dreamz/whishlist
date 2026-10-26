import { Prisma } from "@prisma/client";
import db from "../db.server";
import { ALERT_STATUS } from "./stock-alert.server";
import { getShopSettings } from "./shop-settings.server";

/**
 * Order attribution (ANALYTICS_REPORTS_SPEC.md section 6).
 *
 * For every order line the engine looks for the touches that could have caused
 * the purchase — a back-in-stock click, a wishlist page click, a saved item, a
 * notification that was sent but not clicked — and records them.
 *
 * `last_click` keeps only the highest priority touch per line, `any_touch` keeps
 * the best touch of every source. Both are idempotent: the unique key rejects a
 * replayed webhook.
 */

export type AttrSource = "WISHLIST" | "RESTOCK_ALERT";
export type AttrType = "DIRECT" | "ESTIMATED";

export const ATTR_MODEL = {
  lastClick: "last_click",
  anyTouch: "any_touch",
} as const;

/**
 * Touch priority (lower wins): direct restock click > direct wishlist >
 * estimated restock > estimated wishlist.
 */
const TOUCH_PRIORITY: Record<string, number> = {
  "RESTOCK_ALERT:DIRECT": 0,
  "WISHLIST:DIRECT": 1,
  "RESTOCK_ALERT:ESTIMATED": 2,
  "WISHLIST:ESTIMATED": 3,
};

export type Touch = {
  source: AttrSource;
  type: AttrType;
  touchAt: Date;
  notificationLogId: string | null;
  wishlistItemId: string | null;
};

/** A normalized order line. */
export type OrderLine = {
  /** Shopify's line item id — the attribution key. */
  lineItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Line revenue: unit price × quantity − discount. */
  revenue: number;
  /** The line came from the wishlist page (`_wishlist_stock`). */
  fromWishlist: boolean;
  /** The line came from a back-in-stock notification (verified alert id). */
  restockAlertId: string | null;
};

export type AttributeOrderInput = {
  shopId: string;
  orderId: string;
  orderNumber: string;
  orderEmail: string | null;
  customerId: string | null;
  /** Unified shopper id: the customer id when known, else the guest token. */
  shopperId: string | null;
  lines: OrderLine[];
  orderedAt: Date;
  /** Overrides the per-store attribution windows. */
  restockWindowDays?: number;
  wishlistWindowDays?: number;
};

const DAY_MS = 86400000;

/** Reads the line-item properties a shopper can carry into checkout. */
export function lineProperties(
  lineItem: Record<string, any>,
): Record<string, any> {
  const properties = lineItem?.properties;
  if (Array.isArray(properties)) {
    const map: Record<string, any> = {};
    for (const property of properties) {
      if (property?.name) map[property.name] = property?.value;
    }
    return map;
  }
  return properties && typeof properties === "object" ? properties : {};
}

/**
 * Turns a Shopify order payload into normalized lines, including the revenue
 * each line contributed.
 */
export function normalizeOrderLines(
  items: Array<Record<string, any>>,
  options: {
    /** Resolves the back-in-stock alert a line came from, when it can be trusted. */
    resolveRestockAlertId?: (item: Record<string, any>) => string | null;
  } = {},
): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const item of items ?? []) {
    const productId = item?.product_id || item?.productId;
    if (!productId) continue;
    const properties = lineProperties(item);
    const unitPrice = Number(item.price);
    const quantity = Number(item.quantity);
    const discount = Number(item.total_discount || 0);
    const lineRevenue = Number.isFinite(unitPrice)
      ? Math.max(
          0,
          unitPrice * (Number.isFinite(quantity) ? quantity : 0) - discount,
        )
      : 0;
    lines.push({
      lineItemId: String(item.id ?? `${productId}:${lines.length}`),
      productId: String(productId),
      variantId:
        item.variant_id || item.variantId
          ? String(item.variant_id || item.variantId)
          : null,
      quantity: Number.isFinite(quantity) ? quantity : 1,
      revenue: lineRevenue,
      fromWishlist: properties._wishlist_stock === "true",
      restockAlertId: options.resolveRestockAlertId?.(item) ?? null,
    });
  }
  return lines;
}

/**
 * Finds the touches for every line of an order.
 *
 * The lookups are batched: one query for the shopper's saved products and one
 * for their back-in-stock alerts, no matter how many lines the order has.
 */
export async function findOrderTouches({
  shopId,
  customerId,
  shopperId,
  email,
  lines,
  orderedAt,
  restockWindowDays,
  wishlistWindowDays,
}: {
  shopId: string;
  customerId: string | null;
  shopperId: string | null;
  email: string | null;
  lines: OrderLine[];
  orderedAt: Date;
  restockWindowDays: number;
  wishlistWindowDays: number;
}): Promise<Map<string, Touch[]>> {
  const touches = new Map<string, Touch[]>();
  if (!lines.length) return touches;

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const variantIds = [
    ...new Set(lines.map((line) => line.variantId).filter(Boolean) as string[]),
  ];

  const restockFrom = new Date(
    orderedAt.getTime() - restockWindowDays * DAY_MS,
  );
  const wishlistFrom = new Date(
    orderedAt.getTime() - wishlistWindowDays * DAY_MS,
  );

  // The shopper's saved products, newest first. A customer id matches the
  // customer rows; the guest token matches the rows saved before sign-in.
  const identityFilter: Prisma.WishlistItemWhereInput[] = [];
  if (customerId) identityFilter.push({ customerId });
  if (shopperId && shopperId !== customerId) identityFilter.push({ shopperId });

  const [savedItems, alerts] = await Promise.all([
    identityFilter.length
      ? db.wishlistItem.findMany({
          where: {
            shopId,
            productId: { in: productIds },
            OR: identityFilter,
          },
          select: {
            id: true,
            productId: true,
            variantId: true,
            createdAt: true,
            customerId: true,
            shopperId: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    db.stockAlert.findMany({
      where: {
        shopId,
        productId: { in: productIds },
        ...(variantIds.length ? { variantId: { in: variantIds } } : {}),
        ...(customerId
          ? { customerId }
          : email
            ? { email: email.toLowerCase() }
            : {}),
        notifiedAt: { gte: restockFrom, not: null },
      },
      select: {
        id: true,
        productId: true,
        variantId: true,
        notifiedAt: true,
        convertedAt: true,
        status: true,
      },
      orderBy: { notifiedAt: "desc" },
    }),
  ]);

  for (const line of lines) {
    const lineTouches: Touch[] = [];

    // --- Back in stock ---
    const matchedAlert = alerts.find(
      (alert) =>
        alert.productId === line.productId &&
        (!line.variantId ||
          !alert.variantId ||
          alert.variantId === line.variantId),
    );
    const directAlert = line.restockAlertId
      ? alerts.find((alert) => alert.id === line.restockAlertId)
      : undefined;
    const clickedAlert =
      directAlert ??
      alerts.find(
        (alert) =>
          alert.convertedAt &&
          alert.convertedAt >= restockFrom &&
          alert.convertedAt <= orderedAt,
      );
    if (clickedAlert?.convertedAt) {
      lineTouches.push({
        source: "RESTOCK_ALERT",
        type: "DIRECT",
        touchAt: clickedAlert.convertedAt,
        notificationLogId: null,
        wishlistItemId: null,
      });
    } else if (matchedAlert?.notifiedAt) {
      lineTouches.push({
        source: "RESTOCK_ALERT",
        type: "ESTIMATED",
        touchAt: matchedAlert.notifiedAt,
        notificationLogId: null,
        wishlistItemId: null,
      });
    }

    // --- Wishlist ---
    const saved = savedItems.find(
      (item) =>
        item.productId === line.productId &&
        (!line.variantId ||
          !item.variantId ||
          item.variantId === line.variantId),
    );
    if (line.fromWishlist) {
      lineTouches.push({
        source: "WISHLIST",
        type: "DIRECT",
        touchAt: saved?.createdAt ?? orderedAt,
        notificationLogId: null,
        wishlistItemId: saved?.id ?? null,
      });
    } else if (
      saved &&
      saved.createdAt >= wishlistFrom &&
      saved.createdAt <= orderedAt
    ) {
      lineTouches.push({
        source: "WISHLIST",
        type: "ESTIMATED",
        touchAt: saved.createdAt,
        notificationLogId: null,
        wishlistItemId: saved.id,
      });
    }

    if (lineTouches.length) touches.set(line.lineItemId, lineTouches);
  }

  return touches;
}

/** Picks the highest priority touch of a line. */
export function pickPrimaryTouch(touches: Touch[]): Touch | null {
  if (!touches.length) return null;
  return [...touches].sort(
    (a, b) =>
      (TOUCH_PRIORITY[`${a.source}:${a.type}`] ?? 99) -
      (TOUCH_PRIORITY[`${b.source}:${b.type}`] ?? 99),
  )[0];
}

/**
 * Keeps the best touch per source, so a line that was touched by both a restock
 * alert and a wishlist still gets a row for each source under `any_touch`.
 */
export function pickTouchPerSource(touches: Touch[]): Touch[] {
  const bySource = new Map<AttrSource, Touch>();
  for (const touch of touches) {
    const current = bySource.get(touch.source);
    if (!current) {
      bySource.set(touch.source, touch);
      continue;
    }
    const currentPriority =
      TOUCH_PRIORITY[`${current.source}:${current.type}`] ?? 99;
    const nextPriority = TOUCH_PRIORITY[`${touch.source}:${touch.type}`] ?? 99;
    if (nextPriority < currentPriority) bySource.set(touch.source, touch);
  }
  return [...bySource.values()];
}

/**
 * Writes the attribution rows for an order. Safe to call again for the same
 * order: the unique key on (shop, line, source, model) rejects duplicates.
 */
export async function recordOrderAttribution({
  shopId,
  orderId,
  orderNumber,
  customerId,
  shopperId,
  lines,
  orderedAt,
  restockWindowDays,
  wishlistWindowDays,
  touches,
}: {
  shopId: string;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  shopperId: string | null;
  lines: OrderLine[];
  orderedAt: Date;
  restockWindowDays: number;
  wishlistWindowDays: number;
  touches: Map<string, Touch[]>;
}): Promise<number> {
  const rows: Prisma.AttributionCreateManyInput[] = [];

  for (const line of lines) {
    const lineTouches = touches.get(line.lineItemId);
    if (!lineTouches?.length) continue;

    const primary = pickPrimaryTouch(lineTouches);
    if (primary) {
      rows.push({
        shopId,
        orderId,
        lineItemId: line.lineItemId,
        orderNumber,
        customerId,
        shopperId,
        productId: line.productId,
        variantId: line.variantId,
        source: primary.source,
        type: primary.type,
        model: ATTR_MODEL.lastClick,
        notificationLogId: primary.notificationLogId,
        wishlistItemId: primary.wishlistItemId,
        revenue: new Prisma.Decimal(line.revenue.toFixed(2)),
        quantity: line.quantity,
        orderedAt,
        touchAt: primary.touchAt,
      });
    }

    for (const touch of pickTouchPerSource(lineTouches)) {
      if (touch === primary) continue;
      rows.push({
        shopId,
        orderId,
        lineItemId: line.lineItemId,
        orderNumber,
        customerId,
        shopperId,
        productId: line.productId,
        variantId: line.variantId,
        source: touch.source,
        type: touch.type,
        model: ATTR_MODEL.anyTouch,
        notificationLogId: touch.notificationLogId,
        wishlistItemId: touch.wishlistItemId,
        revenue: new Prisma.Decimal(line.revenue.toFixed(2)),
        quantity: line.quantity,
        orderedAt,
        touchAt: touch.touchAt,
      });
    }
  }

  if (!rows.length) return 0;

  try {
    const result = await db.attribution.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  } catch (error: unknown) {
    // A concurrent webhook for the same order can race the unique key.
    if ((error as { code?: string }).code === "P2002") return 0;
    throw error;
  }
}

/**
 * Attributes an order end to end: finds the touches and writes the rows.
 * Returns the number of attribution rows written.
 */
export async function attributeOrder(
  input: AttributeOrderInput,
): Promise<number> {
  if (!input.lines.length) return 0;
  const settings = await getShopSettings(input.shopId);
  const restockWindowDays =
    input.restockWindowDays ?? settings.restockWindowDays;
  const wishlistWindowDays =
    input.wishlistWindowDays ?? settings.wishlistWindowDays;

  const touches = await findOrderTouches({
    shopId: input.shopId,
    customerId: input.customerId,
    shopperId: input.shopperId,
    email: input.orderEmail,
    lines: input.lines,
    orderedAt: input.orderedAt,
    restockWindowDays,
    wishlistWindowDays,
  });

  return recordOrderAttribution({
    shopId: input.shopId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    customerId: input.customerId,
    shopperId: input.shopperId,
    lines: input.lines,
    orderedAt: input.orderedAt,
    restockWindowDays,
    wishlistWindowDays,
    touches,
  });
}

/**
 * Removes or reduces the attribution of a cancelled or refunded order so the
 * revenue reports stay correct.
 */
export async function revokeOrderAttribution({
  shopId,
  orderId,
  revenue,
}: {
  shopId: string;
  orderId: string;
  /** Revenue to subtract; omit to remove the rows entirely. */
  revenue?: number;
}): Promise<number> {
  const rows = await db.attribution.findMany({
    where: { shopId, orderId },
    select: { id: true, revenue: true },
  });
  if (!rows.length) return 0;

  if (revenue === undefined) {
    const result = await db.attribution.deleteMany({
      where: { shopId, orderId },
    });
    return result.count;
  }

  // A partial refund scales the attributed revenue down rather than removing it.
  const total = rows.reduce((sum, row) => sum + Number(row.revenue), 0);
  if (total <= 0) {
    const result = await db.attribution.deleteMany({
      where: { shopId, orderId },
    });
    return result.count;
  }
  const factor = Math.max(0, Math.min(1, 1 - revenue / total));
  await db.$transaction(
    rows.map((row) =>
      db.attribution.update({
        where: { id: row.id },
        data: {
          revenue: new Prisma.Decimal(
            (Number(row.revenue) * factor).toFixed(2),
          ),
        },
      }),
    ),
  );
  return rows.length;
}

/** The alert statuses that mean a notification is still waiting to go out. */
export const WAITING_ALERT_STATUSES = [
  ALERT_STATUS.pending,
  ALERT_STATUS.confirmed,
];
