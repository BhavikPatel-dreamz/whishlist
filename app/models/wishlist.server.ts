import db from "../db.server";
import { ProxyError } from "../lib/proxy.server";
import type { WishlistItem } from "@prisma/client";

export type Identity = { customerId: string | null; guestToken: string | null };

/**
 * A wishlist row belongs either to a logged-in customer or to a browser (guest token).
 * Guest tokens are opaque uuids minted client-side; they only ever scope a shopper to
 * their own rows, never to another shopper's.
 */
export function requireIdentity(identity: Identity): Identity {
  const customerId = identity.customerId?.trim() || null;
  const guestToken = identity.guestToken?.trim() || null;
  if (!customerId && !guestToken) {
    throw new ProxyError(
      400,
      "Missing customerId or guestToken",
      "missing_identity",
    );
  }
  if (guestToken && (guestToken.length < 8 || guestToken.length > 64)) {
    throw new ProxyError(400, "Invalid guest token", "invalid_guest_token");
  }
  return { customerId, guestToken };
}

function identityWhere(shopId: string, identity: Identity) {
  return identity.customerId
    ? { shopId, customerId: identity.customerId }
    : { shopId, guestToken: identity.guestToken, customerId: null };
}

export async function listWishlist(
  shopId: string,
  identity: Identity,
): Promise<WishlistItem[]> {
  return db.wishlistItem.findMany({
    where: identityWhere(shopId, identity),
    orderBy: { createdAt: "desc" },
    take: 250,
  });
}

export async function addToWishlist(
  shopId: string,
  identity: Identity,
  item: { productId: string; variantId: string | null; handle?: string | null },
): Promise<WishlistItem> {
  const existing = await db.wishlistItem.findFirst({
    where: {
      ...identityWhere(shopId, identity),
      productId: item.productId,
      variantId: item.variantId,
    },
  });
  if (existing) return existing;

  try {
    return await db.wishlistItem.create({
      data: {
        shopId,
        customerId: identity.customerId,
        guestToken: identity.customerId ? null : identity.guestToken,
        productId: item.productId,
        variantId: item.variantId,
        handle: item.handle ?? null,
      },
    });
  } catch (error) {
    // Two concurrent taps on the heart button: fall back to the winning row.
    const raced = await db.wishlistItem.findFirst({
      where: {
        ...identityWhere(shopId, identity),
        productId: item.productId,
        variantId: item.variantId,
      },
    });
    if (raced) return raced;
    throw error;
  }
}

export async function removeFromWishlist(
  shopId: string,
  identity: Identity,
  item: { productId: string; variantId?: string | null },
): Promise<number> {
  const { count } = await db.wishlistItem.deleteMany({
    where: {
      ...identityWhere(shopId, identity),
      productId: item.productId,
      // Omitting variantId clears every variant of the product.
      ...(item.variantId ? { variantId: item.variantId } : {}),
    },
  });
  return count;
}

/**
 * Called when a guest signs in: re-keys their saved items onto the customer record and
 * drops rows the customer already had.
 */
export async function mergeGuestWishlist(
  shopId: string,
  guestToken: string,
  customerId: string,
): Promise<number> {
  const guestItems = await db.wishlistItem.findMany({
    where: { shopId, guestToken, customerId: null },
  });
  if (!guestItems.length) return 0;

  const owned = await db.wishlistItem.findMany({
    where: { shopId, customerId },
    select: { productId: true, variantId: true },
  });
  const ownedKeys = new Set(
    owned.map((row) => `${row.productId}:${row.variantId ?? ""}`),
  );

  let merged = 0;
  await db.$transaction(async (tx) => {
    for (const item of guestItems) {
      const key = `${item.productId}:${item.variantId ?? ""}`;
      if (ownedKeys.has(key)) {
        await tx.wishlistItem.delete({ where: { id: item.id } });
        continue;
      }
      await tx.wishlistItem.update({
        where: { id: item.id },
        data: { customerId, guestToken: null },
      });
      ownedKeys.add(key);
      merged += 1;
    }
  });
  return merged;
}

export type TopWishlistedRow = {
  productId: string;
  saves: number;
  distinctShoppers: number;
};

/** Powers the "most wishlisted products" table — the demand signal merchants care about. */
export async function topWishlistedProducts(
  shopId: string,
  limit = 10,
): Promise<TopWishlistedRow[]> {
  const rows = await db.$queryRaw<
    Array<{ productId: string; saves: bigint; shoppers: bigint }>
  >`
    SELECT "productId",
           COUNT(*)::bigint AS saves,
           COUNT(DISTINCT COALESCE("customerId", "guestToken"))::bigint AS shoppers
    FROM "WishlistItem"
    WHERE "shopId" = ${shopId}
    GROUP BY "productId"
    ORDER BY saves DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    productId: row.productId,
    saves: Number(row.saves),
    distinctShoppers: Number(row.shoppers),
  }));
}

export async function wishlistStats(shopId: string) {
  const [total, last30, shoppers] = await Promise.all([
    db.wishlistItem.count({ where: { shopId } }),
    db.wishlistItem.count({
      where: {
        shopId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT COALESCE("customerId", "guestToken"))::bigint AS count
      FROM "WishlistItem" WHERE "shopId" = ${shopId}
    `,
  ]);
  return { total, last30, shoppers: Number(shoppers[0]?.count ?? 0) };
}

/** Increment add-to-cart counter for a product (upsert-style). */
export async function incrementAddToCart(
  shopId: string,
  productId: string,
  amount = 1,
) {
  const res = await db.wishlistMetric.updateMany({
    where: { shopId, productId },
    data: { addsToCart: { increment: amount } },
  });
  if (res.count === 0) {
    await db.wishlistMetric.create({
      data: { shopId, productId, addsToCart: amount },
    });
  }
}

/** Increment purchase counter for a product (upsert-style). */
export async function incrementPurchases(
  shopId: string,
  productId: string,
  amount = 1,
) {
  const res = await db.wishlistMetric.updateMany({
    where: { shopId, productId },
    data: { purchases: { increment: amount } },
  });
  if (res.count === 0) {
    await db.wishlistMetric.create({
      data: { shopId, productId, purchases: amount },
    });
  }
}

export type WishlistMetricRow = {
  productId: string;
  addsToCart: number;
  purchases: number;
};

export async function metricsForProducts(
  shopId: string,
  productIds: string[],
): Promise<WishlistMetricRow[]> {
  if (!productIds.length) return [];
  const rows = await db.wishlistMetric.findMany({
    where: { shopId, productId: { in: productIds } },
    select: { productId: true, addsToCart: true, purchases: true },
  });
  return rows.map((r) => ({
    productId: r.productId,
    addsToCart: r.addsToCart,
    purchases: r.purchases,
  }));
}
