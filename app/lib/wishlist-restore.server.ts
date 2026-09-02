import db from "../db.server";
import type { GraphqlClient } from "./shopify-data.server";
import { getWishlistFromMetafield } from "./wishlist-sync.server";

/**
 * On app install/reinstall, restore customer wishlists from metafields.
 * This ensures customers don't lose their wishlist items even after app uninstall.
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

    const response = await admin.graphql(query);
    const payload = (await response.json()) as {
      data?: {
        customers?: {
          edges?: Array<{
            node: {
              id: string;
              email?: string | null;
              metafield?: { value?: string | null } | null;
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    const customers = payload.data?.customers?.edges || [];

    for (const { node: customer } of customers) {
      if (!customer.metafield?.value) continue;

      try {
        const items = JSON.parse(customer.metafield.value);
        if (!Array.isArray(items) || items.length === 0) continue;

        const customerId = customer.id;

        // Check if customer already has wishlist items in the database
        const existing = await db.wishlistItem.count({
          where: { shopId, customerId },
        });

        if (existing > 0) {
          // Customer already has items; don't overwrite
          continue;
        }

        // Restore items from metafield
        for (const item of items) {
          try {
            // Check if item already exists
            const existing = await db.wishlistItem.findFirst({
              where: {
                shopId,
                customerId,
                productId: item.productId,
                variantId: item.variantId || null,
              },
            });

            if (!existing) {
              await db.wishlistItem.create({
                data: {
                  shopId,
                  customerId,
                  productId: item.productId,
                  variantId: item.variantId || null,
                  handle: item.handle,
                  createdAt: item.addedAt ? new Date(item.addedAt) : new Date(),
                },
              });
            }
          } catch (e) {
            console.warn(
              `Failed to restore wishlist item for customer ${customerId}:`,
              e,
            );
            errors++;
          }
        }

        restored++;
      } catch (e) {
        console.warn(
          `Failed to parse metafield for customer ${customer.id}:`,
          e,
        );
        errors++;
      }
    }
  } catch (error) {
    console.error("Failed to restore wishlists from metafields:", error);
  }

  return { restored, errors };
}
