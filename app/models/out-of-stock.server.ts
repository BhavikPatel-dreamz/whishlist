import type { GraphqlClient } from "../lib/shopify-data.server";
import type { MetricProduct } from "../lib/analytics-metrics";

/** Current inventory for the authenticated shop, independent of wishlist activity. */
export async function loadOutOfStockProducts(admin: GraphqlClient) {
  const products = new Map<string, MetricProduct>();
  let after: string | null = null;
  do {
    const response = await admin.graphql(
      `#graphql
      query OutOfStockProducts($after: String) {
        products(first: 100, after: $after, sortKey: TITLE,
          query: "status:active tracks_inventory:true inventory_total:<=0") {
          nodes { id title totalInventory featuredImage { url } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { after } },
    );
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data?.products) {
      throw new Error("Could not load out-of-stock products from Shopify.");
    }
    const connection = body.data.products;
    for (const product of connection.nodes) {
      if (
        typeof product.totalInventory !== "number" ||
        product.totalInventory > 0
      )
        continue;
      products.set(product.id.split("/").pop(), {
        title: product.title,
        imageUrl: product.featuredImage?.url || null,
        totalInventory: product.totalInventory,
        minPrice: null,
        currencyCode: null,
      });
    }
    const next = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
    if (connection.pageInfo.hasNextPage && (!next || next === after)) {
      throw new Error(
        "Shopify returned an invalid inventory pagination cursor.",
      );
    }
    after = next;
  } while (after);
  return products;
}
