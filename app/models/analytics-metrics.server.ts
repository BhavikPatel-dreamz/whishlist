import db from "../db.server";
import { loadOutOfStockVariants } from "./out-of-stock.server";
import { metricsDateBounds, metricsDateRange, summarizeMetrics } from "../lib/analytics-metrics";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
} from "../lib/shopify-data.server";

export async function loadAnalyticsMetrics(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
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
  const customerIds = [
    ...new Set(
      items.flatMap((item) => (item.customerId ? [item.customerId] : [])),
    ),
  ];
  const [products, nameMaps, outOfStockVariants] = await Promise.all([
    getProductsByIds(
      admin,
      [...new Set(items.map((item) => item.productId))],
      1,
    ),
    Promise.all(
      Array.from({ length: Math.ceil(customerIds.length / 250) }, (_, i) =>
        getCustomerNamesByIds(admin, customerIds.slice(i * 250, (i + 1) * 250)),
      ),
    ),
    loadOutOfStockVariants(admin),
  ]);
  // Group the out-of-stock variants by product so "Running out soon" can name the
  // exact variant that ran out, not just the product.
  const outOfStockByProduct = new Map<
    string,
    {
      title: string;
      imageUrl: string | null;
      variants: string[];
      stock: number | null;
    }
  >();
  for (const variant of outOfStockVariants) {
    const entry = outOfStockByProduct.get(variant.productId) || {
      title: variant.productTitle,
      imageUrl: variant.imageUrl,
      variants: [] as string[],
      stock: variant.productInventory,
    };
    entry.variants.push(variant.variantTitle);
    outOfStockByProduct.set(variant.productId, entry);
  }
  return {
    ...range,
    ...summarizeMetrics(
      items,
      products,
      new Map(nameMaps.flatMap((map) => [...map])),
      outOfStockByProduct,
    ),
  };
}
