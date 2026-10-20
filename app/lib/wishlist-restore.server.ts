import db from "../db.server";
import { listName } from "../models/wishlist-lists.server";
import type { GraphqlClient } from "./shopify-data.server";
import { gqlRequest } from "./graphql.server";

type MetafieldItem = {
  productId?: unknown;
  variantId?: unknown;
  handle?: unknown;
  listName?: unknown;
  addedAt?: unknown;
};

/**
 * On app install/reinstall, restore customer wishlists from metafields.
 * This ensures customers don't lose their wishlist items even after app uninstall.
 * Batched: one lookup for which customers already have rows, then one transaction
 * per customer (lists + items) instead of per-item queries.
 */
export async function restoreWishlistsFromMetafields(
  shopId: string,
  admin: GraphqlClient,
): Promise<{ restored: number; errors: number }> {
  let restored = 0;
  let errors = 0;

  try {
    // Query all customers with the wishlist metafield set
    const query = `
      query {
        customers(first: 250, query: "metafield_definitions.name:wishlist_stock") {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              email
              metafield(namespace: "wishlist_stock", key: "items") {
                value
              }
            }
          }
        }
      }
    `;

    const data = await gqlRequest<{
      customers?: {
        edges?: Array<{
          node: {
            id: string;
            email?: string | null;
            metafield?: { value?: string | null } | null;
          };
        }>;
      };
    }>(admin, query, { errorPrefix: "", requireData: false });

    const customers = data?.customers?.edges || [];

    const parsed: Array<{ customerId: string; items: MetafieldItem[] }> = [];
    for (const { node: customer } of customers) {
      if (!customer.metafield?.value) continue;
      try {
        const items = JSON.parse(customer.metafield.value);
        if (!Array.isArray(items) || items.length === 0) continue;
        parsed.push({
          customerId: customer.id.replace(/^gid:\/\/shopify\/Customer\//, ""),
          items,
        });
      } catch (e) {
        console.warn(`Failed to parse metafield for customer ${customer.id}:`, e);
        errors++;
      }
    }
    if (!parsed.length) return { restored, errors };

    // One query answers "who already has items?" for every customer at once.
    const customersWithItems = new Set(
      (
        await db.wishlistItem.findMany({
          where: { shopId, customerId: { in: parsed.map((entry) => entry.customerId) } },
          select: { customerId: true },
        })
      ).map((row) => row.customerId),
    );

    for (const { customerId, items } of parsed) {
      if (customersWithItems.has(customerId)) {
        // Customer already has items; don't overwrite
        continue;
      }

      const rows: Array<{
        shopId: string;
        customerId: string;
        productId: string;
        variantId: string | null;
        handle: string | null;
        listName: string;
        createdAt: Date;
      }> = [];
      const listNames = new Set<string>();
      for (const item of items) {
        try {
          if (typeof item.productId !== "string" || !item.productId) {
            throw new Error("missing productId");
          }
          const restoredList = listName(item.listName);
          listNames.add(restoredList);
          rows.push({
            shopId,
            customerId,
            productId: item.productId,
            variantId: typeof item.variantId === "string" && item.variantId ? item.variantId : null,
            handle: typeof item.handle === "string" ? item.handle : null,
            listName: restoredList,
            createdAt: item.addedAt ? new Date(item.addedAt as string | number) : new Date(),
          });
        } catch (e) {
          console.warn(`Failed to restore wishlist item for customer ${customerId}:`, e);
          errors++;
        }
      }
      if (!rows.length) continue;

      try {
        await db.$transaction(async (tx) => {
          await tx.wishlistList.createMany({
            data: [...listNames].map((name) => ({
              shopId,
              owner: `customer:${customerId}`,
              name,
            })),
            skipDuplicates: true,
          });
          // Unique (shopId, customerId, productId, variantId) absorbs duplicates.
          await tx.wishlistItem.createMany({ data: rows, skipDuplicates: true });
        });
        restored++;
      } catch (e) {
        console.warn(`Failed to restore wishlist for customer ${customerId}:`, e);
        errors++;
      }
    }
  } catch (error) {
    console.error("Failed to restore wishlists from metafields:", error);
  }

  return { restored, errors };
}
