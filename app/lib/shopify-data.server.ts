import { toGid } from "./proxy.server";
import { gqlRequest, type GraphqlClient } from "./graphql.server";

export type { GraphqlClient };

export type VariantSummary = {
  variantId: string; // numeric
  variantGid: string;
  variantTitle: string;
  sku: string | null;
  price: string | null;
  currencyCode: string | null;
  availableForSale: boolean;
  inventoryQuantity: number; // total across ALL locations — not what the storefront sells
  sellableOnlineQuantity: number; // online-channel sellable qty — matches Liquid `variant.available`
  imageUrl: string | null;
  productId: string; // numeric
  productTitle: string;
  productHandle: string;
  productStatus: string;
  onlineStoreUrl: string | null;
};

export type ShopContext = {
  name: string;
  currencyCode: string;
  domain: string; // https://shop.example.com
};

async function gql<T>(
  admin: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return gqlRequest<T>(admin, query, { variables });
}

const VARIANT_FIELDS = `
  id
  title
  sku
  price
  availableForSale
  inventoryQuantity
  sellableOnlineQuantity
  image { url }
  product {
    id
    title
    handle
    status
    onlineStoreUrl
    featuredImage { url }
  }
`;

type RawVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  sellableOnlineQuantity: number | null;
  image: { url: string } | null;
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
    onlineStoreUrl: string | null;
    featuredImage: { url: string } | null;
  };
};

function mapVariant(
  raw: RawVariant,
  currencyCode: string | null = null,
): VariantSummary {
  return {
    variantId: raw.id.split("/").pop() as string,
    variantGid: raw.id,
    variantTitle: raw.title,
    sku: raw.sku,
    price: raw.price,
    currencyCode,
    availableForSale: raw.availableForSale,
    inventoryQuantity: raw.inventoryQuantity ?? 0,
    sellableOnlineQuantity: raw.sellableOnlineQuantity ?? 0,
    imageUrl: raw.image?.url ?? raw.product.featuredImage?.url ?? null,
    productId: raw.product.id.split("/").pop() as string,
    productTitle: raw.product.title,
    productHandle: raw.product.handle,
    productStatus: raw.product.status,
    onlineStoreUrl: raw.product.onlineStoreUrl,
  };
}

export async function getShopContext(
  admin: GraphqlClient,
): Promise<ShopContext> {
  const data = await gql<{
    shop: {
      name: string;
      currencyCode: string;
      primaryDomain: { url: string };
    };
  }>(
    admin,
    `#graphql
     query ShopContext {
       shop { name currencyCode primaryDomain { url } }
     }`,
  );
  return {
    name: data.shop.name,
    currencyCode: data.shop.currencyCode,
    domain: data.shop.primaryDomain.url.replace(/\/$/, ""),
  };
}

/** Resolves the variant behind an `inventory_levels/update` webhook. */
export async function getVariantByInventoryItem(
  admin: GraphqlClient,
  inventoryItemId: string,
): Promise<VariantSummary | null> {
  const data = await gql<{
    inventoryItem: { variant: RawVariant | null } | null;
  }>(
    admin,
    `#graphql
     query VariantByInventoryItem($id: ID!) {
       inventoryItem(id: $id) {
         id
         variant { ${VARIANT_FIELDS} }
       }
     }`,
    { id: toGid("InventoryItem", inventoryItemId) },
  );
  const variant = data.inventoryItem?.variant;
  return variant ? mapVariant(variant) : null;
}

export async function getVariantsByIds(
  admin: GraphqlClient,
  variantIds: string[],
): Promise<VariantSummary[]> {
  if (!variantIds.length) return [];
  const data = await gql<{ nodes: Array<RawVariant | null> }>(
    admin,
    `#graphql
     query VariantsByIds($ids: [ID!]!) {
       nodes(ids: $ids) {
         ... on ProductVariant { ${VARIANT_FIELDS} }
       }
     }`,
    { ids: variantIds.map((id) => toGid("ProductVariant", id)) },
  );
  return data.nodes
    .filter(Boolean)
    .map((node) => mapVariant(node as RawVariant));
}

export type ProductSummary = {
  productId: string;
  title: string;
  handle: string;
  status: string;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  totalInventory: number;
  minPrice: string | null;
  currencyCode: string | null;
  availableForSale: boolean;
  variants: Array<{
    variantId: string;
    title: string;
    price: string | null;
    availableForSale: boolean;
    imageUrl: string | null;
    sku: string | null;
  }>;
};

export async function getCustomerNamesByIds(
  admin: GraphqlClient,
  customerIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!customerIds.length) return result;

  try {
    const data = await gql<{
      nodes: Array<{
        id: string;
        displayName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      } | null>;
    }>(
      admin,
      `#graphql
       query CustomerNames($ids: [ID!]!) {
         nodes(ids: $ids) {
           ... on Customer {
             id
             displayName
             firstName
             lastName
           }
         }
       }`,
      { ids: customerIds.map((id) => toCustomerGid(id)) },
    );

    for (const node of data.nodes ?? []) {
      if (!node) continue;
      const customerId = node.id.split("/").pop() as string;
      const fullName = [node.firstName, node.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      result.set(
        customerId,
        node.displayName || fullName || `Customer ${customerId}`,
      );
    }
  } catch {
    // App may not have Customer data access — fall back to IDs
  }

  return result;
}

export function toCustomerGid(id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;
}

export async function getProductsByIds(
  admin: GraphqlClient,
  productIds: string[],
  variantLimit = 50,
): Promise<Map<string, ProductSummary>> {
  const result = new Map<string, ProductSummary>();
  if (!productIds.length) return result;

  // `nodes` accepts at most 250 ids per call. Chunks run concurrently (bounded) —
  // a 250-item wishlist used to take three sequential round trips.
  const chunks: string[][] = [];
  for (let i = 0; i < productIds.length; i += 100)
    chunks.push(productIds.slice(i, i + 100));

  let next = 0;
  const workers = Array.from(
    { length: Math.min(3, chunks.length) },
    async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        const data = await gql<{
      nodes: Array<{
        id: string;
        title: string;
        handle: string;
        status: string;
        onlineStoreUrl: string | null;
        totalInventory: number | null;
        featuredImage: { url: string } | null;
        priceRangeV2: {
          minVariantPrice: { amount: string; currencyCode: string };
        };
        variants: {
          nodes: Array<{
            id: string;
            title: string;
            price: string | null;
            availableForSale: boolean;
            sku: string | null;
            image: { url: string } | null;
          }>;
        };
      } | null>;
    }>(
      admin,
      `#graphql
       query ProductsByIds($ids: [ID!]!, $variantLimit: Int!) {
         nodes(ids: $ids) {
           ... on Product {
             id
             title
             handle
             status
             onlineStoreUrl
             totalInventory
             featuredImage { url }
             priceRangeV2 { minVariantPrice { amount currencyCode } }
variants(first: $variantLimit) {
             nodes { id title price availableForSale sku image { url } }
           }
           }
         }
       }`,
      { ids: chunk.map((id) => toGid("Product", id)), variantLimit },
    );

    for (const node of data.nodes) {
      if (!node) continue;
      const variants = node.variants.nodes.map((variant) => ({
        variantId: variant.id.split("/").pop() as string,
        title: variant.title,
        price: variant.price,
        availableForSale: variant.availableForSale,
        imageUrl: variant.image?.url ?? node.featuredImage?.url ?? null,
        sku: variant.sku ?? null,
      }));
      const productId = node.id.split("/").pop() as string;
      result.set(productId, {
        productId,
        title: node.title,
        handle: node.handle,
        status: node.status,
        onlineStoreUrl: node.onlineStoreUrl,
        imageUrl: node.featuredImage?.url ?? null,
        totalInventory: node.totalInventory ?? 0,
        minPrice: node.priceRangeV2?.minVariantPrice?.amount ?? null,
        currencyCode: node.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        availableForSale: variants.some((variant) => variant.availableForSale),
        variants,
      });
      }
      }
    },
  );
  await Promise.all(workers);
  return result;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(
  amount: string | null,
  currencyCode: string | null,
): string | null {
  if (!amount) return null;
  const value = Number(amount);
  if (Number.isNaN(value)) return null;
  const currency = currencyCode || "USD";
  try {
    let formatter = moneyFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat("en", { style: "currency", currency });
      moneyFormatters.set(currency, formatter);
    }
    return formatter.format(value);
  } catch {
    return `${amount} ${currencyCode || ""}`.trim();
  }
}

/** Fetches the first published product (for the admin card-preview). */
export async function getFirstProduct(
  admin: GraphqlClient,
): Promise<ProductSummary | null> {
  const data = await gql<{
    products: {
      nodes: Array<{
        id: string;
        title: string;
        handle: string;
        status: string;
        onlineStoreUrl: string | null;
        totalInventory: number | null;
        featuredImage: { url: string } | null;
        priceRangeV2: {
          minVariantPrice: { amount: string; currencyCode: string };
        };
        variants: {
          nodes: Array<{
            id: string;
            title: string;
            price: string | null;
            availableForSale: boolean;
            sku: string | null;
            image: { url: string } | null;
          }>;
        };
      }>;
    };
  }>(
    admin,
    `#graphql
     query FirstProduct($first: Int!) {
       products(first: $first) {
         nodes {
           id
           title
           handle
           status
           onlineStoreUrl
           totalInventory
           featuredImage { url }
           priceRangeV2 { minVariantPrice { amount currencyCode } }
           variants(first: 10) {
             nodes { id title price availableForSale sku image { url } }
           }
         }
       }
     }`,
    { first: 1 },
  );

  const node = data.products?.nodes?.[0];
  if (!node) return null;
  const variants = node.variants.nodes.map((variant) => ({
    variantId: variant.id.split("/").pop() as string,
    title: variant.title,
    price: variant.price,
    availableForSale: variant.availableForSale,
    imageUrl: variant.image?.url ?? node.featuredImage?.url ?? null,
    sku: variant.sku ?? null,
  }));
  const productId = node.id.split("/").pop() as string;
  return {
    productId,
    title: node.title,
    handle: node.handle,
    status: node.status,
    onlineStoreUrl: node.onlineStoreUrl,
    imageUrl: node.featuredImage?.url ?? null,
    totalInventory: node.totalInventory ?? 0,
    minPrice: node.priceRangeV2?.minVariantPrice?.amount ?? null,
    currencyCode: node.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
    availableForSale: variants.some((variant) => variant.availableForSale),
    variants,
  };
}
