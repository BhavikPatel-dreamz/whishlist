import type { GraphqlClient } from "./shopify-data.server";

/**
 * Syncs wishlist items to Shopify customer metafields so data persists
 * even if the app is uninstalled. Metafields survive app removal.
 */

const WISHLIST_METAFIELD_NAMESPACE = "wishlist_stock";
const WISHLIST_METAFIELD_KEY = "items";

export interface WishlistMetafield {
  productId: string;
  variantId: string | null;
  handle: string | null;
  addedAt: string;
}

/**
 * Syncs a customer's wishlist to their metafield in Shopify.
 * This persists wishlist data even after app uninstall.
 */
export async function syncWishlistToMetafield(
  client: GraphqlClient,
  customerId: string,
  items: Array<{
    productId: string;
    variantId: string | null;
    handle: string | null;
    createdAt: Date;
  }>,
): Promise<boolean> {
  try {
    const metafieldItems: WishlistMetafield[] = items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      handle: item.handle,
      addedAt: item.createdAt.toISOString(),
    }));

    const mutation = `
      mutation SetCustomerMetafield($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await client(mutation, {
      variables: {
        input: {
          id: customerId,
          metafields: [
            {
              namespace: WISHLIST_METAFIELD_NAMESPACE,
              key: WISHLIST_METAFIELD_KEY,
              type: "json",
              value: JSON.stringify(metafieldItems),
            },
          ],
        },
      },
    });

    if (response.customerUpdate?.userErrors?.length > 0) {
      console.warn(
        `Metafield sync errors for ${customerId}:`,
        response.customerUpdate.userErrors,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `Failed to sync wishlist to metafield for ${customerId}:`,
      error,
    );
    return false;
  }
}

/**
 * Retrieves a customer's wishlist from metafield.
 * Use this when restoring wishlist after app reinstall.
 */
export async function getWishlistFromMetafield(
  client: GraphqlClient,
  customerId: string,
): Promise<WishlistMetafield[]> {
  try {
    const query = `
      query GetCustomerMetafield($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "${WISHLIST_METAFIELD_NAMESPACE}", key: "${WISHLIST_METAFIELD_KEY}") {
            value
          }
        }
      }
    `;

    const response = await client(query, {
      variables: { id: customerId },
    });

    const value = response.customer?.metafield?.value;
    if (!value) return [];

    return JSON.parse(value);
  } catch (error) {
    console.error(
      `Failed to retrieve wishlist from metafield for ${customerId}:`,
      error,
    );
    return [];
  }
}
