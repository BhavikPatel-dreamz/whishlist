import db from "../db.server";
import {
  metricsDateBounds,
  metricsDateRange,
  summarizeMetrics,
} from "../lib/analytics-metrics";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
  type ProductSummary,
} from "../lib/shopify-data.server";
import {
  loadOutOfStockVariants,
  type InventoryVariant,
} from "./out-of-stock.server";

type LoadOptions = {
  /** Only hydrate/return the top N rows (dashboard renders 20 per column). */
  limit?: number;
  /** Extra products to hydrate for stock status (e.g. alert demand). */
  extraProductIds?: string[];
};

function outOfStockFromProducts(products: Map<string, ProductSummary>) {
  const result = new Map<
    string,
    {
      title: string;
      imageUrl: string | null;
      variants: string[];
      stock: number | null;
    }
  >();
  for (const product of products.values()) {
    const outOfStock = product.variants.filter(
      (variant) =>
        variant.tracked &&
        variant.inventoryQuantity !== null &&
        variant.inventoryQuantity <= 0,
    );
    if (!outOfStock.length) continue;
    result.set(product.productId, {
      title: product.title,
      imageUrl: product.imageUrl,
      variants: outOfStock.map((variant) => variant.title),
      stock: product.totalInventory,
    });
  }
  return result;
}

function outOfStockFromVariants(variants: InventoryVariant[]) {
  const result = new Map<
    string,
    {
      title: string;
      imageUrl: string | null;
      variants: string[];
      stock: number | null;
    }
  >();
  for (const variant of variants) {
    if (variant.inventory > 0) continue;
    const entry = result.get(variant.productId) || {
      title: variant.productTitle,
      imageUrl: variant.imageUrl,
      variants: [] as string[],
      stock: variant.productInventory,
    };
    entry.variants.push(variant.variantTitle);
    result.set(variant.productId, entry);
  }
  return result;
}

export async function loadAnalyticsMetrics(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
  options: LoadOptions = {},
) {
  const range = metricsDateRange(params);
  const items = await db.wishlistItem.findMany({
    where: {
      shopId,
      createdAt: metricsDateBounds(range),
    },
    select: { productId: true, customerId: true, guestToken: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });

  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const isDashboard = Number.isFinite(limit);
  // Cheap first pass: no Shopify calls. It gives the exact ranking the UI
  // renders, so only those products/customers need to be hydrated.
  const draft = summarizeMetrics(items, new Map());
  const productIds = [
    ...new Set([
      ...draft.popular.slice(0, limit).map((row) => row.productId),
      ...(options.extraProductIds ?? []),
    ]),
  ];
  const hydratedIds = isDashboard ? productIds.slice(0, 100) : productIds;
  const customerIds = [
    ...new Set(
      draft.shoppers
        .slice(0, limit)
        .map((row) => row.customerId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  // The dashboard hydrates only the top rows and reads stock from the same
  // product call. Detailed reports keep the full, variant-level inventory scan.
  const [products, names, outOfStockVariants] = await Promise.all([
    getProductsByIds(admin, hydratedIds, isDashboard ? 50 : 1, false),
    getCustomerNamesByIds(admin, customerIds),
    isDashboard ? Promise.resolve([] as InventoryVariant[]) : loadOutOfStockVariants(admin, shopId),
  ]);

  const outOfStock = isDashboard
    ? outOfStockFromProducts(products)
    : outOfStockFromVariants(outOfStockVariants);
  const result = summarizeMetrics(items, products, names, outOfStock);
  if (!isDashboard) return { ...range, ...result };
  return {
    ...range,
    ...result,
    popular: result.popular.slice(0, limit),
    shoppers: result.shoppers.slice(0, limit),
  };
}
