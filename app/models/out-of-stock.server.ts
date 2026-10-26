import { gqlRequest } from "../lib/graphql.server";
import type { GraphqlClient } from "../lib/shopify-data.server";

type VariantNode = {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryItem: { tracked: boolean } | null;
};

type VariantConnection = {
  nodes: VariantNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type ProductVariantsPage = {
  products: {
    nodes: Array<{
      id: string;
      title: string;
      totalInventory: number | null;
      featuredImage?: { url?: string | null } | null;
      variants: VariantConnection;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const productVariantsQuery = `#graphql
  query InventoryProductVariants($after: String, $query: String!) {
    products(first: 50, after: $after, sortKey: TITLE, query: $query) {
      nodes {
        id
        title
        totalInventory
        featuredImage { url }
        variants(first: 50) {
          nodes { id title sku inventoryQuantity inventoryItem { tracked } }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    
  }`;

const singleProductVariantsQuery = `#graphql
  query InventoryProductVariantPage($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 50, after: $after) {
        nodes { id title sku inventoryQuantity inventoryItem { tracked } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

export type InventoryVariant = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  imageUrl: string | null;
  inventory: number;
  /** Stock of the whole product, all variants together. */
  productInventory: number | null;
};

/**
 * Every inventory tracked variant of every active product, with its stock across
 * all locations.
 *
 * The product level view only caught products whose *total* inventory hit zero, so a
 * product with one sold out variant (and other variants still in stock) never showed up
 * at all. Walking the variants instead shows exactly which variant is running out.
 */
export async function loadInventoryVariants(
  admin: GraphqlClient,
): Promise<InventoryVariant[]> {
  const rows: InventoryVariant[] = [];
  const query = "status:active tracks_inventory:true";
  let after: string | null = null;
  do {
    const data: ProductVariantsPage = await gqlRequest<ProductVariantsPage>(
      admin,
      productVariantsQuery,
      {
        variables: { after, query },
        errorMessage: "Could not load inventory variants from Shopify.",
        hasData: (payload) => Boolean(payload?.products),
      },
    );
    const connection = data.products;
    for (const product of connection.nodes) {
      const productId = product.id.split("/").pop()!;
      const imageUrl = product.featuredImage?.url || null;
      const variants: VariantNode[] = [...product.variants.nodes];
      let pageInfo = product.variants.pageInfo;
      // Products with more variants than one page carries need extra pages.
      while (pageInfo.hasNextPage) {
        const nextCursor = pageInfo.endCursor;
        if (!nextCursor) break;
        const extra: {
          product: { variants: VariantConnection } | null;
        } | null = await gqlRequest(admin, singleProductVariantsQuery, {
          variables: { id: product.id, after: nextCursor },
          errorMessage: "Could not load product variants from Shopify.",
          hasData: (payload) => Boolean(payload?.product),
        });
        if (!extra?.product) break;
        variants.push(...extra.product.variants.nodes);
        pageInfo = extra.product.variants.pageInfo;
      }
      for (const variant of variants) {
        if (variant.inventoryQuantity === null) continue;
        // Variants that do not track inventory have no stock to run out.
        if (variant.inventoryItem && !variant.inventoryItem.tracked) continue;
        rows.push({
          variantId: variant.id.split("/").pop()!,
          productId,
          productTitle: product.title,
          variantTitle: variant.title,
          sku: variant.sku,
          imageUrl,
          inventory: variant.inventoryQuantity,
          productInventory: product.totalInventory,
        });
      }
    }
    const next = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
    if (connection.pageInfo.hasNextPage && (!next || next === after)) {
      throw new Error("Shopify returned an invalid inventory pagination cursor.");
    }
    after = next;
  } while (after);
  return rows;
}

/** The variants that are currently out of stock, across all locations. */
export async function loadOutOfStockVariants(
  admin: GraphqlClient,
): Promise<InventoryVariant[]> {
  const variants = await loadInventoryVariants(admin);
  return variants.filter((variant) => variant.inventory <= 0);
}
