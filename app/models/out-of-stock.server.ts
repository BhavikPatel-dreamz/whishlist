import { gqlRequest } from "../lib/graphql.server";
import type { GraphqlClient } from "../lib/shopify-data.server";
import type { MetricProduct } from "../lib/analytics-metrics";

type InventoryFilter = "all" | "out-of-stock";

type InventoryPage = {
  products: {
    nodes: Array<{
      id: string;
      title: string;
      totalInventory: number | null;
      featuredImage?: { url?: string | null } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const inventoryQuery = `#graphql
  query InventoryProducts($after: String, $query: String!) {
    products(first: 100, after: $after, sortKey: TITLE, query: $query) {
      nodes { id title totalInventory featuredImage { url } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

async function loadInventoryProducts(
  admin: GraphqlClient,
  filter: InventoryFilter,
) {
  const onlyOutOfStock = filter === "out-of-stock";
  const query = onlyOutOfStock
    ? "status:active tracks_inventory:true inventory_total:<=0"
    : "status:active tracks_inventory:true";
  const errorMessage = onlyOutOfStock
    ? "Could not load out-of-stock products from Shopify."
    : "Could not load stock list from Shopify.";

  const products = new Map<string, MetricProduct>();
  let after: string | null = null;
  do {
    const data: InventoryPage = await gqlRequest<InventoryPage>(
      admin,
      inventoryQuery,
      {
        variables: { after, query },
        errorMessage,
        hasData: (payload) => Boolean(payload?.products),
      },
    );
    const connection = data.products;
    for (const product of connection.nodes) {
      if (typeof product.totalInventory !== "number") continue;
      if (onlyOutOfStock && product.totalInventory > 0) continue;
      products.set(product.id.split("/").pop()!, {
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
      throw new Error("Shopify returned an invalid inventory pagination cursor.");
    }
    after = next;
  } while (after);
  return products;
}

/** Current inventory for the authenticated shop, independent of wishlist activity. */
export function loadStockProducts(admin: GraphqlClient) {
  return loadInventoryProducts(admin, "all");
}

/** Products that track inventory and currently have none left. */
export function loadOutOfStockProducts(admin: GraphqlClient) {
  return loadInventoryProducts(admin, "out-of-stock");
}
